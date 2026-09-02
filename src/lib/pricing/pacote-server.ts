/**
 * Camada de I/O do motor de pacotes. Busca tarifa e disponibilidade na Hostaway,
 * injeta no motor puro e devolve o resultado autoritativo.
 *
 * Nada que venha do cliente é aceito como preço. O cliente manda datas, hóspedes,
 * itens removidos e extras escolhidos; todo o resto é recalculado aqui.
 */

import { unstable_cache } from "next/cache";
import { calculatePriceDetailed, getCalendar, type HostawayPriceFailure } from "@/lib/hostaway";
import {
  datasElegiveis,
  totalDoPacote,
  noitesDoPacote,
  motorDoPacote,
  checkoutParaChegada,
} from "./elegibilidade";
import { chegadaPermitida } from "./restricoes-chegada";
import { listingsForProperty } from "@/config/operational-extras";
import { getPropertyBySlug } from "@/config/properties";
import { PacoteV2, JANELA_CANCELAMENTO_EXTRAS_DIAS } from "@/config/precos-e-extras";
import { dataLimiteCancelamentoExtras, EntradaMotor, ResultadoMotor } from "./pacotes";
import { montarItens, lateCheckoutAtivo, validarDatasPacote, SelecaoExtras } from "./extras";

export type EntradaPacoteServer = {
  pacote: PacoteV2;
  propertySlug: string;
  propertyId: number;
  checkin: string;
  checkout: string;
  guests: number;
  removidos: string[];
  selecao: SelecaoExtras;
};

export type ResultadoPacoteServer =
  | {
      ok: true;
      resultado: ResultadoMotor;
      entrada: EntradaMotor;
      economia: number;
      bonusMotivo: string;
      dataLimiteCancelamentoExtras: string;
    }
  | {
      ok: false;
      erro: string;
      status: number;
      /** Caminho concreto quando existe: outra casa livre ou a próxima data livre. */
      alternativa?: { rotulo: string; href: string };
      /**
       * Mais de um caminho, quando existe mais de um.
       *
       * A chegada bloqueada pode ter véspera E dia seguinte livres; oferecer só
       * um dos dois esconde metade da saída. Quem renderiza mostra todos.
       */
      alternativas?: { rotulo: string; href: string }[];
    };

