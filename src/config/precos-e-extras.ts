/**
 * FONTE ÚNICA DE CONFIGURAÇÃO — preços de menu, pacotes, taxa progressiva e bônus.
 *
 * Regra inegociável: NENHUMA DIÁRIA entra aqui. Tarifa de hospedagem vem sempre
 * da Hostaway, em runtime. Este arquivo só carrega preços de itens de menu que
 * nós controlamos, e as regras que combinam esses itens.
 */

export const CONFIG_VERSION = "2026-08-13";

/** Janela de cancelamento com reembolso integral dos extras, contada a partir do CHECK-IN. */
export const JANELA_CANCELAMENTO_EXTRAS_DIAS = 7;

// ---------------------------------------------------------------------------
// TAXA PROGRESSIVA
// ---------------------------------------------------------------------------

/** Degraus por número de noites. Sem piso artificial em nenhum pacote. */
export const TAXA_PROGRESSIVA: { minNoites: number; taxa: number }[] = [
  { minNoites: 5, taxa: 0.17 },
  { minNoites: 3, taxa: 0.12 },
  { minNoites: 2, taxa: 0.08 },
  { minNoites: 1, taxa: 0 },
];

export function taxaProgressiva(noites: number): number {
  const degrau = TAXA_PROGRESSIVA.find((d) => noites >= d.minNoites);
  return degrau ? degrau.taxa : 0;
}

// ---------------------------------------------------------------------------
// BÔNUS DE SAÍDA
// ---------------------------------------------------------------------------

/**
 * Valor do bônus por casa. O Completo usa o MESMO valor das casas individuais
 * (decisão D-1: não empilhar concessão sobre produto de margem já reduzida).
 */
export const BONUS_SAIDA: Record<string, number> = {
  "solarium-1": 350,
  "solarium-2": 350,
  "solarium-completo": 350,
};

export function bonusSaidaPara(propertySlug: string): number {
  return BONUS_SAIDA[propertySlug] ?? 0;
}

// ---------------------------------------------------------------------------
// CATÁLOGO DE EXTRAS
// ---------------------------------------------------------------------------

export type UnidadeExtra =
  | "por_pessoa_noite"
  | "por_estadia"
  | "por_manha"
  | "por_sessao"
  | "por_item";

export const ROTULO_UNIDADE: Record<UnidadeExtra, string> = {
  por_pessoa_noite: "por pessoa, por noite",
  por_estadia: "por estadia",
  por_manha: "por casa, por manhã",
  por_sessao: "por sessão, por pessoa",
  por_item: "por item",
};

export type PrecoPorPeriodo = { fds: number; semana: number };

export type ExtraConfig = {
  id: string;
  nome: string;
  /** Preço de menu. `null` = o valor vem da Hostaway em runtime (nunca hardcoded). */
  preco: number | PrecoPorPeriodo | null;
  unidade: UnidadeExtra;
  /** on_off = checkbox; seletor = stepper de quantidade. */
  controle: "on_off" | "seletor";
  /**
   * Entra na base do desconto progressivo. Só early check-in e late check-out.
   * Todos os demais entram no subtotal a preço cheio e não recebem desconto.
   */
  entraNaBase: boolean;
  /** Exibido ao cliente mas FORA do subtotal — a cobrança acontece em outro lugar. */
  informativo?: boolean;
  /** Dias mínimos entre a contratação e o check-in. Abaixo disso o item não é exibido. */
  antecedenciaMinimaDias?: number;
  /** Só exibir se a noite adjacente estiver livre no calendário. */
  exigeNoiteLivre?: "anterior" | "posterior";
  /** O que o item entrega, exibido junto ao nome. */
  descricao?: string;
  /** Aviso ao cliente, exibido junto ao item. */
  observacao?: string;
  /** Instrução interna para o concierge — vai ao hostNote e ao alerta interno. */
  notaInterna?: string;
  /** Prazo que o fornecedor precisa para atender, em dias. Vai no alerta interno. */
  prazoFornecedorDias?: number;
  /** Mapeia para o id já usado no fluxo avulso, quando existe. */
  idLegado?: string;
};

