import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Rodada AF3 — limites de tamanho dos campos enviados à Braspag/Cybersource.
//
// O caso real: em 22/09 duas transações voltaram Aborted porque a análise de
// risco recusou o corpo com 400 — "The Shipping.Complement length is greater
// than 14." O hóspede digitou "Apto 406 bloco 1" (16). Esse erro não chega à
// rota, então o teste cobre o que sai daqui, não o que a Braspag responde.
// ---------------------------------------------------------------------------

// Redis falso em memória: só o que a rota de crédito toca.
const redis = vi.hoisted(() => {
  process.env.KV_REST_API_URL = "http://redis-falso";
  process.env.KV_REST_API_TOKEN = "falso";
  process.env.HOSTAWAY_ACCOUNT_ID = "123";
  process.env.HOSTAWAY_API_KEY = "chave-falsa";
  const kv = new Map<string, unknown>();
  const api: Record<string, unknown> & { kv: typeof kv } = {
    kv,
    async set(k: string, v: unknown, o?: { nx?: boolean }) {
      if (o?.nx && kv.has(k)) return null;
      kv.set(k, String(v));
      return "OK";
    },
    async get(k: string) {
      return kv.get(k) ?? null;
    },
    async del(...ks: string[]) {
      return ks.filter((k) => kv.delete(k)).length;
    },
    async lpush() {
      return 1;
    },
    async ltrim() {
      return "OK";
    },
    async expire() {
      return 1;
    },
    async hincrby() {
      return 1;
    },
    async scan() {
      return [0, []];
    },
    pipeline() {
      const p: Record<string, unknown> = {};
      for (const nome of ["lpush", "ltrim", "expire", "hincrby", "hgetall"]) p[nome] = () => p;
      p.exec = async () => [];
      return p;
    },
  };
  return api;
});

vi.mock("@upstash/redis", () => ({
  Redis: class {
    constructor() {
      return redis;
    }
  },
}));

const mocks = vi.hoisted(() => ({
  // Tipado com o parâmetro para o teste poder conferir o que chega ao Hostaway.
  createHostawayReservation: vi.fn(async (_params: Record<string, unknown>) => ({ reservationId: 777 })),
}));

vi.mock("@/lib/hostaway", async (original) => ({
  ...(await original<typeof import("@/lib/hostaway")>()),
  createHostawayReservation: mocks.createHostawayReservation,
  blockCalendarNight: vi.fn(async () => true),
  unblockCalendarNight: vi.fn(async () => true),
}));
vi.mock("@/lib/op-extras-server", () => ({
  blockOpExtraNights: vi.fn(async () => ({ todasBloqueadas: true, resultados: [] })),
  noitesABloquear: () => [],
}));
vi.mock("@/lib/email", () => ({
  enviarAlertaRecusa: vi.fn(async () => undefined),
  enviarAlertaAprovacao: vi.fn(async () => undefined),
  enviarAlertaEmAnalise: vi.fn(async () => undefined),
  enviarEmailHospede: vi.fn(async () => ({ enviado: true })),
  enviarAlertaDesfechoAnalise: vi.fn(async () => undefined),
}));
vi.mock("@/lib/reservation-recovery", () => ({ registerOrphanAndAlert: vi.fn(async () => undefined) }));
vi.mock("@/lib/reserva-pacote", () => ({ paramsDePacote: () => ({}), extrasProvidenciar: () => [] }));

import {
  ajustarLimitesBraspag,
  abreviarComplemento,
  LIMITES_BRASPAG,
  type DadosBraspagLimites,
} from "@/lib/braspag-limites";
import { getDraft } from "@/lib/kv-store";
import { POST } from "@/app/api/payments/braspag/credit/route";

// ===========================================================================
// Parte 1 — a função pura.
// ===========================================================================

const ENDERECO = {
  Street: "Rua das Palmeiras",
  Number: "406",
  Complement: "",
  ZipCode: "37464000",
  City: "Itanhandu",
  State: "MG",
  Country: "BRA",
  District: "Centro",
};

