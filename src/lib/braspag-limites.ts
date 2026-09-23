// ---------------------------------------------------------------------------
// AF3 — Limites de tamanho dos campos enviados à Braspag / Cybersource.
//
// Causa raiz (22/09): duas transações voltaram com FraudAnalysisStatus 4
// (Aborted), sem id, score nem motivo. A Braspag confirmou que a análise nunca
// rodou — o POST para riskapirest.braspag.com.br/Analysis/v2 devolveu
// 400 BadRequest com {"FraudAnalysisRequestError":["The Shipping.Complement
// length is greater than 14."]}. O hóspede digitou "Apto 406 bloco 1" (16
// caracteres) no complemento; o limite é 14. Em 17/09 o complemento coube e a
// transação passou.
//
// Esse erro NÃO chega até nós: a rota só enxerga Aborted. Por isso a validação
// é preventiva e cobre TODOS os campos de texto com limite documentado, não só
// o complemento.
//
// O "Shipping" que a Braspag cita é o nosso Customer.DeliveryAddress — a
// Braspag o traduz para o Shipping da Cybersource. Nós mandamos
// `deliveryAddress: billingAddress` na rota de crédito, então os dois caminhos
// carregam o mesmo complemento e os dois passam por aqui.
//
// Fonte dos limites: https://docs.cielo.com.br/gateway/reference/antifraude-cybersource
// A tabela completa, campo a campo, está em DECISOES.md.
//
// Regra da rodada: o ajuste vale SÓ para o que vai à Braspag. O formulário
// continua aceitando o que o hóspede digitar e o endereço guardado no rascunho
// / enviado ao Hostaway continua como foi digitado. Esta função é pura: devolve
// uma cópia ajustada e nunca modifica o objeto recebido.
// ---------------------------------------------------------------------------

/** Limite de cada campo de texto, exatamente como a documentação da Cielo lista. */
export const LIMITES_BRASPAG = {
  MerchantOrderId: 50,
  "Customer.Name": 120,
  "Customer.Identity": 14,
  "Customer.Email": 100,
  "Customer.Phone": 15,
  "Customer.Birthdate": 10,
  "Customer.IpAddress": 45,
  "Address.Street": 54,
  "Address.Number": 5,
  "Address.Complement": 14,
  "Address.ZipCode": 9,
  "Address.City": 50,
  "Address.State": 2,
  "Address.District": 45,
  "FraudAnalysis.FingerPrintId": 88,
  "FraudAnalysis.Browser.Email": 100,
  "FraudAnalysis.Browser.HostName": 60,
  "FraudAnalysis.Browser.IpAddress": 45,
  "FraudAnalysis.Browser.Type": 40,
  "FraudAnalysis.Cart.Items.Name": 255,
  "FraudAnalysis.Cart.Items.Sku": 255,
  "FraudAnalysis.Cart.Items.Risk": 6,
  "FraudAnalysis.Cart.Items.Type": 19,
  "FraudAnalysis.Shipping.Addressee": 120,
  "FraudAnalysis.Shipping.Method": 8,
  "FraudAnalysis.Shipping.Phone": 15,
  "FraudAnalysis.MerchantDefinedFields.Value": 255,
} as const;

/**
 * Um campo que precisou ser encurtado. Só nome e tamanhos — NUNCA o conteúdo,
 * que é dado pessoal do hóspede.
 */
export type CampoAjustado = {
  /** Caminho do campo no corpo enviado, ex. "Customer.BillingAddress.Complement". */
  campo: string;
  /** Tamanho original, em caracteres. */
  de: number;
  /** Tamanho depois do ajuste. */
  para: number;
};

export type EnderecoLimites = {
  Street: string;
  Number: string;
  Complement?: string;
  ZipCode: string;
  City: string;
  State: string;
  Country: string;
  District: string;
};

export type ItemCarrinhoLimites = {
  name: string;
  quantity: number;
  sku: string;
  unitPrice: number;
  risk?: string;
  type?: string;
};