/** Dia seguinte a uma data ISO. */
function diaSeguinte(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Noite livre em TODAS as listings da casa (o Completo ocupa as duas). */
async function noiteLivre(propertySlug: string, noite: string): Promise<boolean> {
  const listings = listingsForProperty(propertySlug);
  if (listings.length === 0) return false;
  const checks = await Promise.all(
    listings.map(async (id) => {
      const dias = await getCalendar(id, noite, noite);
      return dias.length > 0 && dias.every((d) => d.isAvailable === 1);
    }),
  );
  return checks.every(Boolean);
}

export async function calcularPacoteServer(
  input: EntradaPacoteServer,
): Promise<ResultadoPacoteServer> {
  const { pacote, propertySlug, propertyId, checkin, checkout, guests, removidos, selecao } = input;

  // Mesma porta que o varredor do "a partir de" e o calendário usam.
  const eleg = datasElegiveis(pacote.slug, propertySlug, checkin, checkout);
  if (!eleg.elegivel) return { ok: false, erro: eleg.motivo, status: 400 };

  // A Hostaway responde 502/timeout de vez em quando. Uma segunda tentativa
  // resolve a maioria; sem ela o hóspede via erro cru na tela do pacote.
  // `Detailed` porque o MOTIVO importa: noite vendida, mínimo de noites da data
  // e falha de API pedem respostas diferentes. Antes tudo virava "erro técnico".
  // Só falha de API merece segunda tentativa: noite vendida e mínimo de noites
  // são respostas estáveis, e repetir só atrasa a tela.
  const opcoes = { ignorarMinimoDeNoites: pacote.ignorarMinimoPMS === true };
  const cotacao = await comRetry(async () => {
    const r = await calculatePriceDetailed(propertyId, checkin, checkout, guests, opcoes);
    return "failure" in r && r.failure.reason === "api-error" ? null : r;
  });
  const resposta =
    cotacao ?? (await calculatePriceDetailed(propertyId, checkin, checkout, guests, opcoes));
  if ("failure" in resposta) {
    return await diagnosticarSemPreco(input, resposta.failure);
  }
  const quote = resposta.quote;

  // Itens só para saber se o late sobreviveu: é ele que decide se vale consultar
  // o calendário da noite seguinte. O preço em si é montado uma única vez, em
  // `totalDoPacote`.
  const lateAtivo = lateCheckoutAtivo(
    montarItens({ pacote, propertySlug, checkin, checkout, removidos, selecao }),
  );
  const noiteSeguinteLivre = lateAtivo ? await noiteLivre(propertySlug, diaSeguinte(checkout)) : false;

  // MESMA função de preço que o varredor do "a partir de" usa.
  //
  // Aqui existia uma segunda montagem do resultado, e ela esquecia o ajuste de
  // taxa por dia de saída: a saída de sábado do Final de Ano saía com a taxa
  // cheia na tela e no draft, enquanto o varredor aplicava o ajuste. Preço não
  // pode ter dois donos.
  const calc = totalDoPacote({
    slug: pacote.slug,
    propertySlug,
    checkin,
    checkout,
    hostawayTotal: quote.totalPrice,
    noites: quote.nights,
    noiteSeguinteLivre,
    removidos,
    selecao,
    absorvido: valorAbsorvido(pacote, quote, guests),
  });

  if (!calc?.resultado || !calc.entrada) {
    return { ok: false, erro: FALHA_TECNICA, status: 502 };
  }

  return {
    ok: true,
    resultado: calc.resultado,
    entrada: calc.entrada,
    // Economia = Valor total riscado − TOTAL. Fonte única: o motor.
    economia: calc.resultado.economia,
    bonusMotivo: calc.bonusMotivo ?? "",
    dataLimiteCancelamentoExtras: dataLimiteCancelamentoExtras(
      checkin,
      JANELA_CANCELAMENTO_EXTRAS_DIAS,
    ),
  };
}

// ---------------------------------------------------------------------------
// SEM PREÇO: ocupado nesta casa, ocupado em todas, ou falha técnica
// ---------------------------------------------------------------------------

const FALHA_TECNICA =
  "Não conseguimos calcular o preço agora. Tente de novo em instantes ou fale com o concierge.";

type Disponibilidade = "livre" | "ocupada" | "desconhecida";

/**
 * O calendário é a autoridade sobre estar vendido ou não.
 *
 * `desconhecida` é resposta legítima: calendário vazio ou API fora. Nesse caso a
 * tela volta a falar de erro técnico, que é a verdade.
 */
async function estadiaDisponivel(
  propertySlug: string,
  checkin: string,
  checkout: string,
): Promise<Disponibilidade> {
  const listings = listingsForProperty(propertySlug);
  if (listings.length === 0) return "desconhecida";

  // O check-out não é noite; a última noite é a véspera.
  const ultimaNoite = somarDias(checkout, -1);
  if (ultimaNoite < checkin) return "desconhecida";

  try {
    const calendarios = await Promise.all(
      listings.map((id) => getCalendar(id, checkin, ultimaNoite)),
    );
    if (calendarios.some((c) => c.length === 0)) return "desconhecida";
    const livre = calendarios.every((c) => c.every((d) => d.isAvailable === 1));
    return livre ? "livre" : "ocupada";
  } catch (err) {
    console.error("[pacote-server] calendário indisponível na checagem:", err);
    return "desconhecida";
  }
}

/**
 * Véspera e dia seguinte que REALMENTE dariam para reservar.
 *
 * "Escolha outra data" sem dizer qual joga o trabalho de volta no hóspede, que
 * não tem como saber quais domingos a casa abre — a restrição é um calendário do
 * PMS, não uma regra de dia da semana (o Sol 2 libera 1 dos 8 domingos medidos).
 *
 * Uma vizinha só é oferecida se passar nas TRÊS portas: o pacote aceita o par, a
 * Hostaway aceita a chegada, e as noites estão livres. Sugerir uma data que
 * falha na etapa seguinte é pior que não sugerir — o hóspede clica e leva outra
 * recusa.
 */
async function chegadasVizinhasViaveis(
  input: EntradaPacoteServer,
): Promise<{ checkin: string; alternativa: { rotulo: string; href: string } }[]> {
  const { pacote, propertySlug, checkin, checkout, guests } = input;

  const noites = Math.round(
    (new Date(checkout + "T12:00:00").getTime() - new Date(checkin + "T12:00:00").getTime()) /
      86400000,
  );

  // Véspera antes do dia seguinte: adiantar a viagem costuma ser mais fácil que
  // adiá-la, e a ordem é a ordem em que aparecem na tela.
  const candidatas = [somarDias(checkin, -1), somarDias(checkin, 1)].filter(
    (d) => d >= new Date().toISOString().slice(0, 10),
  );

  const viaveis: { checkin: string; alternativa: { rotulo: string; href: string } }[] = [];

  for (const ci of candidatas) {
    // 1) O pacote fecha com esta chegada? Preserva a duração que o hóspede já
    //    tinha escolhido; se não fechar, o helper procura outra válida.
    const co = checkoutParaChegada(pacote.slug, propertySlug, ci, noites);
    if (!co) continue;

    // 2) A Hostaway aceita chegada neste dia? Mesma função que o draft e a
    //    revalidação usam — restrição de chegada tem um dono só.
    let chegada: Awaited<ReturnType<typeof chegadaPermitida>>;
    try {
      chegada = await chegadaPermitida(propertySlug, ci);
    } catch {
      continue;
    }
    if (!chegada.permitida) continue;

    // 3) As noites estão mesmo livres?
    if ((await estadiaDisponivel(propertySlug, ci, co)) !== "livre") continue;

    viaveis.push({
      checkin: ci,
      alternativa: {
        rotulo: `Chegar em ${formatarDia(ci)} (saída em ${formatarDia(co)})`,
        href: linkDoPacote(pacote.slug, propertySlug, ci, co, guests),
      },
    });
  }

  return viaveis;
}

/** "2 de janeiro" — para mensagem, nunca para cálculo. */
function formatarDia(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
  });
}