function entrada(over: Partial<DadosBraspagLimites> = {}): DadosBraspagLimites {
  return {
    orderId: "pedido-1",
    customer: {
      name: "Maria Aparecida da Silva",
      identity: "12345678909",
      email: "maria@exemplo.com.br",
      ipAddress: "200.1.2.3",
      phone: "35999999999",
      billingAddress: { ...ENDERECO },
      deliveryAddress: { ...ENDERECO },
      ...over.customer,
    },
    fraud: {
      hostName: "solarium.test",
      cartItems: [{ name: "Solarium 1 (2 noites)", quantity: 1, sku: "sku-1", unitPrice: 100000 }],
      shipping: { method: "None", phone: "35999999999" },
      ...over.fraud,
    },
    ...(over.orderId ? { orderId: over.orderId } : {}),
  };
}

/** Atalho: ajusta um endereço e devolve o de cobrança já cortado. */
function comComplemento(complemento: string) {
  const r = ajustarLimitesBraspag(
    entrada({ customer: { ...entrada().customer, billingAddress: { ...ENDERECO, Complement: complemento } } }),
  );
  return { valor: r.dados.customer.billingAddress!.Complement!, ajustes: r.ajustes };
}

describe("AF3 — abreviação do complemento", () => {
  it("o caso real de 22/09: 'Apto 406 bloco 1' cabe em 14", () => {
    const { valor } = comComplemento("Apto 406 bloco 1");
    expect(valor).toBe("Ap 406 Bl 1");
    expect(valor.length).toBeLessThanOrEqual(LIMITES_BRASPAG["Address.Complement"]);
  });

  it.each([
    ["Apartamento 12", "Ap 12"],
    ["APTO 406 BLOCO 1", "Ap 406 Bl 1"],
    ["apto. 31 torre 2", "Ap 31 T 2"],
    ["Bloco C andar 14 sala 3", "Bl C And 14 Sl 3"],
    ["Casa 2 quadra 10 lote 7", "Cs 2 Qd 10 Lt 7"],
    ["Conjunto 501 Torre Norte", "Cj 501 T Norte"],
  ])("%s → %s", (digitado, esperado) => {
    expect(abreviarComplemento(digitado)).toBe(esperado);
  });

  it("complemento que já cabe vai como o hóspede digitou, sem abreviar", () => {
    const { valor, ajustes } = comComplemento("Apto 406");
    expect(valor).toBe("Apto 406");
    expect(ajustes).toHaveLength(0);
  });

  it("complemento longo sem termo abreviável é cortado no limite", () => {
    const { valor, ajustes } = comComplemento("Fundos do galpao azul ao lado da portaria");
    expect(valor).toHaveLength(LIMITES_BRASPAG["Address.Complement"]);
    expect(valor).toBe("Fundos do galp");
    expect(ajustes).toContainEqual({ campo: "Customer.BillingAddress.Complement", de: 41, para: 14 });
  });

  it("quando a abreviação não basta, ainda assim corta no limite", () => {
    const { valor } = comComplemento("Apartamento 1608 bloco Sul torre Jacaranda");
    expect(valor.length).toBeLessThanOrEqual(LIMITES_BRASPAG["Address.Complement"]);
  });
});

