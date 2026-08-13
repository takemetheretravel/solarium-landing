import { Resend } from "resend";

const ALERTA_PARA = "takemethere.mgmt@gmail.com";
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

// Salvaguarda crítica: pagamento CONFIRMADO mas a reserva no Hostaway falhou.
// Exige intervenção manual imediata (não há hold de datas — decisão de negócio).
export async function enviarAlertaPagamentoSemReserva(dados: {
  metodo: "pix" | "card";
  hospede: string;
  propriedade: string;
  valor: number;
  checkin: string;
  checkout: string;
  email: string;
  telefone: string;
  paymentId: string;
  draftId: string;
  erro: string;
}) {
  try {
    const resend = getResend();
    if (!resend) return;
    const metodoLabel = dados.metodo === "pix" ? "PIX" : "CARTÃO";
    await resend.emails.send({
      from: ALERTA_DE,
      to: ALERTA_PARA,
      subject: `⚠️ ${metodoLabel} PAGO SEM RESERVA CRIADA — ${dados.propriedade}`,
      html: `
        <h2 style="color:#c00">⚠️ Pagamento recebido, reserva NÃO criada</h2>
        <p>O pagamento foi <strong>confirmado</strong>, mas a criação da reserva no Hostaway
        falhou. <strong>Criar a reserva manualmente AGORA</strong> (o dinheiro já entrou).</p>
        <p><strong>Método:</strong> ${metodoLabel}</p>
        <p><strong>Cliente:</strong> ${dados.hospede}</p>
        <p><strong>Contato:</strong> ${dados.email} · ${dados.telefone}</p>
        <p><strong>Casa:</strong> ${dados.propriedade}</p>
        <p><strong>Período:</strong> ${dados.checkin} → ${dados.checkout}</p>
        <p><strong>Valor:</strong> R$ ${dados.valor.toFixed(2)}</p>
        <p><strong>PaymentId:</strong> ${dados.paymentId}</p>
        <p><strong>Erro:</strong> ${dados.erro}</p>
        <p style="color:#888;font-size:12px">Draft: ${dados.draftId} — a reconciliação também
        tentará recriar automaticamente (chave braspag:pix-orfao).</p>
      `,
    });
  } catch (e) {
    console.error("[Email] Falha ao enviar alerta de pagamento-sem-reserva:", e);
  }
}

export async function enviarAlertaAprovacao(dados: {
  hospede: string; propriedade: string; valor: number;
  checkin: string; checkout: string; noites: number;
  metodo: string; hostawayUrl?: string; shortNotice?: boolean;
  serviceExtras?: { label: string; qty: number; note?: string }[];
  opExtras?: { label: string; blockedNight: string; blockFailed?: boolean }[];
  // --- Pacotes V2 ---
  pacoteNome?: string;
  /** Bloco EXTRAS A PROVIDENCIAR: item, quantidade, entrega e prazo de fornecedor. */
  extrasProvidenciar?: {
    nome: string;
    qtd: number;
    dataEntrega?: string;
    prazoFornecedorDias?: number;
    nota?: string;
  }[];
  dataLimiteCancelamentoExtras?: string;
  reservaTeste?: boolean;
}) {
  try {
    const resend = getResend();
    if (!resend) return;
    const marcaTeste = dados.reservaTeste ? "[TESTE] " : "";
    await resend.emails.send({
      from: ALERTA_DE,
      to: ALERTA_PARA,
      subject: `${marcaTeste}${dados.shortNotice ? "⚠️ URGENTE — " : ""}✅ Reserva confirmada — ${dados.propriedade}`,
      html: `
        ${dados.reservaTeste ? '<p style="background:#ffe;border:2px solid #cc0;padding:10px;font-weight:bold">🧪 RESERVA DE TESTE — não operar. Registrar em docs/reservas-teste-pacotes-v2.md e estornar.</p>' : ""}
        ${dados.shortNotice ? '<p style="color:#c00;font-weight:bold">Check-in em menos de 3 dias — acionar parceiros do pacote imediatamente.</p>' : ""}
        <h2>Reserva confirmada</h2>
        <p><strong>Cliente:</strong> ${dados.hospede}</p>
        <p><strong>Casa:</strong> ${dados.propriedade}</p>
        ${dados.pacoteNome ? `<p><strong>Pacote:</strong> ${dados.pacoteNome}</p>` : ""}
        <p><strong>Valor:</strong> R$ ${dados.valor.toFixed(2)} (${dados.metodo})</p>
        <p><strong>Período:</strong> ${dados.checkin} → ${dados.checkout} (${dados.noites} noites)</p>
        ${blocoExtrasProvidenciar(dados.extrasProvidenciar)}
        ${dados.serviceExtras?.length ? `<p><strong>Extras de serviço a acionar:</strong></p><ul>${dados.serviceExtras.map((e) => `<li>${e.qty}× ${e.label}${e.note ? ` — ${e.note}` : ""}</li>`).join("")}</ul>` : ""}
        ${dados.opExtras?.length ? `<p><strong>Extras operacionais:</strong></p><ul>${dados.opExtras.map((e) => `<li>${e.label} — noite bloqueada: ${e.blockedNight}${e.blockFailed ? ' <strong style="color:#c00">⚠️ BLOQUEAR MANUALMENTE</strong>' : " ✅"}</li>`).join("")}</ul>` : ""}
        ${dados.dataLimiteCancelamentoExtras ? `<p style="color:#555"><strong>Extras canceláveis com reembolso integral até:</strong> ${dados.dataLimiteCancelamentoExtras}</p>` : ""}
        ${dados.hostawayUrl ? `<p><a href="${dados.hostawayUrl}">Abrir no Hostaway para marcar como paga</a></p>` : ""}
      `,
    });
  } catch (e) {
    console.error("[Email] Falha ao enviar alerta de aprovação:", e);
  }
}

/**
 * Bloco EXTRAS A PROVIDENCIAR do alerta interno.
 *
 * Um extra pago que a equipe não enxerga é pior que um extra não vendido — por
 * isso o bloco vem antes dos demais e destaca o prazo de fornecedor.
 */
function blocoExtrasProvidenciar(
  itens?: {
    nome: string;
    qtd: number;
    dataEntrega?: string;
    prazoFornecedorDias?: number;
    nota?: string;
  }[],
): string {
  if (!itens?.length) return "";
  const linhas = itens
    .map((e) => {
      const partes = [`<strong>${e.qtd}× ${e.nome}</strong>`];
      if (e.dataEntrega) partes.push(`entrega ${e.dataEntrega}`);
      if (e.prazoFornecedorDias !== undefined) {
        partes.push(`prazo do fornecedor: ${e.prazoFornecedorDias} dia(s)`);
      }
      if (e.nota) partes.push(e.nota);
      return `<li>${partes.join(" — ")}</li>`;
    })
    .join("");
  return `
    <div style="border:2px solid #c60;padding:12px;margin:16px 0;background:#fff8f0">
      <p style="margin:0 0 8px;font-weight:bold;color:#c60">EXTRAS A PROVIDENCIAR</p>
      <ul style="margin:0">${linhas}</ul>
    </div>`;
}
