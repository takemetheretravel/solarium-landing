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
 * Alerta INTERNO: cartão autorizado caiu em Review e ficou à espera da decisão
 * do analista (rodada A2a). Nada foi capturado nem reservado ainda; as noites
 * estão seguradas no calendário. A decisão chega por notificação da Braspag.
 */
export async function enviarAlertaEmAnalise(dados: {
  hospede: string;
  propriedade: string;
  valor: number;
  parcelas: number;
  checkin: string;
  checkout: string;
  paymentId: string;
  draftId: string;
  merchantOrderId: string;
  bloqueios: { listingId: number; noite: string }[];
  /** Resultado do e-mail de espera ao hóspede (A2b). */
  emailHospede?: string;
}) {
  try {
    const resend = getResend();
    if (!resend) return;
    const noites = dados.bloqueios.map((b) => `<li>${b.noite} · listing ${b.listingId}</li>`).join("");
    await resend.emails.send({
      from: ALERTA_DE,
      to: ALERTA_PARA,
      subject: `⏳ Cartão em revisão do antifraude — ${dados.propriedade} — R$ ${dados.valor.toFixed(2)}`,
      html: `
        <h2 style="color:#c60">⏳ Pagamento autorizado, aguardando a revisão do antifraude</h2>
        <p>A autorização está <strong>viva e NÃO capturada</strong>. Nenhuma reserva foi criada.
        As noites abaixo foram bloqueadas no Hostaway para segurar as datas.</p>
        <p><strong>Não capturar nem cancelar manualmente.</strong> A decisão do analista chega por
        notificação da Braspag. Se nada chegar em 6h, conferir a transação no portal.</p>
        <p><strong>Cliente:</strong> ${dados.hospede}</p>
        <p><strong>Casa:</strong> ${dados.propriedade}</p>
        <p><strong>Período:</strong> ${dados.checkin} → ${dados.checkout}</p>
        <p><strong>Valor autorizado:</strong> R$ ${dados.valor.toFixed(2)} em ${dados.parcelas}x</p>
        <p><strong>PaymentId:</strong> ${dados.paymentId}</p>
        <p><strong>Noites bloqueadas:</strong></p>
        <ul>${noites}</ul>
        <p><strong>O que o cliente viu:</strong> que a reserva foi recebida e que a confirmação chega por e-mail em algumas horas.</p>
        ${dados.emailHospede ? `<p><strong>E-mail ao cliente:</strong> ${dados.emailHospede}${dados.emailHospede.startsWith("NÃO") ? " — <strong style=\"color:#c00\">avisar o cliente pelo WhatsApp</strong>" : ""}</p>` : ""}
        <p style="color:#888;font-size:12px">Draft: ${dados.draftId} · MerchantOrderId: ${dados.merchantOrderId}</p>
      `,
    });
  } catch (e) {
    console.error("[Email] Falha ao enviar alerta de análise:", e);
  }
}

// Rodada AF1: chamada a uma rota de pagamento para um draft em análise, barrada
// no servidor. Sem nome, e-mail ou CPF do hóspede.
export async function enviarAlertaBloqueioAnalise(dados: {
  rota: string;
  draftId: string;
  paymentId: string | null;
  propriedade: string;
  resolver: string;
}) {
  try {
    const resend = getResend();
    if (!resend) return;
    await resend.emails.send({
      from: ALERTA_DE,
      to: ALERTA_PARA,
      subject: `⛔ Pagamento barrado: draft em análise do antifraude — ${dados.propriedade}`,
      html: `
        <h2 style="color:#c60">⛔ Nova tentativa de pagamento barrada</h2>
        <p>O draft está em <strong>aguardando_analise</strong>: já existe uma autorização de cartão
        viva, não capturada, à espera da decisão do antifraude. A rota abaixo foi chamada para o
        mesmo draft e <strong>recusada no servidor</strong>, sem chamar gateway nenhum.</p>
        <p><strong>Rota:</strong> ${dados.rota}</p>
        <p><strong>Casa:</strong> ${dados.propriedade}</p>
        <p><strong>PaymentId em análise:</strong> ${dados.paymentId ?? "—"}</p>
        <p><strong>Para liberar:</strong> resolver a análise por <code>${dados.resolver}</code>.
        Só depois disso outra forma de pagamento (inclusive Cielo manual) é aceita para este draft.</p>
        <p style="color:#888;font-size:12px">Draft: ${dados.draftId}</p>
      `,
    });
  } catch (e) {
    console.error("[Email] Falha ao enviar alerta de bloqueio por análise:", e);
  }
}