function linkDoPacote(
  slug: string,
  casa: string,
  checkin: string,
  checkout: string,
  guests: number,
): string {
  return `/pacotes/${slug}?checkin=${checkin}&checkout=${checkout}&casa=${casa}&guests=${guests}`;
}

async function diagnosticarSemPreco(
  input: EntradaPacoteServer,
  falha?: HostawayPriceFailure,
): Promise<ResultadoPacoteServer> {
  const { pacote, propertySlug, checkin, checkout, guests } = input;

  // Mínimo de noites da data de chegada: a estadia é válida para o pacote, mas
  // curta demais para o que a tarifa daquela chegada exige. Dizer "erro técnico"
  // aqui é o que impede a venda — o cliente só precisa saber quantas noites.
  if (falha?.reason === "min-stay-not-met") {
    const minimo = Number(falha.meta?.minimumStay ?? 0);
    const alvo = minimo > 0 ? somarDias(checkin, minimo) : null;
    const alvoElegivel =
      alvo && datasElegiveis(pacote.slug, propertySlug, checkin, alvo).elegivel ? alvo : null;

    return {
      ok: false,
      status: 200,
      erro:
        minimo > 0
          ? `A chegada em ${formatarDia(checkin)} exige no mínimo ${minimo} noites.`
          : falha.message,
      alternativa: alvoElegivel
        ? {
            rotulo: `Ver com saída em ${formatarDia(alvoElegivel)}`,
            href: linkDoPacote(pacote.slug, propertySlug, checkin, alvoElegivel, guests),
          }
        : undefined,
    };
  }

  // CHEGADA FECHADA NO PMS.
  //
  // Este caso caía no `FALHA_TECNICA` lá embaixo: as datas estão LIVRES, então
  // `estadiaDisponivel` respondia "livre", que não é "ocupada", e a tela dizia
  // "Não conseguimos calcular o preço agora. Tente de novo em instantes". O
  // hóspede lia falha temporária do site e tentava de novo — para sempre. A
  // recusa é permanente e tem um motivo que ele precisa entender: é o dia da
  // semana. A mensagem já vem pronta de `mensagemChegadaBloqueada()`, dentro de
  // `falha.message`; só nunca chegava até aqui.
  if (falha?.reason === "closed-on-arrival") {
    const vizinhas = await chegadasVizinhasViaveis(input);
    console.log(
      `[Pacote] chegada bloqueada ${checkin} (${pacote.slug}/${propertySlug}) — ` +
        `vizinhas viáveis: ${vizinhas.map((v) => v.checkin).join(", ") || "nenhuma"}`,
    );
    return {
      ok: false,
      status: 200,
      erro: falha.message,
      alternativa: vizinhas[0]?.alternativa,
      alternativas: vizinhas.map((v) => v.alternativa),
    };
  }

  const disp = await estadiaDisponivel(propertySlug, checkin, checkout);
  if (disp !== "ocupada") {
    return { ok: false, erro: FALHA_TECNICA, status: 502 };
  }

  const nomeDaCasa = (slug: string) => getPropertyBySlug(slug)?.name ?? "esta casa";
  const ocupada = `Estas datas já estão reservadas no ${nomeDaCasa(propertySlug)}.`;

  // 1) A mesma data, na outra casa do pacote. É a troca mais barata para o
  //    hóspede: nada de reescolher período.
  for (const outra of pacote.properties) {
    if (outra === propertySlug) continue;
    if (!datasElegiveis(pacote.slug, outra, checkin, checkout).elegivel) continue;
    if ((await estadiaDisponivel(outra, checkin, checkout)) !== "livre") continue;

    return {
      ok: false,
      status: 200,
      erro: ocupada,
      alternativa: {
        rotulo: `Ver no ${nomeDaCasa(outra)}`,
        href: linkDoPacote(pacote.slug, outra, checkin, checkout, guests),
      },
    };
  }

  // 2) Nenhuma casa livre nessas datas: a próxima data que fecha o pacote E está
  //    livre, com link pronto.
  const prox = await proximaDataLivreDoPacote(pacote.slug, propertySlug, checkin);
  if (prox) {
    return {
      ok: false,
      status: 200,
      erro: "Estas datas já estão reservadas nas duas casas.",
      alternativa: {
        rotulo: "Ver a próxima data livre deste pacote",
        href: linkDoPacote(pacote.slug, propertySlug, prox.checkin, prox.checkout, guests),
      },
    };
  }

  return {
    ok: false,
    status: 200,
    erro: `${ocupada} Fale com o concierge para procurarmos uma data.`,
  };
}

