import { createHash } from "crypto";
import { higienizarRelatorio } from "@/lib/csp";
import { permitirRelatorioCsp, registrarViolacoesCsp } from "@/lib/kv-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Recebe as violações da CSP report-only da página de pagamento (PAG1b).
//   POST /api/csp-report   (application/csp-report ou application/reports+json)
// Rota pública por natureza — quem chama é o navegador do hóspede. Por isso:
// corpo limitado a 16 KB, taxa limitada, e só o resumo higienizado é gravado.
// Responde SEMPRE 204: nada a devolver, e nenhuma pista para quem sonda.
const LIMITE_CORPO = 16 * 1024;

function semConteudo() {
  return new Response(null, { status: 204 });
}

/** Lê o corpo até o limite. Passou dele, desiste e devolve null. */
async function lerCorpoLimitado(req: Request, limite: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limite) {
      await reader.cancel().catch(() => {});
      return null;
    }
    partes.push(value);
  }
  return Buffer.concat(partes).toString("utf-8");
}

/** Hash curto do IP, só para a chave de taxa (vive 2 minutos). O IP não é gravado. */
function remetente(req: Request): string {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim() || "sem-ip";
  return createHash("sha256").update(`csp-report:${ip}`).digest("hex").slice(0, 16);
}

export async function POST(req: Request) {
  try {
    const declarado = Number(req.headers.get("content-length") || 0);
    if (declarado > LIMITE_CORPO) return semConteudo();

    const corpo = await lerCorpoLimitado(req, LIMITE_CORPO);
    if (corpo === null || corpo === "") return semConteudo();

    if (!(await permitirRelatorioCsp(remetente(req)))) return semConteudo();

    let json: unknown;
    try {
      json = JSON.parse(corpo);
    } catch {
      return semConteudo();
    }
    await registrarViolacoesCsp(higienizarRelatorio(json));
  } catch (err) {
    console.error("[/api/csp-report] erro:", err instanceof Error ? err.message : "desconhecido");
  }
  return semConteudo();
}