export type DadosBraspagLimites = {
  orderId: string;
  customer: {
    name: string;
    identity: string;
    email: string;
    ipAddress: string;
    phone?: string;
    birthdate?: string;
    billingAddress?: EnderecoLimites;
    deliveryAddress?: EnderecoLimites;
  };
  fraud?: {
    browserFingerprint?: string;
    hostName?: string;
    cartItems: ItemCarrinhoLimites[];
    merchantDefinedFields?: Array<{ Id: number; Value: string }>;
    shipping?: { addressee?: string; method?: string; phone?: string };
  };
};

// ---------------------------------------------------------------------------
// Abreviações de complemento.
//
// Aplicadas SÓ no complemento e SÓ quando ele passa do limite: encurtar um
// complemento que já cabe seria mexer em dado do hóspede sem motivo. A ordem
// importa pouco (os termos não se sobrepõem), mas o ponto final opcional é
// absorvido junto: "Apto." vira "Ap", não "Ap.".
// ---------------------------------------------------------------------------
const ABREVIACOES: Array<[RegExp, string]> = [
  [/\b(?:apartamentos?|aptos?|apts?)\b\.?/gi, "Ap"],
  [/\bblocos?\b\.?/gi, "Bl"],
  [/\btorres?\b\.?/gi, "T"],
  [/\bandar(?:es)?\b\.?/gi, "And"],
  [/\bcasas?\b\.?/gi, "Cs"],
  [/\bsalas?\b\.?/gi, "Sl"],
  [/\bconjuntos?\b\.?/gi, "Cj"],
  [/\blotes?\b\.?/gi, "Lt"],
  [/\bquadras?\b\.?/gi, "Qd"],
];

/** Sem espaço duplo e sem espaço nas pontas. Acentos ficam como estão. */
function normalizarEspacos(valor: string): string {
  return valor.replace(/\s+/g, " ").trim();
}

/** "Apto 406 bloco 1" → "Ap 406 Bl 1". Sem diferenciar maiúsculas e minúsculas. */
export function abreviarComplemento(valor: string): string {
  let saida = valor;
  for (const [re, curto] of ABREVIACOES) saida = saida.replace(re, curto);
  return normalizarEspacos(saida);
}

/**
 * Coletor de ajustes: aplica o limite a um campo e anota o que mudou.
 * `obrigatorio` protege campos que a análise exige preenchidos — se a
 * normalização esvaziar um valor que veio preenchido, volta para o original
 * cortado no limite em vez de mandar vazio.
 */
class Ajustador {
  readonly ajustes: CampoAjustado[] = [];

  /**
   * @param campo caminho do campo no corpo enviado (vai para o log)
   * @param valor valor como veio
   * @param limite tamanho máximo documentado
   * @param opcoes.transformar normalização específica (CEP, complemento…)
   * @param opcoes.obrigatorio campo que a análise exige não vazio
   */
  texto(
    campo: string,
    valor: string,
    limite: number,
    opcoes: { transformar?: (v: string) => string; obrigatorio?: boolean } = {},
  ): string {
    const base = normalizarEspacos(valor);
    let saida = opcoes.transformar ? opcoes.transformar(base) : base;
    if (saida.length > limite) saida = saida.slice(0, limite).trimEnd();
    // Nunca deixar um campo obrigatório vazio por causa do ajuste.
    if (opcoes.obrigatorio && saida === "" && base !== "") saida = base.slice(0, limite);
    if (saida !== valor) this.ajustes.push({ campo, de: valor.length, para: saida.length });
    return saida;
  }

  /** Mesma regra, para campos que podem não existir. Ausente continua ausente. */
  opcional(
    campo: string,
    valor: string | undefined,
    limite: number,
    opcoes: { transformar?: (v: string) => string } = {},
  ): string | undefined {
    if (valor === undefined) return undefined;
    return this.texto(campo, valor, limite, opcoes);
  }
}