describe("AF3 — normalização", () => {
  it("CEP com hífen vira só dígitos", () => {
    const r = ajustarLimitesBraspag(
      entrada({
        customer: { ...entrada().customer, billingAddress: { ...ENDERECO, ZipCode: "37464-000" } },
      }),
    );
    expect(r.dados.customer.billingAddress!.ZipCode).toBe("37464000");
  });

  it("espaço duplo e espaço nas pontas somem", () => {
    const r = ajustarLimitesBraspag(
      entrada({ customer: { ...entrada().customer, name: "  Maria   Aparecida  " } }),
    );
    expect(r.dados.customer.name).toBe("Maria Aparecida");
  });

  it("acentos são preservados", () => {
    const r = ajustarLimitesBraspag(
      entrada({
        customer: {
          ...entrada().customer,
          name: "João Conceição",
          billingAddress: { ...ENDERECO, City: "São Lourenço", Street: "Avenida Getúlio Vargas" },
        },
      }),
    );
    expect(r.dados.customer.name).toBe("João Conceição");
    expect(r.dados.customer.billingAddress!.City).toBe("São Lourenço");
    expect(r.dados.customer.billingAddress!.Street).toBe("Avenida Getúlio Vargas");
  });

  it("campo obrigatório nunca fica vazio por causa do ajuste", () => {
    // CEP só com letras: a limpeza de dígitos zeraria o campo.
    const r = ajustarLimitesBraspag(
      entrada({ customer: { ...entrada().customer, billingAddress: { ...ENDERECO, ZipCode: "sem numero" } } }),
    );
    expect(r.dados.customer.billingAddress!.ZipCode).not.toBe("");
  });

  it("a entrada não é modificada — o rascunho e o Hostaway seguem com o valor digitado", () => {
    const original = entrada({
      customer: { ...entrada().customer, billingAddress: { ...ENDERECO, Complement: "Apto 406 bloco 1" } },
    });
    const copia = structuredClone(original);
    ajustarLimitesBraspag(original);
    expect(original).toEqual(copia);
  });
});

// Um teste de limite para CADA campo da tabela do DECISOES.md que a função
// ajusta. `caminho` é o nome que vai para o log; `ler` pega o valor do
// resultado; `montar` injeta um valor propositalmente grande demais.
type CasoLimite = {
  campo: keyof typeof LIMITES_BRASPAG;
  caminho: string;
  montar: (grande: string) => DadosBraspagLimites;
  ler: (r: DadosBraspagLimites) => string | undefined;
};

const base = entrada();
const enderecoGrande = (campo: keyof typeof ENDERECO, grande: string, qual: "billing" | "delivery") => {
  const end = { ...ENDERECO, [campo]: grande };
  return entrada({
    customer: {
      ...base.customer,
      billingAddress: qual === "billing" ? end : { ...ENDERECO },
      deliveryAddress: qual === "delivery" ? end : { ...ENDERECO },
    },
  });
};

