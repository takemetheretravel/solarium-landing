import { NextResponse } from "next/server";
import type { ReservationDraft } from "@/lib/kv-store";
import { reservarEnvioUnico } from "@/lib/kv-store";
import { enviarAlertaBloqueioAnalise } from "@/lib/email";
import { TEXTO_ESPERA } from "@/lib/comunicacao-analise";

// Bloqueio server-side de draft em `aguardando_analise` (rodada AF1).
//
// O draft já tem uma autorização de cartão viva à espera do antifraude. Qualquer
// outra rota de pagamento que aceite o mesmo draftId geraria cobrança duplicada.
// A tela já tira o hóspede do fluxo; isto fecha a chamada direta à API.
// Chamar logo depois de ler o draft e ANTES de qualquer chamada ao gateway.
//
// Ao hóspede: o mesmo texto neutro da tela de espera (A2b).
// Ao operador: log e alerta dizem que o bloqueio veio do estado de análise e que
// a saída é POST /api/admin/antifraude — inclusive quando alguém tenta
// redirecionar o pagamento para a Cielo à mão.

export const MENSAGEM_BLOQUEIO = `${TEXTO_ESPERA.titulo} ${TEXTO_ESPERA.corpo}`;

const RESOLUCAO = 'POST /api/admin/antifraude { "paymentId": "<PaymentId>" }';

export async function barrarSeEmAnalise(
  draft: ReservationDraft,
  draftId: string,
  rota: string,
): Promise<NextResponse | null> {
  if (draft.status !== "aguardando_analise") return null;

  const paymentId = draft.analise?.paymentId ?? null;
  console.error(
    "[Bloqueio:aguardando_analise]",
    JSON.stringify({
      rota,
      draftId,
      paymentId,
      motivo: "draft em aguardando_analise: já existe autorização de cartão viva; pagamento por esta rota barrado no servidor",
      resolver: RESOLUCAO,
    }),
  );

  // Um alerta por draft e rota a cada 24h: a rota pode ser chamada em loop.
  if (await reservarEnvioUnico(`alerta:bloqueio-analise:${draftId}:${rota}`, 24 * 60 * 60)) {
    await enviarAlertaBloqueioAnalise({
      rota,
      draftId,
      paymentId,
      propriedade: draft.propertyName,
      resolver: RESOLUCAO,
    });
  }

  return NextResponse.json(
    {
      // Campos que cada contrato de rota já lê: `error` (Pix), `approved` e
      // `returnMessage` (cartão), `estado` e `redirectTo` (tela A2b).
      approved: false,
      estado: "aguardando_analise",
      error: MENSAGEM_BLOQUEIO,
      returnMessage: MENSAGEM_BLOQUEIO,
      redirectTo: `/reservar/${draftId}/confirmacao`,
    },
    { status: 409 },
  );
}
