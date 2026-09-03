import { NextResponse } from "next/server";
import { recordCspViolation } from "@/lib/kv-store";
import {
  extrairRelatorios,
  normalizarViolacao,
  DedupeCsp,
  type ViolacaoNormalizada,
} from "@/lib/csp-normalizar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Coletor de relatórios de violação da CSP.
 *
 * Sem autenticação: quem posta é o navegador do visitante, que não tem nem
 * envia credencial. **Não pôr atrás de middleware de autenticação** — um
 * coletor protegido não recebe nada e a cegueira volta.
 *
 * Responde 204 SEMPRE. Um coletor que devolve erro faz o navegador reenviar, e
 * nada aqui vale atrapalhar o carregamento de uma página de pagamento.
 *
 * A rota recebeu 151 relatórios e descartava todos. Agora cada violação vira
 * linha de log — com `disposition`, que é o que responde se a política está
 * bloqueando de verdade ou só observando.
 */

/** Acima disso o corpo é descartado sem análise. */
const LIMITE_CORPO_BYTES = 16 * 1024;

/** Teto de relatórios processados por requisição. */
const MAX_RELATORIOS = 20;

const VAZIO = new NextResponse(null, { status: 204 });

// Vive no módulo: uma instância da função reaproveita entre requisições, que é
// exatamente o escopo em que a rajada de linhas idênticas acontece.
const dedupe = new DedupeCsp();

/**
 * Uma linha por violação.
 *
 * `console.warn` de propósito, não `error`: violação em `report` é observação,
 * não incidente. O que separa os dois é o campo `disposition` dentro do JSON.
 */
function logar(v: ViolacaoNormalizada, userAgent: string): void {
  console.warn(
    "[CSP:violacao] " +
      JSON.stringify({
        disposition: v.disposition,
        effectiveDirective: v.effectiveDirective,
        blockedURL: v.blockedURL,
        documentURL: v.documentURL,
        sourceFile: v.sourceFile,
        lineNumber: v.lineNumber,
        statusCode: v.statusCode,
        isPaymentRoute: v.isPaymentRoute,
        userAgent,
      }),
  );
}

export async function POST(req: Request) {
  try {
    const declarado = Number(req.headers.get("content-length") || "0");
    if (declarado > LIMITE_CORPO_BYTES) return VAZIO;

    const texto = await req.text();
    if (!texto || texto.length > LIMITE_CORPO_BYTES) return VAZIO;

    const corpo = JSON.parse(texto) as unknown;
    // Único header lido. NUNCA cookies, nunca Authorization: o corpo de um
    // relatório de CSP não deve carregar credencial e o log não pode virar um
    // lugar onde ela apareça.
    const userAgent = (req.headers.get("user-agent") || "").slice(0, 200);

    for (const bruto of extrairRelatorios(corpo).slice(0, MAX_RELATORIOS)) {
      const v = normalizarViolacao(bruto);
      if (!v) continue;

      const d = dedupe.registrar(v);
      if (d.acao === "integral") {
        logar(v, userAgent);
      } else if (d.acao === "agregado") {
        console.warn(`[CSP:violacao:agregado] ${d.chave} ocorrencias=${d.ocorrencias}`);
      }

      // A escrita no Redis segue como estava — é ela que alimenta o
      // diagnóstico. Só a primeira ocorrência da janela grava: o registro lá já
      // tem contador próprio e não precisa de uma ida por relatório recebido.
      if (d.acao === "integral") {
        await recordCspViolation({
          blocked_uri: v.blockedURL,
          violated_directive: v.effectiveDirective,
          document_uri: v.documentURL,
          user_agent: userAgent,
        });
      }
    }
  } catch {
    // Corpo malformado, Redis fora, o que for: o coletor nunca reclama.
  }
  return VAZIO;
}
