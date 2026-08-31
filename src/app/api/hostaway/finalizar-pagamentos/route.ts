import { NextResponse } from "next/server";
import {
  scanFinalizacoesHostaway,
  removerFinalizacaoHostaway,
  registrarFalhaFinalizacao,
  podeTentarFinalizacao,
} from "@/lib/kv-store";
import { listarCobrancasHostaway, registrarPagamentoHostaway } from "@/lib/hostaway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dreno da fila de marcação de pagamento na Hostaway.
 *
 * Roda por cron. Pega o que está maduro pelo backoff, tenta marcar, e só remove
 * da fila em caso de sucesso. O que esgotar as tentativas fica marcado como
 * escalado e aparece em `/api/admin/diagnostico` — nunca some em silêncio.
 *
 * Autorização igual à do pix-reconcile: segredo próprio para chamada manual, ou
 * o Bearer que a Vercel injeta no cron. Sem nenhum dos dois, 503.
 */

function autorizado(req: Request): boolean {
  const segredo = (process.env.HOSTAWAY_FINALIZE_SECRET || process.env.BRASPAG_RECONCILE_SECRET || "").trim();
  const cronSecret = (process.env.CRON_SECRET || "").trim();

  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (cronSecret && auth && auth === cronSecret) return true;

  const url = new URL(req.url);
  const informado = (req.headers.get("x-reconcile-secret") || url.searchParams.get("secret") || "").trim();
  if (segredo && informado && informado === segredo) return true;

  return false;
}

async function drenar(req: Request) {
  const temSegredo =
    (process.env.HOSTAWAY_FINALIZE_SECRET || process.env.BRASPAG_RECONCILE_SECRET || "").trim() ||
    (process.env.CRON_SECRET || "").trim();
  if (!temSegredo) {
    return NextResponse.json({ error: "endpoint sem segredo configurado" }, { status: 503 });
  }
  if (!autorizado(req)) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const todas = await scanFinalizacoesHostaway();
  const agora = Date.now();
  const maduras = todas.filter((r) => podeTentarFinalizacao(r, agora));

  const resultado = { total_na_fila: todas.length, tentadas: 0, sucesso: 0, falha: 0, puladas_idempotencia: 0 };

  for (const item of maduras) {
    resultado.tentadas++;

    // IDEMPOTÊNCIA: consulta antes de registrar. Uma cobrança duplicada na
    // contabilidade do PMS é pior que uma marcação pendente — a primeira
    // exige estorno manual e conversa com o hóspede, a segunda só espera.
    const existentes = await listarCobrancasHostaway(item.reservation_id);
    if (existentes === null) {
      // Consulta falhou: NÃO registra às cegas. Volta para a fila.
      await registrarFalhaFinalizacao(item.reservation_id, "consulta de cobranças falhou — não registrado");
      resultado.falha++;
      continue;
    }
    const jaTem = existentes.some(
      (c) => typeof c.amount === "number" && Math.abs(c.amount - item.amount) < 0.01,
    );
    if (jaTem) {
      console.log(
        `[Hostaway:fila] cobrança já existe reservation_id=${item.reservation_id} — removendo da fila`,
      );
      await removerFinalizacaoHostaway(item.reservation_id);
      resultado.puladas_idempotencia++;
      continue;
    }

    const r = await registrarPagamentoHostaway({
      reservationId: item.reservation_id,
      amount: item.amount,
      currency: item.currency,
      paymentMethod: item.payment_method,
    });

    if (r.ok) {
      await removerFinalizacaoHostaway(item.reservation_id);
      resultado.sucesso++;
      console.log(`[Hostaway:fila] marcada como paga reservation_id=${item.reservation_id}`);
    } else {
      await registrarFalhaFinalizacao(item.reservation_id, r.erro || `HTTP ${r.status}`);
      resultado.falha++;
    }
  }

  console.log("[Hostaway:fila] execução: " + JSON.stringify(resultado));
  return NextResponse.json({ ok: true, ...resultado });
}

/**
 * GET — usado pelo cron da Vercel, que só emite GET.
 */
export async function GET(req: Request) {
  return drenar(req);
}

/**
 * POST — mesma coisa, para agendador EXTERNO.
 *
 * Existe porque a cadência do cron depende do plano da Vercel: no Hobby só há
 * cron diario, e uma expressao de 5 minutos no `vercel.json` faz a Vercel rejeitar o
 * deployment em silencio. Com este POST, um agendador de fora (cron-job.org e
 * afins) chama a cada 5 minutos usando `HOSTAWAY_FINALIZE_SECRET`, sem depender
 * do plano.
 */
export async function POST(req: Request) {
  return drenar(req);
}