// ---------------------------------------------------------------------------
// "A PARTIR DE" — mínimo dos próximos 90 dias, cacheado
// ---------------------------------------------------------------------------

const JANELA_A_PARTIR_DE_DIAS = 90;
const TTL_A_PARTIR_DE = 60 * 60; // 60 min

export type MinimoPacote =
  | { total: number; checkin: string; checkout: string }
  | { total: null; motivo: string };

/**
 * "A partir de": o menor total que a PRÓPRIA PÁGINA do pacote exibiria.
 *
 * Varre os próximos 90 dias, aceita apenas datas que `datasElegiveis` aprova —
 * a mesma função do calendário e do draft — e calcula com `totalDoPacote`, o
 * mesmo caminho de preço da página, seja motor V2 ou legado.
 *
 * Não existe cálculo próprio aqui. Se o número aparece no card, existe uma data
 * concreta em que reservar entrega exatamente ele.
 */
export function totalMinimoDoPacote(slug: string, propertySlug: string): Promise<MinimoPacote> {
  // Cache do PRÓPRIO Next, não Upstash.
  //
  // O SDK do Upstash faz `fetch` com `no-store`, e o Next proíbe isso dentro de
  // página com `revalidate`: derruba a geração estática com DYNAMIC_SERVER_USAGE
  // e quebra o build. O cache do Next dá o mesmo TTL sem tirar a home do estático.
  return unstable_cache(
    () => calcularMinimo(slug, propertySlug),
    ["pacotes:minimo", slug, propertySlug],
    { revalidate: TTL_A_PARTIR_DE, tags: ["pacotes-minimo"] },
  )();
}