/**
 * E-mail AO HÓSPEDE (rodada A2b). Usa o mesmo cliente Resend dos alertas, com
 * remetente próprio: `onboarding@resend.dev`, o remetente dos alertas, só entrega
 * para o dono da conta Resend. Sem EMAIL_REMETENTE_HOSPEDE (endereço de domínio
 * verificado no Resend), não envia e diz por quê — nunca finge que enviou.
 */
export async function enviarEmailHospede(dados: {
  para: string;
  assunto: string;
  html: string;
  texto: string;
}): Promise<{ enviado: true } | { enviado: false; motivo: string }> {
  const remetente = (process.env.EMAIL_REMETENTE_HOSPEDE || "").trim();
  if (!remetente) {
    console.error("[Email:hospede] EMAIL_REMETENTE_HOSPEDE ausente — e-mail ao hóspede não enviado.");
    return { enviado: false, motivo: "EMAIL_REMETENTE_HOSPEDE ausente" };
  }
  try {
    const resend = getResend();
    if (!resend) return { enviado: false, motivo: "RESEND_API_KEY ausente" };
    // O SDK do Resend não lança em recusa: devolve { error }.
    const r = await resend.emails.send({
      from: remetente,
      to: dados.para,
      subject: dados.assunto,
      html: dados.html,
      text: dados.texto,
    });
    if (r.error) {
      console.error("[Email:hospede] Resend recusou:", r.error.message);
      return { enviado: false, motivo: `Resend: ${r.error.message}` };
    }
    return { enviado: true };
  } catch (e) {
    console.error("[Email:hospede] Falha ao enviar:", e);
    return { enviado: false, motivo: (e as Error)?.message || "exceção" };
  }
}

/**
 * Alerta INTERNO do desfecho de um pagamento que estava em revisão (rodada A3).
 * Captura que falha depois do Accept é o caso com destaque: a autorização pode
 * expirar e o hóspede já foi aprovado.
 */
export async function enviarAlertaDesfechoAnalise(dados: {
  tipo: "captura-falhou" | "recusado" | "indefinido";
  hospede: string;
  propriedade: string;
  valor: number;
  checkin: string;
  checkout: string;
  paymentId: string;
  draftId: string;
  origem: string;
  detalhe: string;
}) {
  const titulos = {
    "captura-falhou": {
      assunto: `🚨 CAPTURA FALHOU após aprovação — ${dados.propriedade} — R$ ${dados.valor.toFixed(2)}`,
      h2: '<h2 style="color:#c00">🚨 O analista aprovou, mas a captura NÃO foi concluída</h2>',
      acao:
        "<p><strong>Nada foi marcado como pago e nenhuma reserva foi criada.</strong> As noites continuam bloqueadas. " +
        "A próxima notificação ou a reconciliação manual (<code>POST /api/admin/antifraude</code>) tenta capturar de novo. " +
        "Não há prazo garantido de validade da autorização: tratar hoje.</p>",
    },
    recusado: {
      assunto: `Revisão do antifraude recusou — ${dados.propriedade} — R$ ${dados.valor.toFixed(2)}`,
      h2: "<h2>Revisão do antifraude recusou o pagamento</h2>",
      acao:
        "<p>As noites seguradas foram liberadas e o draft ficou como recusado. O gateway cancela a autorização sozinho. " +
        "O cliente recebeu o convite para tentar outro meio de pagamento.</p>",
    },
    indefinido: {
      assunto: `⚠️ Revisão do antifraude sem desfecho legível — ${dados.propriedade}`,
      h2: '<h2 style="color:#c60">⚠️ A consulta à Braspag não trouxe Accept nem Reject</h2>',
      acao: "<p>Nada foi feito. Conferir a transação no portal e reconciliar manualmente.</p>",
    },
  }[dados.tipo];

  try {
    const resend = getResend();
    if (!resend) return;
    await resend.emails.send({
      from: ALERTA_DE,
      to: ALERTA_PARA,
      subject: titulos.assunto,
      html: `
        ${titulos.h2}
        ${titulos.acao}
        <p><strong>Detalhe:</strong> ${dados.detalhe}</p>
        <p><strong>Cliente:</strong> ${dados.hospede}</p>
        <p><strong>Casa:</strong> ${dados.propriedade}</p>
        <p><strong>Período:</strong> ${dados.checkin} → ${dados.checkout}</p>
        <p><strong>Valor autorizado:</strong> R$ ${dados.valor.toFixed(2)}</p>
        <p><strong>PaymentId:</strong> ${dados.paymentId}</p>
        <p style="color:#888;font-size:12px">Draft: ${dados.draftId} · origem: ${dados.origem}</p>
      `,
    });
  } catch (e) {
    console.error("[Email] Falha ao enviar alerta de desfecho da análise:", e);
  }
}