const CASOS: CasoLimite[] = [
  {
    campo: "MerchantOrderId",
    caminho: "MerchantOrderId",
    montar: (g) => ({ ...base, orderId: g }),
    ler: (d) => d.orderId,
  },
  {
    campo: "Customer.Name",
    caminho: "Customer.Name",
    montar: (g) => entrada({ customer: { ...base.customer, name: g } }),
    ler: (d) => d.customer.name,
  },
  {
    campo: "Customer.Identity",
    caminho: "Customer.Identity",
    montar: (g) => entrada({ customer: { ...base.customer, identity: g.replace(/\D/g, "9") } }),
    ler: (d) => d.customer.identity,
  },
  {
    campo: "Customer.Email",
    caminho: "Customer.Email",
    montar: (g) => entrada({ customer: { ...base.customer, email: `${g}@exemplo.com` } }),
    ler: (d) => d.customer.email,
  },
  {
    campo: "Customer.Phone",
    caminho: "Customer.Phone",
    montar: (g) => entrada({ customer: { ...base.customer, phone: g.replace(/\D/g, "9") } }),
    ler: (d) => d.customer.phone,
  },
  {
    campo: "Customer.Birthdate",
    caminho: "Customer.Birthdate",
    montar: (g) => entrada({ customer: { ...base.customer, birthdate: g } }),
    ler: (d) => d.customer.birthdate,
  },
  {
    campo: "Customer.IpAddress",
    caminho: "Customer.IpAddress",
    montar: (g) => entrada({ customer: { ...base.customer, ipAddress: g } }),
    ler: (d) => d.customer.ipAddress,
  },
  {
    campo: "FraudAnalysis.FingerPrintId",
    caminho: "Payment.FraudAnalysis.FingerPrintId",
    montar: (g) => entrada({ fraud: { ...base.fraud!, browserFingerprint: g } }),
    ler: (d) => d.fraud?.browserFingerprint,
  },
  {
    campo: "FraudAnalysis.Browser.HostName",
    caminho: "Payment.FraudAnalysis.Browser.HostName",
    montar: (g) => entrada({ fraud: { ...base.fraud!, hostName: g } }),
    ler: (d) => d.fraud?.hostName,
  },
  {
    campo: "FraudAnalysis.Cart.Items.Name",
    caminho: "Payment.FraudAnalysis.Cart.Items[0].Name",
    montar: (g) => entrada({ fraud: { ...base.fraud!, cartItems: [{ ...base.fraud!.cartItems[0], name: g }] } }),
    ler: (d) => d.fraud?.cartItems[0].name,
  },
  {
    campo: "FraudAnalysis.Cart.Items.Sku",
    caminho: "Payment.FraudAnalysis.Cart.Items[0].Sku",
    montar: (g) => entrada({ fraud: { ...base.fraud!, cartItems: [{ ...base.fraud!.cartItems[0], sku: g }] } }),
    ler: (d) => d.fraud?.cartItems[0].sku,
  },
  {
    campo: "FraudAnalysis.Cart.Items.Risk",
    caminho: "Payment.FraudAnalysis.Cart.Items[0].Risk",
    montar: (g) => entrada({ fraud: { ...base.fraud!, cartItems: [{ ...base.fraud!.cartItems[0], risk: g }] } }),
    ler: (d) => d.fraud?.cartItems[0].risk,
  },
  {
    campo: "FraudAnalysis.Cart.Items.Type",
    caminho: "Payment.FraudAnalysis.Cart.Items[0].Type",
    montar: (g) => entrada({ fraud: { ...base.fraud!, cartItems: [{ ...base.fraud!.cartItems[0], type: g }] } }),
    ler: (d) => d.fraud?.cartItems[0].type,
  },
  {
    campo: "FraudAnalysis.Shipping.Addressee",
    caminho: "Payment.FraudAnalysis.Shipping.Addressee",
    montar: (g) => entrada({ fraud: { ...base.fraud!, shipping: { ...base.fraud!.shipping, addressee: g } } }),
    ler: (d) => d.fraud?.shipping?.addressee,
  },
  {
    campo: "FraudAnalysis.Shipping.Method",
    caminho: "Payment.FraudAnalysis.Shipping.Method",
    montar: (g) => entrada({ fraud: { ...base.fraud!, shipping: { ...base.fraud!.shipping, method: g } } }),
    ler: (d) => d.fraud?.shipping?.method,
  },
  {
    campo: "FraudAnalysis.Shipping.Phone",
    caminho: "Payment.FraudAnalysis.Shipping.Phone",
    montar: (g) =>
      entrada({ fraud: { ...base.fraud!, shipping: { ...base.fraud!.shipping, phone: g.replace(/\D/g, "9") } } }),
    ler: (d) => d.fraud?.shipping?.phone,
  },
  {
    campo: "FraudAnalysis.MerchantDefinedFields.Value",
    caminho: "Payment.FraudAnalysis.MerchantDefinedFields[0].Value",
    montar: (g) => entrada({ fraud: { ...base.fraud!, merchantDefinedFields: [{ Id: 1, Value: g }] } }),
    ler: (d) => d.fraud?.merchantDefinedFields?.[0].Value,
  },
];