export const EXTRAS: ExtraConfig[] = [
  {
    id: "pessoa_adicional",
    nome: "Pessoa adicional",
    // A Hostaway já cobra por hóspede acima de `guestsIncluded` e o site já repassa
    // esse valor dentro do total da estadia. Cobrar de novo aqui duplicaria.
    preco: null,
    unidade: "por_pessoa_noite",
    controle: "seletor",
    entraNaBase: true,
    informativo: true,
    observacao: "Já incluída no valor da estadia. Até 2 pessoas adicionais por casa.",
  },
  {
    id: "early_checkin",
    nome: "Check-in antecipado, a partir das 9h",
    preco: { fds: 850, semana: 550 },
    unidade: "por_estadia",
    controle: "on_off",
    entraNaBase: true,
    exigeNoiteLivre: "anterior",
    idLegado: "early_checkin",
    notaInterna: "Liberar entrada a partir das 9h — noite anterior bloqueada para preparo",
  },
  {
    id: "late_checkout",
    nome: "Check-out estendido, até às 18h",
    preco: { fds: 850, semana: 550 },
    unidade: "por_estadia",
    controle: "on_off",
    entraNaBase: true,
    exigeNoiteLivre: "posterior",
    idLegado: "late_checkout",
    notaInterna: "Permitir saída até às 18h — noite do checkout bloqueada para preparo",
  },
  {
    id: "cesta_cafecafe",
    nome: "Cesta Café Café",
    preco: 180,
    unidade: "por_manha",
    controle: "seletor",
    entraNaBase: false,
    observacao: "Entregas de segunda a sábado, a partir das 9h. Serve duas pessoas.",
    notaInterna: "Acionar Café Café — entrega seg-sáb a partir das 9h",
    prazoFornecedorDias: 2,
    idLegado: "cafe_cafecafe",
  },
  {
    id: "cesta_diluia",
    nome: "Cesta Di.Luia",
    preco: 280,
    unidade: "por_manha",
    controle: "seletor",
    entraNaBase: false,
    observacao: "Entrega a partir das 7h. Serve duas pessoas.",
    notaInterna: "Acionar Di.Luia (@di.luia)",
    prazoFornecedorDias: 2,
    idLegado: "cafe_diluia",
  },
  {
    id: "cesta_dani",
    nome: "Cesta Dani Queijos e Frios",
    preco: 260,
    unidade: "por_manha",
    controle: "seletor",
    entraNaBase: false,
    observacao: "Serve duas pessoas.",
    notaInterna: "Acionar Dani Queijos e Frios (@daniqueijosefrios)",
    prazoFornecedorDias: 2,
    idLegado: "cafe_dani",
  },
  {
    id: "tabua_frios",
    nome: "Tábua de frios",
    preco: 310,
    unidade: "por_item",
    controle: "seletor",
    entraNaBase: false,
    notaInterna: "Acionar fornecedor de tábua de frios",
    prazoFornecedorDias: 2,
  },
  {
    id: "massagem",
    nome: "Sessão de massagem",
    preco: 175,
    unidade: "por_sessao",
    controle: "seletor",
    entraNaBase: false,
    observacao: "Agendamento prévio com o concierge.",
    notaInterna: "Acionar terapeuta parceiro — agendar horário com o hóspede",
    prazoFornecedorDias: 3,
    idLegado: "massagem",
  },
  {
    id: "decoracao",
    nome: "Decoração especial",
    descricao:
      "Pétalas espalhadas e um coração montado na cama, velas eletrônicas, um buquê, um espumante Salton e uma foto com mensagem.",
    preco: 600,
    unidade: "por_estadia",
    controle: "on_off",
    entraNaBase: false,
    antecedenciaMinimaDias: 5,
    notaInterna: "Montar decoração antes do check-in",
    prazoFornecedorDias: 5,
  },
  {
    id: "fondue_queijo",
    nome: "Fondue de queijo",
    preco: 175,
    unidade: "por_item",
    controle: "seletor",
    entraNaBase: false,
    notaInterna: "Deixar fondue de queijo na casa",
    prazoFornecedorDias: 2,
  },
  {
    id: "fondue_chocolate",
    nome: "Fondue de chocolate",
    preco: 140,
    unidade: "por_item",
    controle: "seletor",
    entraNaBase: false,
    notaInterna: "Deixar fondue de chocolate na casa",
    prazoFornecedorDias: 2,
  },
  {
    id: "lenha",
    nome: "Lenha",
    preco: 60,
    unidade: "por_item",
    controle: "seletor",
    entraNaBase: false,
    notaInterna: "Deixar lenha na casa",
    prazoFornecedorDias: 1,
  },
];