type DataLivre = {
  checkin: string;
  checkout: string;
  hostawayTotal: number;
  noiteSeguinteLivre: boolean;
};

/**
 * Todas as datas do pacote que são elegíveis E têm as noites livres, em ordem.
 *
 * Fonte única de "quando dá para reservar este pacote": o "a partir de" pega o
 * menor preço desta lista e a mensagem de indisponibilidade pega a primeira
 * data. Duas telas, um varredor — se divergirem, divergem no mesmo lugar.
 */
async function datasLivresDoPacote(
  slug: string,
  propertySlug: string,
  aPartirDe: Date,
): Promise<{ ok: true; datas: DataLivre[] } | { ok: false; motivo: string }> {
  const noites = noitesDoPacote(slug);
  if (!noites) return { ok: false, motivo: "pacote-desconhecido" };

  const m = motorDoPacote(slug);
  const ignoraMinimo = m?.motor === "v2" && m.pacote.ignorarMinimoPMS === true;

  const listings = listingsForProperty(propertySlug);
  if (listings.length === 0) return { ok: false, motivo: "sem-listing" };

  const iso = (d: Date) => d.toISOString().slice(0, 10);

  // A varredura percorre a janela do PRÓPRIO pacote, não 90 dias fixos.
  //
  // Um sazonal de dezembro não é alcançado por uma janela contada de hoje, e o
  // resultado era um valor vindo de data não elegível — barato e inalcançável,
  // justamente no produto de maior demanda do ano.
  const janela = janelaDeVarredura(slug, aPartirDe);
  if (!janela) return { ok: false, motivo: "fora-da-temporada" };
  const { inicio, dias } = janela;

  // Uma semana a mais: o bônus de saída olha a noite seguinte ao check-out.
  const fim = new Date(inicio.getTime() + (dias + 8) * 86400000);

  let noitesCal: Map<string, { livre: boolean; preco: number; minimo: number }>;
  try {
    const calendarios = await Promise.all(
      listings.map((id) => getCalendar(id, iso(inicio), iso(fim))),
    );
    if (calendarios.some((c) => c.length === 0)) return { ok: false, motivo: "calendario-vazio" };
    noitesCal = combinarCalendarios(calendarios);
  } catch (err) {
    console.error("[datasLivresDoPacote] calendário indisponível:", err);
    return { ok: false, motivo: "calendario-indisponivel" };
  }

  const datas: DataLivre[] = [];

  for (let offset = 0; offset < dias; offset++) {
    const checkin = iso(new Date(inicio.getTime() + offset * 86400000));

    // A saída sai da REGRA do pacote, não de `chegada + noitesMin`.
    //
    // Somar o mínimo e filtrar depois não gerava data inválida — o filtro pegava
    // —, mas estreitava a oferta em silêncio: no Final de Ano, `checkin + 3` só
    // cai em dia de saída permitido quando a chegada é quarta, então quarta era
    // a ÚNICA chegada que o varredor conseguia anunciar, e a saída de domingo,
    // que é a do pacote, nunca aparecia. Perder oferta válida é tão caro quanto
    // anunciar oferta inválida.
    const checkout = checkoutParaChegada(slug, propertySlug, checkin);
    if (!checkout) continue;

    // Rede de segurança: o helper já devolve só par elegível, mas a checagem
    // fica — é a mesma porta que o calendário e o draft usam.
    if (!datasElegiveis(slug, propertySlug, checkin, checkout).elegivel) continue;

    const noitesDaEstadia = Math.round(
      (new Date(checkout + "T12:00:00").getTime() - new Date(checkin + "T12:00:00").getTime()) /
        86400000,
    );

    // Mínimo de noites da chegada: sugerir data que a Hostaway recusa na hora de
    // cotar é o mesmo que não sugerir nada. O pacote com `ignorarMinimoPMS` não
    // é recusado, então também não é filtrado aqui.
    const minimoDaChegada = noitesCal.get(checkin)?.minimo ?? 1;
    if (noitesDaEstadia < minimoDaChegada && !ignoraMinimo) continue;

    let hostawayTotal = 0;
    let completa = true;
    for (let n = 0; n < noitesDaEstadia; n++) {
      const noite = noitesCal.get(somarDias(checkin, n));
      if (!noite || !noite.livre) {
        completa = false;
        break;
      }
      hostawayTotal += noite.preco;
    }
    if (!completa) continue;

    datas.push({
      checkin,
      checkout,
      hostawayTotal,
      noiteSeguinteLivre: noitesCal.get(checkout)?.livre ?? false,
    });
  }

  return { ok: true, datas };
}

