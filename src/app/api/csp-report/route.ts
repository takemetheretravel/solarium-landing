import { NextResponse } from "next/server";
import { recordCspViolation } from "@/lib/kv-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Coletor de relatórios de violação da CSP.
 *
 * Sem autenticação: quem posta é o navegador do visitante, que não tem nem
 * envia credencial. A defesa contra abuso é o limite de tamanho do corpo e o
 * fato de a escrita ser deduplicada — mil relatórios forjados da mesma origem
 * viram uma chave com contador alto, não mil chaves.
 *
 * Responde 204 SEMPRE. Um coletor que devolve erro faz o navegador reenviar, e
 * nada aqui vale atrapalhar o carregamento de uma página de pagamento.
 */

/** Acima disso o corpo é descartado sem análise. */
const LIMITE_CORPO_BYTES = 16 * 1024;

const VAZIO = new NextResponse(null, { status: 204 });

/** Um relatório, nos dois formatos que os navegadores usam hoje. */
type RelatorioCsp = {
  "blocked-uri"?: string;
  blockedURL?: string;
  "violated-directive"?: string;
  effectiveDirective?: string;
  "effective-directive"?: string;
  "document-uri"?: string;
  documentURL?: string;
};

function normalizar(r: RelatorioCsp): {
  blocked_uri: string;
  violated_directive: string;
  document_uri: string;
} | null {
  const blocked = r["blocked-uri"] ?? r.blockedURL ?? "";
  const directive = r["violated-directive"] ?? r.effectiveDirective ?? r["effective-directive"] ?? "";
  const doc = r["document-uri"] ?? r.documentURL ?? "";
  if (!blocked && !directive) return null;
  return {
    // `inline`, `eval` e `data` chegam como palavra solta; o resto é URL, e só
    // a origem interessa (o caminho completo carregaria querystring do emissor).
    blocked_uri: soOrigem(blocked) || "(desconhecido)",
    violated_directive: directive.slice(0, 120) || "(desconhecida)",
    document_uri: soOrigem(doc) || "",
  };
}

function soOrigem(valor: string): string {
  const v = (valor || "").trim();
  if (!v) return "";
  if (!v.includes("://")) return v.slice(0, 200);
  try {
    return new URL(v).origin;
  } catch {
    return v.slice(0, 200);
  }
}

export async function POST(req: Request) {
  try {
    const declarado = Number(req.headers.get("content-length") || "0");
    if (declarado > LIMITE_CORPO_BYTES) return VAZIO;

    const texto = await req.text();
    if (!texto || texto.length > LIMITE_CORPO_BYTES) return VAZIO;

    const corpo = JSON.parse(texto) as unknown;
    const userAgent = (req.headers.get("user-agent") || "").slice(0, 200);

    // Dois formatos convivem: `application/csp-report` manda um objeto com a
    // chave "csp-report"; `application/reports+json` manda um array de
    // relatórios com o conteúdo em "body".
    const relatorios: RelatorioCsp[] = [];
    if (Array.isArray(corpo)) {
      for (const item of corpo) {
        const b = (item as { body?: RelatorioCsp })?.body;
        if (b) relatorios.push(b);
      }
    } else if (corpo && typeof corpo === "object") {
      const r = (corpo as { "csp-report"?: RelatorioCsp })["csp-report"];
      relatorios.push(r ?? (corpo as RelatorioCsp));
    }

    for (const bruto of relatorios.slice(0, 20)) {
      const normalizado = normalizar(bruto);
      if (!normalizado) continue;
      await recordCspViolation({ ...normalizado, user_agent: userAgent });
    }
  } catch {
    // Corpo malformado, Redis fora, o que for: o coletor nunca reclama.
  }
  return VAZIO;
}