export const MAX_QTD_POR_EXTRA = 10;
export const MAX_PESSOAS_ADICIONAIS = 2;

export function getExtra(id: string): ExtraConfig | undefined {
  return EXTRAS.find((e) => e.id === id);
}

/**
 * Preço unitário de um extra. Para itens com preço por período, o dia da semana
 * da noite bloqueada decide (sex/sáb = fds; demais = semana).
 */
export function precoExtra(extra: ExtraConfig, noiteReferencia?: string): number {
  if (extra.preco === null) return 0;
  if (typeof extra.preco === "number") return extra.preco;
  if (!noiteReferencia) return extra.preco.semana;
  const dow = new Date(noiteReferencia + "T12:00:00").getDay();
  return dow === 5 || dow === 6 ? extra.preco.fds : extra.preco.semana;
}

// ---------------------------------------------------------------------------
// FERIADOS NACIONAIS
// ---------------------------------------------------------------------------

/**
 * Interface isolada de propósito: `info_datas` (base da Fernanda) não é acessível
 * a partir do site hoje. Quando houver endpoint, substituir a implementação sem
 * tocar em quem consome.
 *
 * ATENÇÃO: cobertura termina em ANO_FINAL_FERIADOS. Há teste que falha quando o
 * ano corrente ultrapassa a cobertura — o pacote Feriado na Serra fica cego sem isso.
 */
export const ANO_FINAL_FERIADOS = 2026;

export const FERIADOS_NACIONAIS: { data: string; nome: string }[] = [
  { data: "2026-01-01", nome: "Confraternização Universal" },
  { data: "2026-02-16", nome: "Carnaval" },
  { data: "2026-02-17", nome: "Carnaval" },
  { data: "2026-04-03", nome: "Sexta-feira Santa" },
  { data: "2026-04-21", nome: "Tiradentes" },
  { data: "2026-05-01", nome: "Dia do Trabalho" },
  { data: "2026-06-04", nome: "Corpus Christi" },
  { data: "2026-09-07", nome: "Independência" },
  { data: "2026-10-12", nome: "Nossa Senhora Aparecida" },
  { data: "2026-11-02", nome: "Finados" },
  { data: "2026-11-15", nome: "Proclamação da República" },
  { data: "2026-11-20", nome: "Consciência Negra" },
  { data: "2026-12-25", nome: "Natal" },
];

/** Feriados dentro da estadia, check-in e check-out INCLUSIVE (o hóspede está na casa). */
export function feriadosNaEstadia(checkin: string, checkout: string): { data: string; nome: string }[] {
  return FERIADOS_NACIONAIS.filter((f) => f.data >= checkin && f.data <= checkout);
}

export function estadiaContemFeriado(checkin: string, checkout: string): boolean {
  return feriadosNaEstadia(checkin, checkout).length > 0;
}

/** Próximo feriado a partir de uma data, ou null se fora da cobertura da tabela. */
export function proximoFeriado(a_partir_de: string): { data: string; nome: string } | null {
  return FERIADOS_NACIONAIS.find((f) => f.data >= a_partir_de) ?? null;
}