/**
 * Primeira data DEPOIS de `aPartirDe` em que o pacote fecha e as noites estão
 * livres. É o que a tela oferece quando as datas pedidas já foram vendidas.
 */
export async function proximaDataLivreDoPacote(
  slug: string,
  propertySlug: string,
  aPartirDe: string,
): Promise<{ checkin: string; checkout: string } | null> {
  const datas = await datasLivresProximas(slug, propertySlug, aPartirDe, 1);
  if (datas.length === 0) return null;
  const { checkin, checkout } = datas[0];
  return { checkin, checkout };
}

/**
 * Próximas datas em que o pacote fecha E está livre, em ordem, a partir do dia
 * seguinte a `aPartirDe`.
 *
 * Um varredor só para as três perguntas: o menor preço do card, a próxima data
 * quando as pedidas estão vendidas, e o próximo período equivalente na busca.
 */
export async function datasLivresProximas(
  slug: string,
  propertySlug: string,
  aPartirDe: string,
  limite: number,
): Promise<{ checkin: string; checkout: string }[]> {
  const inicio = new Date(aPartirDe + "T12:00:00");
  inicio.setDate(inicio.getDate() + 1);

  const r = await datasLivresDoPacote(slug, propertySlug, inicio);
  if (!r.ok) return [];
  return r.datas.slice(0, limite).map(({ checkin, checkout }) => ({ checkin, checkout }));
}

async function calcularMinimo(slug: string, propertySlug: string): Promise<MinimoPacote> {
  const noites = noitesDoPacote(slug);
  if (!noites) return { total: null, motivo: "pacote-desconhecido" };

  const r = await datasLivresDoPacote(slug, propertySlug, new Date());
  if (!r.ok) return { total: null, motivo: r.motivo };

  let melhor: MinimoPacote = { total: null, motivo: "sem-data-elegivel-livre" };

  for (const d of r.datas) {
    // MESMO caminho de preço da página.
    const calc = totalDoPacote({
      slug,
      propertySlug,
      checkin: d.checkin,
      checkout: d.checkout,
      hostawayTotal: d.hostawayTotal,
      noites,
      noiteSeguinteLivre: d.noiteSeguinteLivre,
    });
    if (!calc) continue;

    if (melhor.total === null || calc.total < melhor.total) {
      melhor = { total: calc.total, checkin: d.checkin, checkout: d.checkout };
    }
  }

  return melhor;
}

/**
 * Funde os calendários das listings numa linha do tempo só.
 *
 * O Solarium Completo ocupa as duas casas: a noite só está livre se estiver livre
 * nas duas, e o preço é a soma. Casa individual passa direto.
 */
