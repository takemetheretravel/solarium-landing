import { getDraft, podeNotificarFalha } from "@/lib/kv-store";
import { enviarAlertaFalhaTerminal } from "@/lib/email";

/**
 * Porta única da notificação de falha terminal.
 *
 * Junta as três coisas que todo chamador precisaria repetir: consultar o
 * anti-flood, enriquecer com os dados do draft e nunca deixar a notificação
 * derrubar o pagamento.
 *
 * ANTI-FLOOD: no máximo 1 por draft a cada 15 minutos. As seis tentativas do
 * incidente de 28/08 (18 minutos) geram no máximo 2 e-mails.
 *
 * NUNCA lança. Um `await` disto no meio de uma rota de pagamento não pode ser o
 * motivo de a rota falhar.
 */
export async function notificarFalhaTerminal(dados: {
  draftId: string;
  provider: string;
  motivo: string;
  paymentId?: string;
  cardLast4?: string;
  detalhe?: string;
}): Promise<void> {
  try {
    if (!dados.draftId) return;

    if (!(await podeNotificarFalha(dados.draftId))) {
      console.log(
        `[FalhaTerminal] silenciada pelo anti-flood draftId=${dados.draftId} motivo=${dados.motivo}`,
      );
      return;
    }

    // Enriquecimento é BEST-EFFORT: draft expirado ou Redis fora não impede o
    // aviso. Um e-mail com menos campos vale mais que nenhum e-mail.
    const draft = await getDraft(dados.draftId).catch(() => null);

    console.error(
      `[FalhaTerminal] draftId=${dados.draftId} provider=${dados.provider} ` +
        `motivo=${dados.motivo}${dados.detalhe ? ` detalhe=${dados.detalhe}` : ""}`,
    );

    await enviarAlertaFalhaTerminal({
      draftId: dados.draftId,
      provider: dados.provider,
      motivo: dados.detalhe ? `${dados.motivo} — ${dados.detalhe}` : dados.motivo,
      paymentId: dados.paymentId,
      cardLast4: dados.cardLast4,
      valor: draft?.finalTotal,
      listing: draft?.propertyName,
      checkin: draft?.checkin,
      checkout: draft?.checkout,
      hospede: draft ? `${draft.guestFirstName} ${draft.guestLastName}`.trim() : undefined,
      contato: draft ? `${draft.guestEmail} · ${draft.guestPhone}` : undefined,
    });
  } catch (err) {
    console.error("[FalhaTerminal] falhou ao notificar:", (err as Error)?.message);
  }
}
