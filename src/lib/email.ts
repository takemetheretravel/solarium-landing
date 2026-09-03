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

/**
 * Alerta de pagamento recusado ou bloqueado pelo antifraude.
 *
 * Carrega o diagnóstico COMPLETO — não só a mensagem ao cliente. Sem
 * ProviderReturnCode e os campos de antifraude, uma recusa real vira "não sei o
 * que aconteceu" dois dias depois (armadilha 5 do handoff).
 *
 * Quando a recusa é de pacote, o assunto muda: com a flag ligada em produção, o
 * primeiro cliente real é o teste, e essa falha não pode passar em silêncio.
 */
export async function enviarAlertaRecusa(dados: {
  hospede: string; propriedade: string; valor: number;
  motivo: string; mensagemCliente: string; draftId: string;
  pacoteNome?: string;
  merchantOrderId?: string;
  diagnostico?: {
    Status?: unknown;
    ReturnCode?: unknown;
    ReturnMessage?: unknown;
    ProviderReturnCode?: unknown;
    ProviderReturnMessage?: unknown;
    FraudAnalysisStatus?: unknown;
    FraudAnalysisReasonCode?: unknown;
    FraudScore?: unknown;
    PaymentId?: unknown;
    errorBody?: unknown;
  };
}) {
  try {
    const resend = getResend();
    if (!resend) return;

    const ehPacote = Boolean(dados.pacoteNome);
    const assunto = ehPacote
      ? `⚠️ PAGAMENTO DE PACOTE RECUSADO — ${dados.pacoteNome}`
      : `🚨 Pagamento recusado — ${dados.propriedade}`;

    const d = dados.diagnostico;
    const linha = (r: string, v: unknown) =>
      v === undefined || v === null || v === ""
        ? ""
        : `<tr><td style="padding:3px 10px 3px 0;color:#666">${r}</td><td><code>${
            typeof v === "object" ? JSON.stringify(v) : String(v)
          }</code></td></tr>`;

    const bloco = d
      ? `<h3 style="margin-top:18px">Diagnóstico</h3>
         <table style="font-size:13px;border-collapse:collapse">
           ${linha("Status", d.Status)}
           ${linha("ReturnCode", d.ReturnCode)}
           ${linha("ReturnMessage", d.ReturnMessage)}
           ${linha("ProviderReturnCode", d.ProviderReturnCode)}
           ${linha("ProviderReturnMessage", d.ProviderReturnMessage)}
           ${linha("FraudAnalysisStatus", d.FraudAnalysisStatus)}
           ${linha("FraudAnalysisReasonCode", d.FraudAnalysisReasonCode)}
           ${linha("FraudScore", d.FraudScore)}
           ${linha("PaymentId", d.PaymentId)}
           ${linha("errorBody", d.errorBody)}
         </table>`
      : "";

    await resend.emails.send({
      from: ALERTA_DE,
      to: ALERTA_PARA,
      subject: assunto,
      html: `
        <h2>${ehPacote ? "Pagamento de pacote recusado" : "Pagamento recusado"}</h2>
        ${dados.pacoteNome ? `<p><strong>Pacote:</strong> ${dados.pacoteNome}</p>` : ""}
        <p><strong>Cliente:</strong> ${dados.hospede}</p>
        <p><strong>Casa:</strong> ${dados.propriedade}</p>
        <p><strong>Valor:</strong> R$ ${dados.valor.toFixed(2)}</p>
        <p><strong>Motivo:</strong> ${dados.motivo}</p>
        <p><strong>O que o cliente viu:</strong> ${dados.mensagemCliente}</p>
        <p><strong>Sugestão de contato:</strong> oriente o cliente conforme o motivo, ou ofereça Pix.</p>
        ${bloco}
        <p style="color:#888;font-size:12px">
          Draft: ${dados.draftId}${dados.merchantOrderId ? ` · MerchantOrderId: ${dados.merchantOrderId}` : ""}
        </p>
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

/**
 * Falha TERMINAL de pagamento: o hóspede não tem mais caminho automático nesta
 * tentativa.
 *
 * POR QUE EXISTE. Só o caminho de sucesso notificava alguém. Em 28/08 seis
 * tentativas foram bloqueadas pelo antifraude em 18 minutos, o hóspede migrou
 * sozinho para a Cielo 44 minutos depois, e ninguém soube até alguém exportar
 * log da Vercel à mão. Falha silenciosa é venda perdida sem testemunha.
 *
 * Mesmo Resend, mesmo destinatário e mesmo remetente do alerta de aprovação —
 * nenhuma dependência nova.
 *
 * O ANTI-FLOOD NÃO MORA AQUI. Quem chama pergunta a `podeNotificarFalha()`
 * antes: a decisão de silenciar é de negócio e precisa ser testável sem mandar
 * e-mail.
 *
 * NUNCA inclui número completo de cartão, CVV ou validade.
 */
export async function enviarAlertaFalhaTerminal(dados: {
  draftId: string;
  provider: string;
  motivo: string;
  paymentId?: string;
  cardLast4?: string;
  valor?: number;
  listing?: string;
  checkin?: string;
  checkout?: string;
  hospede?: string;
  contato?: string;
}) {
  try {
    const resend = getResend();
    if (!resend) return;

    const linha = (rotulo: string, valor?: string | number) =>
      valor === undefined || valor === "" || valor === null
        ? ""
        : `<p><strong>${rotulo}:</strong> ${valor}</p>`;

    const quando = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

    await resend.emails.send({
      from: ALERTA_DE,
      to: ALERTA_PARA,
      subject: `[Solarium] Falha no pagamento — ${dados.draftId}`,
      html: `
        <h2>Falha terminal de pagamento</h2>
        <p>O hóspede não tem mais caminho automático nesta tentativa. Vale contato.</p>
        ${linha("Draft", dados.draftId)}
        ${linha("Gateway", dados.provider)}
        ${linha("Motivo", dados.motivo)}
        ${linha("PaymentId", dados.paymentId)}
        ${linha("Cartão (últimos 4)", dados.cardLast4 ? `•••• ${dados.cardLast4}` : undefined)}
        ${linha("Valor", dados.valor !== undefined ? `R$ ${dados.valor.toFixed(2)}` : undefined)}
        ${linha("Listing", dados.listing)}
        ${linha("Datas", dados.checkin && dados.checkout ? `${dados.checkin} → ${dados.checkout}` : undefined)}
        ${linha("Hóspede", dados.hospede)}
        ${linha("Contato", dados.contato)}
        ${linha("Horário", quando)}
        <hr />
        <p style="font-size:12px;color:#666">
          No máximo um aviso por draft a cada 15 minutos. Se o hóspede tentar seis
          vezes, chegam no máximo dois e-mails.
        </p>
      `,
    });
    console.log(`[Email] alerta de falha terminal enviado draftId=${dados.draftId}`);
  } catch (err) {
    // Notificação NUNCA derruba o fluxo de pagamento.
    console.error("[Email:falhaTerminal] Failed:", err);
  }
}