function combinarCalendarios(
  calendarios: { date: string; isAvailable: number; price: number; minimumStay?: number }[][],
): Map<string, { livre: boolean; preco: number; minimo: number }> {
  const mapa = new Map<string, { livre: boolean; preco: number; minimo: number }>();

  for (const dia of calendarios[0]) {
    const outras = calendarios.slice(1).map((c) => c.find((d) => d.date === dia.date));
    if (outras.some((o) => !o)) continue;

    const livre = dia.isAvailable === 1 && outras.every((o) => o!.isAvailable === 1);
    const preco =
      (Number.isFinite(dia.price) ? dia.price : 0) +
      outras.reduce((soma, o) => soma + (Number.isFinite(o!.price) ? o!.price : 0), 0);

    // O mínimo de noites é o mais restritivo entre as listings — o Completo só
    // fecha se as duas aceitarem.
    const minimo = Math.max(
      Number(dia.minimumStay ?? 1),
      ...outras.map((o) => Number(o!.minimumStay ?? 1)),
    );

    mapa.set(dia.date, { livre, preco, minimo });
  }
  return mapa;
}

function somarDias(iso: string, dias: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}


/**
 * Duas tentativas com uma pausa curta. A Hostaway falha de forma intermitente e
 * um erro cru na tela custa a reserva; repetir uma vez custa 400ms.
 */
async function comRetry<T>(fn: () => Promise<T | null>, tentativas = 2): Promise<T | null> {
  for (let i = 1; i <= tentativas; i++) {
    const r = await fn();
    if (r) return r;
    if (i < tentativas) {
      console.warn(`[pacote-server] tentativa ${i} falhou, repetindo`);
      await new Promise((res) => setTimeout(res, 400));
    }
  }
  return null;
}

/**
 * Taxa de hóspede adicional que o pacote absorve.
 *
 * O Dois Casais é vendido para quatro pessoas: o terceiro e o quarto hóspede
 * aparecem no Valor total pelo que a Hostaway cobra e voltam como desconto de
 * valor idêntico. Do quinto em diante, cobrança normal.
 *
 * O preço por pessoa vem da Hostaway em runtime — nunca escrito aqui.
 */
function valorAbsorvido(
  pacote: PacoteV2,
  quote: { nights: number; raw?: unknown },
  guests: number,
): number {
  const ate = pacote.hospedesAbsorvidosAte;
  if (!ate) return 0;

  const fees = (quote.raw as { listingFees?: Record<string, number> } | undefined)?.listingFees;
  const inclusos = Number(fees?.guestsIncluded ?? 2);
  const porPessoa = Number(fees?.priceForExtraPerson ?? 0);
  if (!porPessoa) return 0;

  const absorvidos = Math.max(0, Math.min(guests, ate) - inclusos);
  return absorvidos * porPessoa * quote.nights;
}


/**
 * Janela que a varredura precisa percorrer para este pacote.
 *
 * Pacote sem sazonalidade: os próximos 90 dias. Pacote com janela de check-in
 * (Final de Ano): a própria janela, resolvida para a ocorrência mais próxima que
 * ainda não passou. Fora da temporada, devolve null — e o card mostra
 * "Consultar datas" em vez de um número de data não elegível.
 */
function janelaDeVarredura(
  slug: string,
  hoje: Date,
): { inicio: Date; dias: number } | null {
  const m = motorDoPacote(slug);
  const janela = m?.motor === "v2" ? m.pacote.janelaCheckin : undefined;
  if (!janela) return { inicio: hoje, dias: JANELA_A_PARTIR_DE_DIAS };

  const ano = hoje.getFullYear();
  for (const a of [ano, ano + 1]) {
    const inicio = new Date(`${a}-${janela.de}T12:00:00`);
    const fim = new Date(`${janela.de <= janela.ate ? a : a + 1}-${janela.ate}T12:00:00`);
    if (fim < hoje) continue;
    const de = inicio < hoje ? hoje : inicio;
    const dias = Math.ceil((fim.getTime() - de.getTime()) / 86400000) + 1;
    if (dias > 0) return { inicio: de, dias };
  }
  return null;
}