// Os dois endereços têm os mesmos campos e o mesmo limite; o Shipping que a
// Cybersource valida nasce do DeliveryAddress, então os dois são cobertos.
for (const qual of ["billing", "delivery"] as const) {
  const prefixo = qual === "billing" ? "Customer.BillingAddress" : "Customer.DeliveryAddress";
  const campos: Array<[keyof typeof ENDERECO, keyof typeof LIMITES_BRASPAG]> = [
    ["Street", "Address.Street"],
    ["Number", "Address.Number"],
    ["Complement", "Address.Complement"],
    ["ZipCode", "Address.ZipCode"],
    ["City", "Address.City"],
    ["State", "Address.State"],
    ["District", "Address.District"],
  ];
  for (const [nome, campo] of campos) {
    CASOS.push({
      campo,
      caminho: `${prefixo}.${nome}`,
      montar: (g) => enderecoGrande(nome, campo === "Address.ZipCode" ? g.replace(/\D/g, "9") : g, qual),
      ler: (d) => (qual === "billing" ? d.customer.billingAddress : d.customer.deliveryAddress)?.[nome],
    });
  }
}

describe("AF3 — todo campo da tabela respeita o limite", () => {
  it.each(CASOS.map((c) => [c.caminho, c] as const))("%s", (_nome, caso) => {
    const limite = LIMITES_BRASPAG[caso.campo];
    // Valor com o dobro do limite, sem espaços: nada além do corte o encurta.
    const grande = "x".repeat(limite * 2);
    const r = ajustarLimitesBraspag(caso.montar(grande));
    const valor = caso.ler(r.dados);
    expect(valor).toBeDefined();
    expect(valor!.length).toBeLessThanOrEqual(limite);
    expect(r.ajustes.some((a) => a.campo === caso.caminho)).toBe(true);
  });

  it("nenhum campo da tabela ficou sem caso de teste", () => {
    const cobertos = new Set(CASOS.map((c) => c.campo));
    // Browser.Email, Browser.IpAddress e Browser.Type reusam valores de
    // Customer (mesmos limites) ou são constantes — cobertos na parte 2.
    const derivados = new Set([
      "FraudAnalysis.Browser.Email",
      "FraudAnalysis.Browser.IpAddress",
      "FraudAnalysis.Browser.Type",
    ]);
    const faltando = Object.keys(LIMITES_BRASPAG).filter((c) => !cobertos.has(c as never) && !derivados.has(c));
    expect(faltando).toEqual([]);
  });

  it("valores dentro do limite não geram ajuste", () => {
    expect(ajustarLimitesBraspag(entrada()).ajustes).toEqual([]);
  });

  it("Country fica fora do corte: enviamos 'BRA', como nas transações aprovadas", () => {
    const r = ajustarLimitesBraspag(entrada());
    expect(r.dados.customer.billingAddress!.Country).toBe("BRA");
    expect(r.dados.customer.deliveryAddress!.Country).toBe("BRA");
    expect(r.ajustes.some((a) => a.campo.endsWith(".Country"))).toBe(false);
  });
});

describe("AF3 — o registro de ajuste não carrega dado pessoal", () => {
  it("só nome do campo e tamanhos", () => {
    const pessoais = {
      name: "Maria Aparecida da Silva Sauro de Albuquerque Cavalcanti Rodrigues Nogueira Feitosa",
      email: "maria.aparecida.da.silva.sauro.de.albuquerque@um-dominio-bem-comprido.com.br",
      complemento: "Apartamento 406 bloco 1 fundos ao lado da portaria principal",
      rua: "Avenida Presidente Getulio Dornelles Vargas Filho de Sao Lourenco do Sul",
    };
    const r = ajustarLimitesBraspag(
      entrada({
        customer: {
          ...base.customer,
          name: pessoais.name,
          email: pessoais.email,
          billingAddress: { ...ENDERECO, Complement: pessoais.complemento, Street: pessoais.rua },
          deliveryAddress: { ...ENDERECO, Complement: pessoais.complemento, Street: pessoais.rua },
        },
      }),
    );
    expect(r.ajustes.length).toBeGreaterThan(0);
    const registro = JSON.stringify(r.ajustes);
    for (const valor of Object.values(pessoais)) {
      // Nem o valor inteiro nem um pedaço reconhecível dele.
      expect(registro).not.toContain(valor);
      expect(registro).not.toContain(valor.slice(0, 12));
    }
    for (const a of r.ajustes) {
      expect(Object.keys(a).sort()).toEqual(["campo", "de", "para"]);
      expect(typeof a.de).toBe("number");
      expect(typeof a.para).toBe("number");
    }
  });
});

