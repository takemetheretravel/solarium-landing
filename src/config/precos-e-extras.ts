/**
 * FONTE ÚNICA DE CONFIGURAÇÃO — preços de menu, pacotes, taxa progressiva e bônus.
 *
 * Regra inegociável: NENHUMA DIÁRIA entra aqui. Tarifa de hospedagem vem sempre
 * da Hostaway, em runtime. Este arquivo só carrega preços de itens de menu que
 * nós controlamos, e as regras que combinam esses itens.
 */

import { imageUrl } from "@/lib/cloudinary";

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
  /**
   * Item que só existe dentro de um pacote. Fica fora da lista de extras
   * avulsos, mas o preço mora aqui como o de qualquer outro — uma fonte só.
   */
  somenteEmPacote?: boolean;
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
    id: "espumante_chandon",
    nome: "Espumante Chandon",
    preco: 140,
    unidade: "por_item",
    controle: "seletor",
    entraNaBase: false,
    notaInterna: "Deixar espumante Chandon gelado na casa",
    prazoFornecedorDias: 2,
  },
  {
    id: "quadriciclo",
    nome: "Passeio de quadriciclo — Cachoeira da Gomeira",
    descricao: "Cerca de duas horas, com guia, saindo da casa.",
    preco: 300,
    unidade: "por_estadia",
    controle: "on_off",
    entraNaBase: false,
    somenteEmPacote: true,
    notaInterna: "Acionar parceiro de quadriciclo — combinar horário com o hóspede",
    prazoFornecedorDias: 3,
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
export const ANO_FINAL_FERIADOS = 2027;

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
  { data: "2027-01-01", nome: "Confraternização Universal" },
  { data: "2027-02-08", nome: "Carnaval" },
  { data: "2027-02-09", nome: "Carnaval" },
  { data: "2027-03-26", nome: "Sexta-feira Santa" },
  { data: "2027-04-21", nome: "Tiradentes" },
  { data: "2027-05-01", nome: "Dia do Trabalho" },
  { data: "2027-05-27", nome: "Corpus Christi" },
  { data: "2027-09-07", nome: "Independência" },
  { data: "2027-10-12", nome: "Nossa Senhora Aparecida" },
  { data: "2027-11-02", nome: "Finados" },
  { data: "2027-11-15", nome: "Proclamação da República" },
  { data: "2027-11-20", nome: "Consciência Negra" },
  { data: "2027-12-25", nome: "Natal" },
];

/**
 * Feriados dentro da estadia, check-in e check-out INCLUSIVE.
 *
 * Sem filtro de dia da semana: a especificação define o pacote como três noites
 * contendo ao menos um feriado nacional, e é isso. Se uma janela de feriado sai
 * barata, o lugar de corrigir é a tarifa na Hostaway, não a regra do produto.
 */
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
// JANELAS BLOQUEADAS
// ---------------------------------------------------------------------------

/**
 * Noites em que os pacotes de meio de semana não valem, por [primeira, última].
 *
 * Fonte única: era uma lista dentro de `config/packages.ts`, usada só pelo motor
 * antigo. Migrada para cá com os mesmos intervalos, sem alteração.
 */
export const JANELAS_BLOQUEADAS: [string, string][] = [
  ["2026-02-14", "2026-02-17"],
  ["2026-04-18", "2026-04-20"],
  ["2026-05-01", "2026-05-02"],
  ["2026-06-04", "2026-06-06"],
  ["2026-09-05", "2026-09-06"],
  ["2026-10-10", "2026-10-11"],
  ["2026-10-31", "2026-11-01"],
  ["2026-11-13", "2026-11-14"],
  ["2026-12-23", "2026-12-25"],
  ["2026-12-30", "2027-01-01"],
];

/** Alguma NOITE da estadia cai numa janela bloqueada. O check-out não é noite. */
export function estadiaEmJanelaBloqueada(checkin: string, checkout: string): boolean {
  const d = new Date(checkin + "T12:00:00");
  const fim = new Date(checkout + "T12:00:00");
  while (d < fim) {
    const noite = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (JANELAS_BLOQUEADAS.some(([de, ate]) => noite >= de && noite <= ate)) return true;
    d.setDate(d.getDate() + 1);
  }
  return false;
}

