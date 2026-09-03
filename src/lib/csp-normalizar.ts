/**
 * Normalização e deduplicação de relatórios de violação da CSP.
 *
 * POR QUE EXISTE. `/api/csp-report` recebeu 151 relatórios e respondeu 204 a
 * todos, descartando o conteúdo. Não sabíamos o que estava sendo bloqueado nem
 * — o que mais importa — se a política está em `enforce` (bloqueando de verdade,
 * podendo quebrar o checkout) ou em `report` (só observando). O campo
 * `disposition` responde exatamente isso.
 *
 * Módulo separado da rota para poder ser testado sem subir servidor.
 */

/** Acima disso, `blockedURL` e `sourceFile` são cortados. */
const LIMITE_CAMPO = 500;

/** Janela de agregação da deduplicação, em milissegundos. */
export const JANELA_DEDUPE_MS = 60_000;

/** Um relatório já normalizado, pronto para virar linha de log. */
export type ViolacaoNormalizada = {
  /**
   * `enforce` = a política BLOQUEOU. `report` = só observou.
   *
   * É o campo mais importante do relatório: separa "isto quebrou o checkout de
   * alguém" de "isto quebraria se a política estivesse ligada".
   */
  disposition: "enforce" | "report";
  effectiveDirective: string;
  blockedURL: string;
  documentURL: string;
  sourceFile: string;
  lineNumber: number | null;
  statusCode: number | null;
  /** A violação aconteceu na rota de pagamento. Prioridade máxima. */
  isPaymentRoute: boolean;
};

/**
 * Formato legado (`application/csp-report`) e Reporting API
 * (`application/reports+json`) usam nomes diferentes para os mesmos campos.
 */
type RelatorioBruto = Record<string, unknown>;

function texto(v: unknown, limite = 200): string {
  return typeof v === "string" ? v.slice(0, limite) : "";
}

function inteiro(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function primeiro(r: RelatorioBruto, ...chaves: string[]): unknown {
  for (const k of chaves) {
    if (r[k] !== undefined && r[k] !== null && r[k] !== "") return r[k];
  }
  return undefined;
}

/**
 * A rota de pagamento é a que importa mais: é ela que renderiza os campos
 * `bpmpi_*` do 3DS, e uma diretiva em `enforce` bloqueando ali derruba a venda.
 */
export function ehRotaDePagamento(documentURL: string): boolean {
  const u = documentURL || "";
  return u.includes("/reservar/") && u.includes("/pagamento");
}

/** `null` quando o relatório não traz nem diretiva nem origem bloqueada. */
export function normalizarViolacao(bruto: RelatorioBruto): ViolacaoNormalizada | null {
  if (!bruto || typeof bruto !== "object") return null;

  const disposicaoBruta = texto(primeiro(bruto, "disposition"), 20).toLowerCase();
  // Ausente resolve para `report`, NUNCA para `enforce`: afirmar bloqueio que
  // não houve manda a operação caçar um problema inexistente.
  const disposition: "enforce" | "report" = disposicaoBruta === "enforce" ? "enforce" : "report";

  const effectiveDirective = texto(
    primeiro(bruto, "effectiveDirective", "effective-directive", "violatedDirective", "violated-directive"),
    120,
  );
  const blockedURL = texto(primeiro(bruto, "blockedURL", "blocked-uri", "blockedUri"), LIMITE_CAMPO);
  const documentURL = texto(primeiro(bruto, "documentURL", "document-uri", "documentUri"), LIMITE_CAMPO);

  if (!effectiveDirective && !blockedURL) return null;

  return {
    disposition,
    effectiveDirective: effectiveDirective || "(desconhecida)",
    blockedURL: blockedURL || "(desconhecido)",
    documentURL,
    sourceFile: texto(primeiro(bruto, "sourceFile", "source-file"), LIMITE_CAMPO),
    lineNumber: inteiro(primeiro(bruto, "lineNumber", "line-number")),
    statusCode: inteiro(primeiro(bruto, "statusCode", "status-code")),
    isPaymentRoute: ehRotaDePagamento(documentURL),
  };
}

/**
 * Extrai os relatórios dos dois formatos.
 *
 * - `application/csp-report`: objeto único com a chave `csp-report`.
 * - `application/reports+json`: array de envelopes, cada um com `type` e `body`.
 *   Só `type: "csp-violation"` interessa — o mesmo canal entrega relatórios de
 *   deprecation e intervention, que não são violação de CSP.
 */
export function extrairRelatorios(corpo: unknown): RelatorioBruto[] {
  const saida: RelatorioBruto[] = [];

  if (Array.isArray(corpo)) {
    for (const item of corpo) {
      if (!item || typeof item !== "object") continue;
      const env = item as { type?: unknown; body?: unknown };
      if (typeof env.type === "string" && env.type !== "csp-violation") continue;
      if (env.body && typeof env.body === "object") saida.push(env.body as RelatorioBruto);
    }
    return saida;
  }

  if (corpo && typeof corpo === "object") {
    const legado = (corpo as { "csp-report"?: unknown })["csp-report"];
    if (legado && typeof legado === "object") {
      saida.push(legado as RelatorioBruto);
    } else {
      saida.push(corpo as RelatorioBruto);
    }
  }

  return saida;
}

/** Chave de agregação. Ignora linha e arquivo: o par origem+diretiva é o fato. */
export function chaveDedupe(v: ViolacaoNormalizada): string {
  return `${v.disposition}|${v.effectiveDirective}|${v.blockedURL}|${v.isPaymentRoute}`;
}

type Registro = { primeiraEm: number; ultimoLogEm: number; ocorrencias: number };

/**
 * Deduplicador em memória, por instância.
 *
 * Uma campanha gerou 147 linhas idênticas. O que interessa é o CONJUNTO de
 * origens distintas mais a contagem, não a repetição. Em memória de propósito:
 * o objetivo é enxugar log, e uma instância nova recomeçando a contagem é
 * aceitável — bem mais barato que uma ida ao Redis por relatório recebido.
 */
export class DedupeCsp {
  private mapa = new Map<string, Registro>();

  constructor(private janelaMs: number = JANELA_DEDUPE_MS) {}

  /**
   * Decide o que fazer com esta violação.
   *
   * - `integral`: primeira ocorrência da chave (ou a janela virou) — logar tudo.
   * - `agregado`: passou um minuto desde o último log — logar só a contagem.
   * - `silenciar`: repetição dentro do minuto.
   */
  registrar(v: ViolacaoNormalizada, agora = Date.now()): {
    acao: "integral" | "agregado" | "silenciar";
    ocorrencias: number;
    chave: string;
  } {
    const chave = chaveDedupe(v);
    const atual = this.mapa.get(chave);

    if (!atual || agora - atual.primeiraEm >= this.janelaMs) {
      this.mapa.set(chave, { primeiraEm: agora, ultimoLogEm: agora, ocorrencias: 1 });
      // Janela virada com repetições acumuladas: a contagem da janela anterior
      // já foi reportada no `agregado`; aqui recomeça do 1.
      return { acao: "integral", ocorrencias: 1, chave };
    }

    atual.ocorrencias += 1;

    if (agora - atual.ultimoLogEm >= this.janelaMs) {
      atual.ultimoLogEm = agora;
      return { acao: "agregado", ocorrencias: atual.ocorrencias, chave };
    }

    return { acao: "silenciar", ocorrencias: atual.ocorrencias, chave };
  }

  /** Só para teste: quantas chaves distintas estão vivas. */
  get tamanho(): number {
    return this.mapa.size;
  }
}