// ===========================================================================
// Parte 2 — ponta a ponta pela rota de crédito: o que SAI no corpo da Braspag.
// ===========================================================================

const DRAFT_ID = "draft-af3";
const NOME = "Maria Aparecida";
const SOBRENOME = "da Silva";
const EMAIL = "maria@exemplo.com.br";
const CPF = "12345678909";
const TELEFONE = "35999999999";

function semearDraft() {
  redis.kv.set(
    `draft:${DRAFT_ID}`,
    JSON.stringify({
      id: DRAFT_ID,
      propertyId: "solarium-1",
      propertyName: "Solarium 1",
      checkin: "2026-10-10",
      checkout: "2026-10-12",
      nights: 2,
      guests: 2,
      finalTotal: 1000,
      totalPrice: 1000,
      guestFirstName: NOME,
      guestLastName: SOBRENOME,
      guestEmail: EMAIL,
      guestPhone: TELEFONE,
      guestCpf: CPF,
      paymentMethod: "card",
      status: "pending",
      createdAt: "2026-09-21T00:00:00Z",
      expiresAt: "2026-09-21T02:00:00Z",
    }),
  );
}

function capturarAutorizacao(): { payload: Record<string, unknown> | null } {
  const box: { payload: Record<string, unknown> | null } = { payload: null };
  const resposta = (corpo: unknown) =>
    new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/v2/sales/")) {
        box.payload = JSON.parse(String(init?.body));
        return resposta({
          Payment: { PaymentId: "pay-1", Status: 1, ReturnCode: "00", FraudAnalysis: { Id: "af-1", Status: 1 } },
        });
      }
      if (u.includes("/capture")) return resposta({ Status: 2, ReturnCode: "6" });
      if (u.includes("/void")) return resposta({ Status: 10 });
      throw new Error("URL inesperada: " + u);
    }),
  );
  return box;
}

function requisicao(billing: Record<string, string>): Request {
  return new Request("https://solarium.test/api/payments/braspag/credit", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "200.1.2.3", host: "solarium.test" },
    body: JSON.stringify({
      draftId: DRAFT_ID,
      cardNumber: "4111111111111111",
      cardHolder: `${NOME} ${SOBRENOME}`,
      cardExpiration: "12/2030",
      cardCvv: "123",
      installments: 1,
      browserFingerprint: "a".repeat(32),
      externalAuthentication: { Cavv: "cavv", Xid: "xid", Eci: "05", Version: "2.2.0", ReferenceId: "ref" },
      billing,
    }),
  });
}

const BILLING_OK = {
  street: "Rua das Palmeiras",
  number: "406",
  neighborhood: "Centro",
  city: "Itanhandu",
  state: "MG",
  zipCode: "37464000",
};

// Duas linhas saem com o prefixo `[Braspag:authorize-result]`: a do cliente
// (src/lib/braspag.ts) e a da rota, que é a que vai para o authlog persistido.
// Só a da rota traz `fingerprintId`.
function authlog(linhas: string[]): string {
  const linha = linhas.find(
    (l) => l.startsWith("[Braspag:authorize-result]") && l.includes('"fingerprintId"'),
  );
  expect(linha, "linha do authlog da rota").toBeDefined();
  return linha!.replace("[Braspag:authorize-result] ", "");
}

type Corpo = {
  MerchantOrderId: string;
  Customer: Record<string, Record<string, string> | string>;
  Payment: { FraudAnalysis: Record<string, Record<string, unknown>> };
};