// ---------------------------------------------------------------------------
// PACOTES
// ---------------------------------------------------------------------------

export type ItemIncluso = {
  extraId: string;
  /** Quantidade de menu. Cestas por manhã, itens on/off sempre 1. */
  qtd: number;
  removivel: boolean;
  /**
   * Só entra quando o check-out cai num destes dias da semana.
   *
   * O Final de Ano inclui o check-out estendido apenas na saída de domingo: o
   * item entra e sai sozinho quando o cliente troca a data, no mesmo recálculo.
   */
  somenteCheckoutDows?: number[];
};

export type PacoteV2 = {
  id: string;
  slug: string;
  nome: string;
  descricao: string;
  imagem: string | null;
  /** Texto longo do corpo da página. O hero fica com a linha curta de `descricao`. */
  descricaoLonga?: string;
  /** Janela fixa de exibição (MM-DD), quando o pacote não depende de feriado. */
  janelaFixa?: { de: string; ate: string };
  /** Faixa de check-in permitida (MM-DD), independente do ano. */
  janelaCheckin?: { de: string; ate: string };
  /**
   * Ajuste na taxa progressiva por dia da semana do check-out, em pontos.
   * Ex.: `{ 6: -0.05 }` tira 5 pontos quando a saída é no sábado.
   */
  ajusteTaxaPorCheckoutDow?: Record<number, number>;
  /**
   * Dia da semana do check-out SUGERIDO ao abrir a página.
   *
   * Sem isto a sugestão era "check-in + noitesMin", data que o próprio pacote
   * recusava — o cliente abria a tela num estado inválido.
   */
  checkoutSugeridoDow?: number;
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
  /** Recusa estadias com noite dentro de `JANELAS_BLOQUEADAS`. */
  naoValeEmJanelaBloqueada?: boolean;
  /**
   * Dias da semana que NENHUMA noite da estadia pode ocupar (0=dom).
   *
   * Regra sobre as noites, não sobre a chegada. Traduzir uma para a outra é o que
   * abriu a chegada no domingo: a chegada de domingo é dia de semana, mas ocupa a
   * noite de domingo. O check-out não é noite e não entra na conta.
   */
  noitesProibidasDow?: number[];
  /**
   * Vende abaixo do mínimo de noites configurado no PMS.
   *
   * O mínimo é regra de canal e continua valendo em todo o resto do site —
   * reserva avulsa e demais pacotes. Só o pacote que traz esta marca ignora, e
   * apenas no canal direto. A tarifa segue vindo do calendário da Hostaway.
   */
  ignorarMinimoPMS?: boolean;
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
  {
    id: "final-de-ano",
    slug: "final-de-ano",
    nome: "Final de Ano",
    descricao: "Emende a comemoração com o fim de semana, e volte sem pressa.",
    descricaoLonga:
      "Comemoração de fim de ano costuma acabar com todo mundo olhando o relógio, calculando a hora de pegar a estrada. Aqui a data cai no começo da semana e a estadia segue até o fim de semana seguinte: o dia depois da comemoração é de café sem hora e piscina aquecida, não de arrumar mala. Saindo no domingo, o check-out vai até às 18h — a última tarde é inteira sua, e a descida acontece quando a estrada já esvaziou. O espumante espera gelado na chegada.",
    imagem: "/images/solarium-1/08-fire-pit.jpg",
    properties: ["solarium-1", "solarium-2"],
    noitesMin: 3,
    // 7 noites: a saida na segunda a partir de 28/12 precisa caber. A tabela
    // progressiva ja cobre (5+ -> 17%).
    noitesMax: 7,
    // Uma regra só cobre Natal e Ano Novo: chegada seg/ter/qua entre 21 e 30/12,
    // saída no sábado ou domingo seguinte. 21-23/12 saindo em 26 ou 27/12, e
    // 28-30/12 saindo em 02 ou 03/01.
    checkinDows: [1, 2, 3],
    // Sábado, domingo ou segunda. O domingo é o sugerido; os outros dois saem
    // sem o check-out estendido, e o sábado ainda perde 5 pontos de progressivo.
    checkoutDows: [6, 0, 1],
    exigeFeriado: false,
    // Sem janela sazonal de exibição: o pacote fica sempre na grade, e a ordem
    // de destaque é que muda quando o dono quiser promovê-lo.
    sazonal: false,
    janelaCheckin: { de: "12-21", ate: "12-30" },
    // Verificado com reserva real na Hostaway (65058672, 28/12 → 02/01, mínimo
    // 6): a API cria abaixo do mínimo e a estadia bloqueia o calendário.
    ignorarMinimoPMS: true,
    ajusteTaxaPorCheckoutDow: { 6: -0.05 },
  /** Saída sugerida: o domingo da semana seguinte à chegada. */
  checkoutSugeridoDow: 0,
    inclusos: [
      { extraId: "late_checkout", qtd: 1, removivel: false, somenteCheckoutDows: [0] },
      { extraId: "cesta_cafecafe", qtd: 1, removivel: true },
      { extraId: "espumante_chandon", qtd: 1, removivel: true },
    ],
    prioridadeHome: 4,
    ativo: true,
  },
  {
    id: "meio-de-semana",
    slug: "meio-de-semana",
    nome: "Meio de Semana na Serra",
    descricao: "Três manhãs de café com vista, sem pressa e sem multidão.",
    descricaoLonga:
      "Três noites durante a semana, quando a serra está mais silenciosa, com a cesta de café da manhã do Café Café servida nas três manhãs. Você só escolhe as datas — o resto é com a gente.",
    imagem: imageUrl("solarium/experiencias/cesta-cafe-preparada", { width: 1200, height: 900 }),
    properties: ["solarium-1", "solarium-2"],
    noitesMin: 3,
    noitesMax: 3,
    // A regra é sobre as NOITES: nenhuma pode cair em sexta, sábado ou domingo.
    // Com três noites, sobram as chegadas de segunda e terça.
    checkinDows: null,
    checkoutDows: null,
    noitesProibidasDow: [5, 6, 0],
    exigeFeriado: false,
    naoValeEmJanelaBloqueada: true,
    sazonal: false,
    inclusos: [{ extraId: "cesta_cafecafe", qtd: 3, removivel: false }],
    prioridadeHome: 5,
    ativo: true,
  },
  {
    id: "imersao-na-serra",
    slug: "imersao-na-serra",
    nome: "Imersão na Serra",
    descricao: "Quatro noites, café todas as manhãs e a serra de quadriciclo.",
    descricaoLonga:
      "Quatro noites de semana com café da manhã servido todos os dias e um passeio de quadriciclo até a Cachoeira da Gomeira. A experiência completa da Mantiqueira, organizada em uma reserva só.",
    imagem: imageUrl("solarium/experiencias/cachoeira", { width: 1200, height: 900 }),
    properties: ["solarium-1", "solarium-2"],
    noitesMin: 4,
    noitesMax: 4,
    // Mesma regra por noite. Com quatro noites, só a chegada de segunda escapa
    // do fim de semana nas duas pontas.
    checkinDows: null,
    checkoutDows: null,
    noitesProibidasDow: [5, 6, 0],
    exigeFeriado: false,
    naoValeEmJanelaBloqueada: true,
    sazonal: false,
    inclusos: [
      { extraId: "cesta_cafecafe", qtd: 4, removivel: false },
      { extraId: "quadriciclo", qtd: 1, removivel: false },
    ],
    prioridadeHome: 6,
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

  // Sazonal com janela fixa (MM-DD), como o Final de Ano: a visibilidade não
  // depende de feriado, e sim de estar dentro da temporada. A janela atravessa a
  // virada do ano quando `de` > `ate`.
  if (pacote.janelaFixa) {
    const md = hoje.slice(5);
    const { de, ate } = pacote.janelaFixa;
    return de <= ate ? md >= de && md <= ate : md >= de || md <= ate;
  }

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