// ---------------------------------------------------------------------------
// PACOTES
// ---------------------------------------------------------------------------

export type ItemIncluso = {
  extraId: string;
  /** Quantidade de menu. Cestas por manhã, itens on/off sempre 1. */
  qtd: number;
  removivel: boolean;
};

export type PacoteV2 = {
  id: string;
  slug: string;
  nome: string;
  descricao: string;
  imagem: string | null;
  /** Texto longo do corpo da página. O hero fica com a linha curta de `descricao`. */
  descricaoLonga?: string;
  /** Mínimo e máximo do seletor de hóspedes. Ausente = 1..capacidade da casa. */
  hospedesMin?: number;
  hospedesMax?: number;
  /**
   * Até este número de hóspedes, a taxa de pessoa adicional da Hostaway é
   * absorvida pelo pacote: entra no Valor total e sai no desconto, efeito
   * líquido zero. Acima disso, cobrança normal.
   */
  hospedesAbsorvidosAte?: number;
  /** Marcado quando a imagem ainda é placeholder — vira pendência no relatório. */
  imagemPlaceholder?: { criadoEm: string; nota: string };
  properties: string[];
  noitesMin: number;
  noitesMax: number | null;
  /** Dias da semana válidos para check-in (0=dom). null = qualquer dia. */
  checkinDows: number[] | null;
  checkoutDows: number[] | null;
  /** Exige ao menos um feriado nacional dentro da estadia. */
  exigeFeriado: boolean;
  /** Sazonal: só visível dentro da janela de feriado. */
  sazonal: boolean;
  inclusos: ItemIncluso[];
  /** Prioridade no bloco da home (menor = primeiro). */
  prioridadeHome: number;
  ativo: boolean;
};

/** Antecedência, em dias, com que o pacote sazonal aparece antes do próximo feriado. */
export const JANELA_SAZONAL_DIAS = 45;

export const PACOTES_V2: PacoteV2[] = [
  {
    id: "fim-de-semana-completo",
    slug: "fim-de-semana-completo",
    nome: "Fim de Semana Completo",
    descricao: "Sexta a domingo, com a tarde de domingo inteira ainda pela frente.",
    descricaoLonga:
      "A saída vai até às 18h de domingo, então o último dia não é dia de arrumar mala às pressas. O café de sábado chega no horário que vocês pedirem, e a manhã começa na varanda.",
    imagem: "/images/solarium-1/09-deck-por-do-sol.jpg",
    properties: ["solarium-1", "solarium-2"],
    noitesMin: 2,
    noitesMax: 2,
    checkinDows: [5], // sexta
    checkoutDows: [0], // domingo
    exigeFeriado: false,
    sazonal: false,
    inclusos: [
      { extraId: "late_checkout", qtd: 1, removivel: false },
      { extraId: "cesta_cafecafe", qtd: 1, removivel: true },
    ],
    prioridadeHome: 1,
    ativo: true,
  },
  {
    id: "dois-casais",
    slug: "dois-casais",
    nome: "Dois Casais, Uma Vista",
    descricao: "As duas casas, cada casal com a sua, e a mesma vista das duas varandas.",
    descricaoLonga:
      "Cozinha, spa e varanda independentes em cada casa, para o encontro acontecer quando vocês quiserem e não porque o espaço obriga. O café da primeira manhã chega nas duas portas.",
    imagem: "/images/solarium-1/04-vista-traseira.jpg",
    imagemPlaceholder: {
      criadoEm: "2026-08-13",
      nota: "PLACEHOLDER — substituir por foto de dois casais",
    },
    properties: ["solarium-completo"],
    noitesMin: 2,
    noitesMax: null,
    checkinDows: null,
    checkoutDows: null,
    exigeFeriado: false,
    sazonal: false,
    inclusos: [
      // Único pacote onde o late check-out pode sair. Ao sair, o bônus sai junto.
      { extraId: "late_checkout", qtd: 1, removivel: true },
      // Uma cesta por casa, na primeira manhã completa.
      { extraId: "cesta_cafecafe", qtd: 2, removivel: true },
    ],
    hospedesMin: 4,
    hospedesMax: 8,
    /**
     * Hóspedes acima da base da Hostaway que o pacote absorve: aparecem a preço
     * cheio na linha de itens e voltam como desconto de valor idêntico.
     */
    hospedesAbsorvidosAte: 4,
    prioridadeHome: 2,
    ativo: true,
  },
  {
    id: "feriado-na-serra",
    slug: "feriado-na-serra",
    nome: "Feriado na Serra",
    descricao: "Três noites de feriado, e no último dia a saída vai até às 18h, sem correria.",
    descricaoLonga:
      "Feriado na serra costuma ser estrada cheia na volta. Com a saída até às 18h, vocês pegam a descida depois que o movimento passa, e a última manhã ainda cabe inteira no dia.",
    imagem: "/images/solarium-1/07-nevoeiro-plantas.jpg",
    properties: ["solarium-1", "solarium-2"],
    noitesMin: 3,
    noitesMax: 3,
    checkinDows: [4, 5], // quinta ou sexta
    checkoutDows: [0, 1], // domingo ou segunda
    exigeFeriado: true,
    sazonal: true,
    inclusos: [
      { extraId: "late_checkout", qtd: 1, removivel: false },
      { extraId: "cesta_cafecafe", qtd: 1, removivel: true },
    ],
    prioridadeHome: 3,
    ativo: true,
  },
];

