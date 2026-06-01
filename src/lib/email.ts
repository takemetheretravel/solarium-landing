import { Resend } from "resend";

const ALERTA_PARA = "lucas.c.mancilha@gmail.com";
const ALERTA_DE = "Solarium Alertas <onboarding@resend.dev>";

// Instanciação lazy: o construtor do Resend lança erro se a chave não existe.
// Durante o build (sem RESEND_API_KEY local) isso quebraria a coleta de dados da rota.
// Criamos o cliente só em runtime, quando a função é chamada na Vercel.
function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("[Email] RESEND_API_KEY ausente — alerta não enviado.");
    return null;
  }
  return new Resend(key);
}

export async function enviarAlertaRecusa(dados: {
  hospede: string; propriedade: string; valor: number;
  motivo: string; mensagemCliente: string; draftId: string;
}) {
  try {
    const resend = getResend();
    if (!resend) return;
    await resend.emails.send({
      from: ALERTA_DE,
      to: ALERTA_PARA,
      subject: `🚨 Pagamento recusado — ${dados.propriedade}`,
      html: `
        <h2>Pagamento recusado</h2>
        <p><strong>Cliente:</strong> ${dados.hospede}</p>
        <p><strong>Casa:</strong> ${dados.propriedade}</p>
        <p><strong>Valor:</strong> R$ ${dados.valor.toFixed(2)}</p>
        <p><strong>Motivo:</strong> ${dados.motivo}</p>
        <p><strong>O que o cliente viu:</strong> ${dados.mensagemCliente}</p>
        <p><strong>Sugestão de contato:</strong> oriente o cliente conforme o motivo, ou ofereça Pix.</p>
        <p style="color:#888;font-size:12px">Draft: ${dados.draftId}</p>
      `,
    });
  } catch (e) {
    console.error("[Email] Falha ao enviar alerta de recusa:", e);
  }
}

export async function enviarAlertaAprovacao(dados: {
  hospede: string; propriedade: string; valor: number;
  checkin: string; checkout: string; noites: number;
  metodo: string; hostawayUrl?: string;
}) {
  try {
    const resend = getResend();
    if (!resend) return;
    await resend.emails.send({
      from: ALERTA_DE,
      to: ALERTA_PARA,
      subject: `✅ Reserva confirmada — ${dados.propriedade}`,
      html: `
        <h2>Reserva confirmada</h2>
        <p><strong>Cliente:</strong> ${dados.hospede}</p>
        <p><strong>Casa:</strong> ${dados.propriedade}</p>
        <p><strong>Valor:</strong> R$ ${dados.valor.toFixed(2)} (${dados.metodo})</p>
        <p><strong>Período:</strong> ${dados.checkin} → ${dados.checkout} (${dados.noites} noites)</p>
        ${dados.hostawayUrl ? `<p><a href="${dados.hostawayUrl}">Abrir no Hostaway para marcar como paga</a></p>` : ""}
      `,
    });
  } catch (e) {
    console.error("[Email] Falha ao enviar alerta de aprovação:", e);
  }
}
