// CSP da página de pagamento — rodada PAG1b.
//
// SÓ report-only: o navegador relata o que teria bloqueado e não bloqueia nada.
// A lista abaixo foi montada a partir do que a página carrega hoje; a lista
// definitiva sai dos relatórios colhidos em produção (/api/admin/csp). Não
// existe modo bloqueante neste código — promover exige rodada própria.
//
// Módulo sem dependência de Node: roda no middleware (edge).

export const ENDPOINT_RELATORIO = "/api/csp-report";
export const GRUPO_RELATORIO = "csp-endpoint";

// SDK 3DS da Braspag: o script é self-hosted (/scripts/BP.Mpi.3ds20*.js), mas
// fala com o MPI e com a Cardinal (hosts lidos do próprio SDK).
const MPI_BRASPAG = ["https://mpi.braspag.com.br", "https://mpisandbox.braspag.com.br"];
const CARDINAL = ["https://static.client.cardinaltrusted.com", "https://cas.static.client.cardinaltrusted.com"];
// Device fingerprint da Cybersource (FP1): allowlist apurada no DECISOES.md.
const THREATMETRIX = ["https://h.online-metrix.net"];
// Busca de CEP do endereço de cobrança.
const VIACEP = ["https://viacep.com.br"];

const ROTA_PAGAMENTO = /^\/reservar\/[^/]+\/pagamento\/?$/;

export function ehRotaDePagamento(pathname: string): boolean {
  return ROTA_PAGAMENTO.test(pathname);
}

/** Nonce de 128 bits em base64, um por resposta. */
export function gerarNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...Array.from(bytes)));
}

/**
 * A política da rota de pagamento. O nonce cobre os scripts inline do próprio
 * Next (ele lê o nonce deste header no request). Sem 'strict-dynamic': o script
 * da ThreatMetrix e os do 3DS entram pela origem, sem tocar no código da FP1.
 * `'unsafe-eval'` só em dev, onde o Next precisa dele.
 */
export function politicaPagamento(nonce: string, { dev = false }: { dev?: boolean } = {}): string {
  const j = (...xs: string[][]) => xs.flat().join(" ");
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${dev ? " 'unsafe-eval'" : ""} ${j(THREATMETRIX, MPI_BRASPAG, CARDINAL)}`,
    // next/font e atributos style="" dos componentes. Nonce em estilo exigiria
    // mexer em todos eles; o risco que interessa nesta rota é script.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${j(THREATMETRIX)}`,
    "font-src 'self'",
    `connect-src 'self' ${j(MPI_BRASPAG, CARDINAL, THREATMETRIX, VIACEP)}`,
    // O challenge do 3DS abre o ACS do banco emissor, cujo domínio varia. Fica
    // de fora de propósito: os relatórios vão mostrar quais são antes de
    // qualquer decisão de bloquear.
    `frame-src 'self' ${j(MPI_BRASPAG, CARDINAL, THREATMETRIX)}`,
    `form-action 'self' ${j(MPI_BRASPAG)}`,
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    `report-uri ${ENDPOINT_RELATORIO}`,
    `report-to ${GRUPO_RELATORIO}`,
  ].join("; ");
}

// ---------------------------------------------------------------------------
// Higienização dos relatórios. Guardamos só diretiva, ORIGEM bloqueada, origem
// do script que disparou e a página já normalizada. Nada de path, query,
// fragmento, trecho de código (`sample`) ou draftId — a query do tags.js leva o
// session_id do fingerprint, e a URL da página leva o draft.

export type ViolacaoCsp = {
  diretiva: string;
  bloqueado: string;
  origemScript: string | null;
  pagina: string;
  disposicao: "report" | "enforce";
};

const MAX_VIOLACOES_POR_CORPO = 20;
const PALAVRAS_CHAVE = new Set(["inline", "eval", "wasm-eval", "self", "trusted-types-policy", "trusted-types-sink"]);

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function origem(url: string): string | null {
  try {
    const u = new URL(url);
    if (!["http:", "https:", "ws:", "wss:"].includes(u.protocol)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

function recursoBloqueado(v: string): string {
  if (!v) return "desconhecido";
  const baixo = v.toLowerCase();
  if (PALAVRAS_CHAVE.has(baixo)) return baixo;
  for (const esquema of ["data", "blob", "filesystem", "about", "chrome-extension", "moz-extension", "safari-extension"]) {
    if (baixo.startsWith(`${esquema}:`)) return esquema;
  }
  return origem(v) ?? "outro";
}

function paginaNormalizada(v: string): string {
  try {
    return ehRotaDePagamento(new URL(v).pathname) ? "/reservar/[draftId]/pagamento" : "outra";
  } catch {
    return "outra";
  }
}

function diretivaValida(v: string): string {
  const d = v.split(/\s+/)[0]?.toLowerCase() ?? "";
  return /^[a-z-]{1,40}$/.test(d) ? d : "desconhecida";
}

type Bruto = Record<string, unknown>;

function deCampos(c: Bruto, nomes: { diretiva: string[]; bloqueado: string; origem: string; pagina: string; disposicao: string }): ViolacaoCsp {
  const diretiva = nomes.diretiva.map((n) => texto(c[n])).find(Boolean) ?? "";
  const script = texto(c[nomes.origem]);
  return {
    diretiva: diretivaValida(diretiva),
    bloqueado: recursoBloqueado(texto(c[nomes.bloqueado])),
    origemScript: script ? origem(script) : null,
    pagina: paginaNormalizada(texto(c[nomes.pagina])),
    disposicao: texto(c[nomes.disposicao]) === "enforce" ? "enforce" : "report",
  };
}

/**
 * Aceita os dois formatos que os navegadores mandam:
 *  - `application/csp-report` (report-uri): `{ "csp-report": { ... } }`
 *  - `application/reports+json` (report-to): `[{ type: "csp-violation", body: { ... } }]`
 * Qualquer outra coisa vira lista vazia.
 */
export function higienizarRelatorio(corpo: unknown): ViolacaoCsp[] {
  if (!corpo || typeof corpo !== "object") return [];

  if (!Array.isArray(corpo)) {
    const c = (corpo as Bruto)["csp-report"];
    if (!c || typeof c !== "object") return [];
    return [
      deCampos(c as Bruto, {
        diretiva: ["effective-directive", "violated-directive"],
        bloqueado: "blocked-uri",
        origem: "source-file",
        pagina: "document-uri",
        disposicao: "disposition",
      }),
    ];
  }

  return corpo
    .slice(0, MAX_VIOLACOES_POR_CORPO)
    .filter((r): r is Bruto => !!r && typeof r === "object" && (r as Bruto).type === "csp-violation")
    .map((r) => r.body)
    .filter((b): b is Bruto => !!b && typeof b === "object")
    .map((b) =>
      deCampos(b, {
        diretiva: ["effectiveDirective"],
        bloqueado: "blockedURL",
        origem: "sourceFile",
        pagina: "documentURL",
        disposicao: "disposition",
      }),
    );
}