export function getPacoteV2(slug: string): PacoteV2 | undefined {
  return PACOTES_V2.find((p) => p.slug === slug && p.ativo);
}

/**
 * Pacote sazonal só aparece quando faz sentido: com datas escolhidas, se a estadia
 * contém feriado; sem datas, se o próximo feriado está dentro da janela. Fora
 * disso fica oculto na home e em /pacotes.
 */
export function pacoteVisivelHoje(
  pacote: PacoteV2,
  hoje: string,
  datas?: { checkin: string; checkout: string },
): boolean {
  if (!pacote.ativo) return false;
  if (!pacote.sazonal) return true;

  if (datas) return estadiaContemFeriado(datas.checkin, datas.checkout);

  const proximo = proximoFeriado(hoje);
  if (!proximo) return false;
  const dias = Math.round(
    (new Date(proximo.data + "T12:00:00").getTime() - new Date(hoje + "T12:00:00").getTime()) /
      86400000,
  );
  return dias <= JANELA_SAZONAL_DIAS;
}

// ---------------------------------------------------------------------------
// PREÇO DE MENU DO LATE / EARLY DENTRO DO PACOTE
// ---------------------------------------------------------------------------

/**
 * Preço de menu dos itens operacionais dentro de um pacote.
 *
 * É o MESMO preço cobrado no fluxo avulso: fim de semana só quando a noite
 * bloqueada cai em sexta ou sábado. Domingo e segunda valem tabela de semana,
 * igual ao que o hóspede pagaria contratando o item à parte.
 *
 * Isso mantém a âncora honesta: os dois lados da economia exibida usam o mesmo
 * número. Um pacote com check-out no domingo conta o late check-out por 550, não
 * por 850 — a comparação com o avulso é real.
 *
 * A tabela abaixo é a única fonte desses valores. Não repetir 550/850/1000/1600
 * em nenhum outro lugar.
 */
export function precoMenuOperacional(
  propertySlug: string,
  extraId: "early_checkin" | "late_checkout",
  fimDeSemana: boolean,
): number {
  const base: Record<string, PrecoPorPeriodo> = {
    "solarium-1": { fds: 850, semana: 550 },
    "solarium-2": { fds: 850, semana: 550 },
    "solarium-completo": { fds: 1600, semana: 1000 },
  };
  const tabela = base[propertySlug];
  if (!tabela) return 0;
  return fimDeSemana ? tabela.fds : tabela.semana;
}