/** Só dígitos — a Braspag recusa CEP com hífen ocupando o tamanho. */
function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

function ajustarEndereco(a: Ajustador, prefixo: string, end: EnderecoLimites): EnderecoLimites {
  return {
    Street: a.texto(`${prefixo}.Street`, end.Street, LIMITES_BRASPAG["Address.Street"], {
      obrigatorio: true,
    }),
    Number: a.texto(`${prefixo}.Number`, end.Number, LIMITES_BRASPAG["Address.Number"], {
      obrigatorio: true,
    }),
    ...(end.Complement === undefined
      ? {}
      : {
          Complement: a.opcional(
            `${prefixo}.Complement`,
            end.Complement,
            LIMITES_BRASPAG["Address.Complement"],
            {
              // Abrevia só quando não cabe: complemento curto vai como o hóspede digitou.
              transformar: (v) => (v.length > LIMITES_BRASPAG["Address.Complement"] ? abreviarComplemento(v) : v),
            },
          ),
        }),
    ZipCode: a.texto(`${prefixo}.ZipCode`, end.ZipCode, LIMITES_BRASPAG["Address.ZipCode"], {
      transformar: somenteDigitos,
      obrigatorio: true,
    }),
    City: a.texto(`${prefixo}.City`, end.City, LIMITES_BRASPAG["Address.City"], { obrigatorio: true }),
    State: a.texto(`${prefixo}.State`, end.State, LIMITES_BRASPAG["Address.State"], { obrigatorio: true }),
    // Country fica FORA do corte: é constante nossa ("BRA"), nunca vem do
    // hóspede, e é assim que as transações aprovadas foram aceitas. Cortar para
    // "BR" mudaria um campo que comprovadamente funciona. Ver DECISOES.md.
    Country: end.Country,
    District: a.texto(`${prefixo}.District`, end.District, LIMITES_BRASPAG["Address.District"], {
      obrigatorio: true,
    }),
  };
}

/**
 * Devolve os mesmos dados com cada campo de texto dentro do limite da Braspag,
 * mais a lista do que precisou ser encurtado. Função pura: a entrada não é
 * modificada.
 */