describe("AF3 — rota de crédito: o corpo que vai à Braspag", () => {
  beforeEach(() => {
    redis.kv.clear();
    mocks.createHostawayReservation.mockClear();
    semearDraft();
    process.env.PAYMENT_PROVIDER = "braspag";
    process.env.BRASPAG_ENVIRONMENT = "sandbox";
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("o caso de 22/09 passa: Complement cabe em 14 nos dois endereços", async () => {
    const box = capturarAutorizacao();
    const res = await POST(requisicao({ ...BILLING_OK, complement: "Apto 406 bloco 1" }));
    expect(res.status).toBe(200);

    const corpo = box.payload as unknown as Corpo;
    const cobranca = corpo.Customer.BillingAddress as Record<string, string>;
    const entrega = corpo.Customer.DeliveryAddress as Record<string, string>;
    expect(cobranca.Complement).toBe("Ap 406 Bl 1");
    expect(entrega.Complement).toBe("Ap 406 Bl 1");
    expect(entrega.Complement.length).toBeLessThanOrEqual(14);
  });

  it("nenhum campo do corpo passa do limite, mesmo com tudo grande demais", async () => {
    const box = capturarAutorizacao();
    const res = await POST(
      requisicao({
        street: "Avenida Presidente Getulio Dornelles Vargas Filho de Sao Lourenco do Sul do Norte",
        number: "1234567",
        complement: "Fundos do galpao azul ao lado da portaria principal",
        neighborhood: "Jardim Residencial das Acacias Amarelas do Vale Encantado do Rio Verde",
        city: "Sao Jose do Rio Preto da Serra da Mantiqueira do Sul de Minas Gerais",
        state: "MG",
        zipCode: "37464-000",
      }),
    );
    expect(res.status).toBe(200);

    const corpo = box.payload as unknown as Corpo;
    const limites: Array<[string, number]> = [
      ["MerchantOrderId", LIMITES_BRASPAG.MerchantOrderId],
      ["Customer.Name", LIMITES_BRASPAG["Customer.Name"]],
      ["Customer.Identity", LIMITES_BRASPAG["Customer.Identity"]],
      ["Customer.Email", LIMITES_BRASPAG["Customer.Email"]],
      ["Customer.IpAddress", LIMITES_BRASPAG["Customer.IpAddress"]],
      ["Customer.Phone", LIMITES_BRASPAG["Customer.Phone"]],
    ];
    const ler = (caminho: string) =>
      caminho.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], corpo);
    for (const [caminho, limite] of limites) {
      expect(String(ler(caminho)).length, caminho).toBeLessThanOrEqual(limite);
    }
    for (const bloco of ["BillingAddress", "DeliveryAddress"]) {
      const end = corpo.Customer[bloco] as Record<string, string>;
      expect(end.Street.length, `${bloco}.Street`).toBeLessThanOrEqual(LIMITES_BRASPAG["Address.Street"]);
      expect(end.Number.length, `${bloco}.Number`).toBeLessThanOrEqual(LIMITES_BRASPAG["Address.Number"]);
      expect(end.Complement.length, `${bloco}.Complement`).toBeLessThanOrEqual(
        LIMITES_BRASPAG["Address.Complement"],
      );
      expect(end.ZipCode, `${bloco}.ZipCode`).toBe("37464000");
      expect(end.City.length, `${bloco}.City`).toBeLessThanOrEqual(LIMITES_BRASPAG["Address.City"]);
      expect(end.State.length, `${bloco}.State`).toBeLessThanOrEqual(LIMITES_BRASPAG["Address.State"]);
      expect(end.District.length, `${bloco}.District`).toBeLessThanOrEqual(LIMITES_BRASPAG["Address.District"]);
    }
    // Campos do FraudAnalysis que reusam valores já ajustados de Customer.
    const fa = corpo.Payment.FraudAnalysis;
    const browser = fa.Browser as Record<string, string>;
    expect(browser.Email.length).toBeLessThanOrEqual(LIMITES_BRASPAG["FraudAnalysis.Browser.Email"]);
    expect(browser.HostName.length).toBeLessThanOrEqual(LIMITES_BRASPAG["FraudAnalysis.Browser.HostName"]);
    expect(browser.IpAddress.length).toBeLessThanOrEqual(LIMITES_BRASPAG["FraudAnalysis.Browser.IpAddress"]);
    expect(browser.Type.length).toBeLessThanOrEqual(LIMITES_BRASPAG["FraudAnalysis.Browser.Type"]);
    const shipping = fa.Shipping as Record<string, string>;
    expect(shipping.Addressee.length).toBeLessThanOrEqual(LIMITES_BRASPAG["FraudAnalysis.Shipping.Addressee"]);
    expect(shipping.Method.length).toBeLessThanOrEqual(LIMITES_BRASPAG["FraudAnalysis.Shipping.Method"]);
    expect(shipping.Phone.length).toBeLessThanOrEqual(LIMITES_BRASPAG["FraudAnalysis.Shipping.Phone"]);
    const item = (fa.Cart.Items as Array<Record<string, string>>)[0];
    expect(item.Name.length).toBeLessThanOrEqual(LIMITES_BRASPAG["FraudAnalysis.Cart.Items.Name"]);
    expect(item.Sku.length).toBeLessThanOrEqual(LIMITES_BRASPAG["FraudAnalysis.Cart.Items.Sku"]);
  });

  it("o rascunho e o que vai ao Hostaway ficam como o hóspede digitou", async () => {
    capturarAutorizacao();
    await POST(requisicao({ ...BILLING_OK, complement: "Apto 406 bloco 1" }));

    const draft = await getDraft(DRAFT_ID);
    expect(draft?.guestFirstName).toBe(NOME);
    expect(draft?.guestLastName).toBe(SOBRENOME);
    expect(draft?.guestEmail).toBe(EMAIL);
    expect(draft?.guestPhone).toBe(TELEFONE);
    expect(draft?.guestCpf).toBe(CPF);

    expect(mocks.createHostawayReservation).toHaveBeenCalledTimes(1);
    const params = mocks.createHostawayReservation.mock.calls[0][0] as unknown as Record<string, string>;
    expect(params.guestFirstName).toBe(NOME);
    expect(params.guestLastName).toBe(SOBRENOME);
    expect(params.guestEmail).toBe(EMAIL);
    expect(params.phone).toBe(TELEFONE);
  });

  it("o authlog registra os campos ajustados sem nenhum dado pessoal", async () => {
    const linhas: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void linhas.push(a.join(" ")));
    capturarAutorizacao();
    const complemento = "Fundos do galpao azul ao lado da portaria";
    await POST(requisicao({ ...BILLING_OK, complement: complemento }));

    const log = JSON.parse(authlog(linhas)) as {
      camposAjustados: Array<{ campo: string; de: number; para: number }> | null;
    };
    expect(log.camposAjustados).toEqual(
      expect.arrayContaining([
        { campo: "Customer.BillingAddress.Complement", de: complemento.length, para: 14 },
        { campo: "Customer.DeliveryAddress.Complement", de: complemento.length, para: 14 },
      ]),
    );
    const registro = JSON.stringify(log.camposAjustados);
    for (const pessoal of [complemento, NOME, SOBRENOME, EMAIL, CPF, TELEFONE, "4111"]) {
      expect(registro).not.toContain(pessoal);
    }
  });

  it("sem nada acima do limite, o authlog não inventa ajuste", async () => {
    const linhas: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void linhas.push(a.join(" ")));
    capturarAutorizacao();
    await POST(requisicao({ ...BILLING_OK, complement: "Apto 406" }));

    expect(JSON.parse(authlog(linhas)).camposAjustados).toBeNull();
  });
});
