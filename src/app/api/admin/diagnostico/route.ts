import { NextResponse } from "next/server";
import {
  scanCspViolations,
  scanReconciliationPending,
  scanFinalizacoesHostaway,
} from "@/lib/kv-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Consulta operacional: o que a CSP relatou e o que ficou sem reconciliar.
 *
 * Enquanto a CSP roda em Report-Only, `csp_violations` é a lista de origens
 * legítimas que faltam na política. Cada linha aqui é uma origem a acrescentar
 * ANTES de promover a bloqueio — nunca um motivo para bloquear mais cedo.
 *
 * Sem UI: é consulta manual.
 */

/** Comparação em tempo constante — evita vazar o token por tempo de resposta. */
function tokenConfere(recebido: string, esperado: string): boolean {
  if (recebido.length !== esperado.length) return false;
  let diff = 0;
  for (let i = 0; i < recebido.length; i++) {
    diff |= recebido.charCodeAt(i) ^ esperado.charCodeAt(i);
  }
  return diff === 0;
}

export async function GET(req: Request) {
  // `.trim()` nos DOIS lados. A comparação é byte-a-byte, e um valor colado no
  // painel da Vercel costuma carregar quebra de linha ou espaço invisível na
  // ponta — isso derrubava um token correto em 401. Só as extremidades são
  // normalizadas: aspas e qualquer outro caractere continuam significativos.
  const esperado = (process.env.ADMIN_API_TOKEN || "").trim();
  // Sem token configurado o endpoint fica FECHADO, nunca aberto.
  if (!esperado) {
    return NextResponse.json({ error: "ADMIN_API_TOKEN não configurado" }, { status: 503 });
  }

  const recebido = (
    req.headers.get("x-admin-token") ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
  ).trim();
  if (!recebido || !tokenConfere(recebido, esperado)) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const [violacoes, pendencias, finalizacoes] = await Promise.all([
    scanCspViolations(),
    scanReconciliationPending(),
    scanFinalizacoesHostaway(),
  ]);

  return NextResponse.json({
    csp: {
      modo: (process.env.CSP_MODE || "report-only").trim().toLowerCase(),
      total_origens_distintas: violacoes.length,
      total_relatorios: violacoes.reduce((s, v) => s + v.count, 0),
      // Já vem ordenado por contagem.
      violacoes: violacoes.map((v) => ({
        blocked_uri: v.blocked_uri,
        violated_directive: v.violated_directive,
        document_uri: v.document_uri,
        count: v.count,
        first_seen: v.first_seen,
        last_seen: v.last_seen,
      })),
    },
    hostaway_finalizacao: {
      total_na_fila: finalizacoes.length,
      // Escalados primeiro: são os que exigem uma pessoa.
      escalados: finalizacoes.filter((f) => f.escalado).length,
      itens: finalizacoes
        .slice()
        .sort((a, b) => Number(b.escalado ?? false) - Number(a.escalado ?? false))
        .map((f) => ({
          reservation_id: f.reservation_id,
          payment_method: f.payment_method,
          amount: f.amount,
          attempts: f.attempts,
          escalado: Boolean(f.escalado),
          created_at: f.created_at,
          last_attempt_at: f.last_attempt_at,
          last_error: f.last_error,
        })),
    },
    reconciliacao: {
      total: pendencias.length,
      pendencias: pendencias
        .slice()
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .map((p) => ({
          payment_id: p.payment_id,
          received_at: p.created_at,
          source: p.source,
          motivo: p.reason,
        })),
    },
  });
}