export function ajustarLimitesBraspag(dados: DadosBraspagLimites): {
  dados: DadosBraspagLimites;
  ajustes: CampoAjustado[];
} {
  const a = new Ajustador();
  const c = dados.customer;

  const customer: DadosBraspagLimites["customer"] = {
    name: a.texto("Customer.Name", c.name, LIMITES_BRASPAG["Customer.Name"], { obrigatorio: true }),
    identity: a.texto("Customer.Identity", c.identity, LIMITES_BRASPAG["Customer.Identity"], {
      transformar: somenteDigitos,
      obrigatorio: true,
    }),
    email: a.texto("Customer.Email", c.email, LIMITES_BRASPAG["Customer.Email"], { obrigatorio: true }),
    ipAddress: a.texto("Customer.IpAddress", c.ipAddress, LIMITES_BRASPAG["Customer.IpAddress"], {
      obrigatorio: true,
    }),
    ...(c.phone === undefined
      ? {}
      : {
          phone: a.opcional("Customer.Phone", c.phone, LIMITES_BRASPAG["Customer.Phone"], {
            transformar: somenteDigitos,
          }),
        }),
    ...(c.birthdate === undefined
      ? {}
      : { birthdate: a.opcional("Customer.Birthdate", c.birthdate, LIMITES_BRASPAG["Customer.Birthdate"]) }),
    ...(c.billingAddress
      ? { billingAddress: ajustarEndereco(a, "Customer.BillingAddress", c.billingAddress) }
      : {}),
    // O Shipping que a Cybersource valida nasce daqui.
    ...(c.deliveryAddress
      ? { deliveryAddress: ajustarEndereco(a, "Customer.DeliveryAddress", c.deliveryAddress) }
      : {}),
  };

  const f = dados.fraud;
  const fraud: DadosBraspagLimites["fraud"] | undefined = f
    ? {
        ...(f.browserFingerprint === undefined
          ? {}
          : {
              browserFingerprint: a.opcional(
                "Payment.FraudAnalysis.FingerPrintId",
                f.browserFingerprint,
                LIMITES_BRASPAG["FraudAnalysis.FingerPrintId"],
              ),
            }),
        ...(f.hostName === undefined
          ? {}
          : {
              hostName: a.opcional(
                "Payment.FraudAnalysis.Browser.HostName",
                f.hostName,
                LIMITES_BRASPAG["FraudAnalysis.Browser.HostName"],
              ),
            }),
        cartItems: f.cartItems.map((it, i) => ({
          ...it,
          name: a.texto(
            `Payment.FraudAnalysis.Cart.Items[${i}].Name`,
            it.name,
            LIMITES_BRASPAG["FraudAnalysis.Cart.Items.Name"],
            { obrigatorio: true },
          ),
          sku: a.texto(
            `Payment.FraudAnalysis.Cart.Items[${i}].Sku`,
            it.sku,
            LIMITES_BRASPAG["FraudAnalysis.Cart.Items.Sku"],
            { obrigatorio: true },
          ),
          ...(it.risk === undefined
            ? {}
            : {
                risk: a.opcional(
                  `Payment.FraudAnalysis.Cart.Items[${i}].Risk`,
                  it.risk,
                  LIMITES_BRASPAG["FraudAnalysis.Cart.Items.Risk"],
                ),
              }),
          ...(it.type === undefined
            ? {}
            : {
                type: a.opcional(
                  `Payment.FraudAnalysis.Cart.Items[${i}].Type`,
                  it.type,
                  LIMITES_BRASPAG["FraudAnalysis.Cart.Items.Type"],
                ),
              }),
        })),
        ...(f.merchantDefinedFields
          ? {
              merchantDefinedFields: f.merchantDefinedFields.map((m, i) => ({
                Id: m.Id,
                Value: a.texto(
                  `Payment.FraudAnalysis.MerchantDefinedFields[${i}].Value`,
                  m.Value,
                  LIMITES_BRASPAG["FraudAnalysis.MerchantDefinedFields.Value"],
                ),
              })),
            }
          : {}),
        ...(f.shipping
          ? {
              shipping: {
                ...(f.shipping.addressee === undefined
                  ? {}
                  : {
                      addressee: a.opcional(
                        "Payment.FraudAnalysis.Shipping.Addressee",
                        f.shipping.addressee,
                        LIMITES_BRASPAG["FraudAnalysis.Shipping.Addressee"],
                      ),
                    }),
                ...(f.shipping.method === undefined
                  ? {}
                  : {
                      method: a.opcional(
                        "Payment.FraudAnalysis.Shipping.Method",
                        f.shipping.method,
                        LIMITES_BRASPAG["FraudAnalysis.Shipping.Method"],
                      ),
                    }),
                ...(f.shipping.phone === undefined
                  ? {}
                  : {
                      phone: a.opcional(
                        "Payment.FraudAnalysis.Shipping.Phone",
                        f.shipping.phone,
                        LIMITES_BRASPAG["FraudAnalysis.Shipping.Phone"],
                        { transformar: somenteDigitos },
                      ),
                    }),
              },
            }
          : {}),
      }
    : undefined;

  return {
    dados: {
      orderId: a.texto("MerchantOrderId", dados.orderId, LIMITES_BRASPAG.MerchantOrderId, {
        obrigatorio: true,
      }),
      customer,
      ...(fraud ? { fraud } : {}),
    },
    ajustes: a.ajustes,
  };
}

/**
 * Os campos derivados dentro do bloco FraudAnalysis (Browser.Email,
 * Browser.IpAddress, Shipping.Addressee quando cai no nome do cliente) reusam
 * valores de Customer já ajustados — por isso não têm ajuste próprio aqui.
 * Browser.Type é a constante "Chrome" (5 de 40).
 */
