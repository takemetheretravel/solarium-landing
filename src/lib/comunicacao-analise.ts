import type { ReservationDraft } from "@/lib/kv-store";
import { reservarEnvioUnico, liberarEnvioUnico } from "@/lib/kv-store";
import { enviarEmailHospede } from "@/lib/email";
import { SITE, whatsappLink } from "@/config/site";

// =============================================================================
// Comunicação com o hóspede enquanto o cartão está em `aguardando_analise`
// (rodada A2b). Tela e e-mail leem os textos DAQUI, para dizerem a mesma coisa.
//
// LINGUAGEM — não negociável. Nunca, com o hóspede: "avaliação", "análise",
// "risco", "antifraude", "pendente", "em processamento", "verificação". Nunca
// "reserva confirmada" nem "pagamento aprovado": ainda não aconteceu. Quem
// acabou de passar um cartão de alto valor lê qualquer uma dessas como problema
// com ele. Os nomes internos (arquivo, funções) podem falar em análise; o texto
// que chega ao hóspede, não.
// =============================================================================

export const TEXTO_ESPERA = {
  selo: "Reserva recebida",
  titulo: "Recebemos sua reserva.",
  corpo:
    "O pagamento foi autorizado e estamos finalizando a confirmação. Você recebe o e-mail com todos os detalhes em algumas horas.",
  apoio: "Se precisar de qualquer coisa antes disso, é só chamar no WhatsApp.",
  rotuloValor: "Valor autorizado",
  botao: "Falar com o concierge",
} as const;

export type VarianteConfirmacao = "confirmada" | "espera" | "sem-confirmacao";

/**
 * Qual versão da página de confirmação mostrar.
 *  - paid → a confirmação de sempre (com purchase);
 *  - aguardando_analise → a espera (sem purchase);
 *  - qualquer outra coisa → a página redireciona, como antes.
 */
export function varianteConfirmacao(draft: Pick<ReservationDraft, "status"> | null): VarianteConfirmacao {
  if (draft?.status === "paid") return "confirmada";
  if (draft?.status === "aguardando_analise") return "espera";
  return "sem-confirmacao";
}

function formatBR(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function mensagemWhatsappEspera(draft: Pick<ReservationDraft, "propertyName" | "checkin" | "checkout">, draftId: string) {
  return `Olá! Acabei de fazer minha reserva no ${draft.propertyName} de ${formatBR(draft.checkin)} a ${formatBR(draft.checkout)}. ID: ${draftId.slice(0, 8).toUpperCase()}`;
}

/** E-mail ao hóspede. Puro: devolve assunto, HTML e texto, sem enviar. */
export function montarEmailEspera(
  draft: Pick<ReservationDraft, "guestFirstName" | "propertyName" | "checkin" | "checkout" | "guests">,
  draftId: string,
  valorAutorizado: number,
) {
  const nome = draft.guestFirstName.trim().split(/\s+/)[0] || "";
  const valor = valorAutorizado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const whatsapp = whatsappLink(mensagemWhatsappEspera(draft, draftId));
  const id = draftId.slice(0, 8).toUpperCase();
  const assunto = `${TEXTO_ESPERA.titulo.replace(/\.$/, "")} — ${draft.propertyName}`;

  const texto = [
    nome ? `Olá, ${nome}.` : "Olá.",
    "",
    TEXTO_ESPERA.titulo,
    TEXTO_ESPERA.corpo,
    "",
    `${draft.propertyName}`,
    `Check-in: ${formatBR(draft.checkin)} às 15h`,
    `Check-out: ${formatBR(draft.checkout)} às 11h`,
    `Hóspedes: ${draft.guests}`,
    `${TEXTO_ESPERA.rotuloValor}: ${valor}`,
    "",
    TEXTO_ESPERA.apoio,
    `WhatsApp: ${SITE.whatsappDisplay} — ${whatsapp}`,
    "",
    `ID da reserva: ${id}`,
    "Solarium Mantiqueira",
  ].join("\n");

  const html = `
    <div style="font-family:Georgia,serif;color:#2b2b2b;max-width:560px;margin:0 auto;padding:24px">
      <p style="font-family:Arial,sans-serif;font-size:14px">${nome ? `Olá, ${escapar(nome)}.` : "Olá."}</p>
      <h1 style="font-weight:normal;font-size:26px;margin:24px 0 12px">${TEXTO_ESPERA.titulo}</h1>
      <p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6">${TEXTO_ESPERA.corpo}</p>
      <table style="font-family:Arial,sans-serif;font-size:14px;border-top:1px solid #ddd;margin:24px 0;padding-top:12px;width:100%">
        <tr><td colspan="2" style="font-family:Georgia,serif;font-size:18px;padding-bottom:8px">${escapar(draft.propertyName)}</td></tr>
        <tr><td style="color:#777">Check-in</td><td style="text-align:right">${formatBR(draft.checkin)} às 15h</td></tr>
        <tr><td style="color:#777">Check-out</td><td style="text-align:right">${formatBR(draft.checkout)} às 11h</td></tr>
        <tr><td style="color:#777">Hóspedes</td><td style="text-align:right">${draft.guests}</td></tr>
        <tr><td style="color:#777">${TEXTO_ESPERA.rotuloValor}</td><td style="text-align:right">${valor}</td></tr>
      </table>
      <p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6">${TEXTO_ESPERA.apoio}</p>
      <p><a href="${whatsapp}" style="display:inline-block;background:#25D366;color:#fff;padding:12px 24px;text-decoration:none;font-family:Arial,sans-serif;font-size:13px;letter-spacing:1px;text-transform:uppercase">${TEXTO_ESPERA.botao}</a></p>
      <p style="font-family:Arial,sans-serif;font-size:12px;color:#999;margin-top:32px">ID da reserva: ${id} · Solarium Mantiqueira</p>
    </div>`;

  return { assunto, html, texto };
}

const TTL_ENVIO_UNICO = 60 * 60 * 24 * 7;

/**
 * Envia o e-mail de espera UMA vez por autorização. Chamado pela rota de crédito
 * ao entrar em análise e na reentrada no mesmo draft — nunca pela página, que
 * pode ser recarregada à vontade.
 *
 * A trava é gravada antes do envio; se o envio falhar, é liberada, e a próxima
 * chamada tenta de novo. Devolve um texto curto para o alerta interno.
 */
export async function enviarEmailEsperaUmaVez(draft: ReservationDraft, draftId: string): Promise<string> {
  const analise = draft.analise;
  if (!analise) return "não enviado: draft sem bloco de análise";
  if (!draft.guestEmail) return "não enviado: draft sem e-mail do hóspede";

  const chave = `email:espera:${analise.paymentId}`;
  if (!(await reservarEnvioUnico(chave, TTL_ENVIO_UNICO))) return "já enviado antes";

  const { assunto, html, texto } = montarEmailEspera(draft, draftId, analise.valorAutorizado);
  return enviarComTrava(chave, draft.guestEmail, { assunto, html, texto });
}

async function enviarComTrava(
  chave: string,
  para: string,
  email: { assunto: string; html: string; texto: string },
): Promise<string> {
  const r = await enviarEmailHospede({ para, ...email });
  if (!r.enviado) {
    await liberarEnvioUnico(chave);
    return `NÃO ENVIADO (${r.motivo})`;
  }
  return "enviado";
}

// =============================================================================
// Desfecho da espera (rodada A3). Mesmas regras de linguagem.
// =============================================================================

function blocoEstadia(
  draft: Pick<ReservationDraft, "propertyName" | "checkin" | "checkout" | "guests">,
  linhaValor: string,
) {
  const texto = [
    draft.propertyName,
    `Check-in: ${formatBR(draft.checkin)} às 15h`,
    `Check-out: ${formatBR(draft.checkout)} às 11h`,
    `Hóspedes: ${draft.guests}`,
    linhaValor,
  ];
  const html = `
      <table style="font-family:Arial,sans-serif;font-size:14px;border-top:1px solid #ddd;margin:24px 0;padding-top:12px;width:100%">
        <tr><td colspan="2" style="font-family:Georgia,serif;font-size:18px;padding-bottom:8px">${escapar(draft.propertyName)}</td></tr>
        <tr><td style="color:#777">Check-in</td><td style="text-align:right">${formatBR(draft.checkin)} às 15h</td></tr>
        <tr><td style="color:#777">Check-out</td><td style="text-align:right">${formatBR(draft.checkout)} às 11h</td></tr>
        <tr><td style="color:#777">Hóspedes</td><td style="text-align:right">${draft.guests}</td></tr>
        <tr><td colspan="2" style="padding-top:8px">${escapar(linhaValor)}</td></tr>
      </table>`;
  return { texto, html };
}

function envelope(nome: string, titulo: string, paragrafos: string[], estadia: { html: string }, whatsapp: string, id: string) {
  return `
    <div style="font-family:Georgia,serif;color:#2b2b2b;max-width:560px;margin:0 auto;padding:24px">
      <p style="font-family:Arial,sans-serif;font-size:14px">${nome ? `Olá, ${escapar(nome)}.` : "Olá."}</p>
      <h1 style="font-weight:normal;font-size:26px;margin:24px 0 12px">${titulo}</h1>
      ${paragrafos.map((p) => `<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6">${p}</p>`).join("")}
      ${estadia.html}
      <p><a href="${whatsapp}" style="display:inline-block;background:#25D366;color:#fff;padding:12px 24px;text-decoration:none;font-family:Arial,sans-serif;font-size:13px;letter-spacing:1px;text-transform:uppercase">${TEXTO_ESPERA.botao}</a></p>
      <p style="font-family:Arial,sans-serif;font-size:12px;color:#999;margin-top:32px">ID da reserva: ${id} · Solarium Mantiqueira</p>
    </div>`;
}

type DraftEmail = Pick<ReservationDraft, "guestFirstName" | "propertyName" | "checkin" | "checkout" | "guests">;

/** Accept + captura + reserva criada: agora sim, confirmada. */
export function montarEmailConfirmacao(draft: DraftEmail, draftId: string, valorPago: number) {
  const nome = draft.guestFirstName.trim().split(/\s+/)[0] || "";
  const id = draftId.slice(0, 8).toUpperCase();
  const valor = valorPago.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const whatsapp = whatsappLink(mensagemWhatsappEspera(draft, draftId));
  const titulo = "Sua reserva está confirmada.";
  const paragrafos = [
    "O pagamento foi concluído e as datas são suas. Antes do check-in enviamos o guia da casa e as instruções de acesso.",
    "Nosso concierge fala com você pelo WhatsApp para preparar a estadia do seu jeito.",
  ];
  const estadia = blocoEstadia(draft, `Total pago: ${valor}`);
  return {
    assunto: `Reserva confirmada — ${draft.propertyName}`,
    texto: [nome ? `Olá, ${nome}.` : "Olá.", "", titulo, ...paragrafos, "", ...estadia.texto, "", `WhatsApp: ${SITE.whatsappDisplay} — ${whatsapp}`, "", `ID da reserva: ${id}`, "Solarium Mantiqueira"].join("\n"),
    html: envelope(nome, titulo, paragrafos, estadia, whatsapp, id),
  };
}

/**
 * Reject: não foi possível concluir. Convida a outro meio, sem dizer por quê — o
 * motivo não é do hóspede, e qualquer palavra sobre ele soa como acusação.
 */
export function montarEmailNaoConcluido(draft: DraftEmail, draftId: string) {
  const nome = draft.guestFirstName.trim().split(/\s+/)[0] || "";
  const id = draftId.slice(0, 8).toUpperCase();
  const whatsapp = whatsappLink(
    `Olá! Quero concluir minha reserva no ${draft.propertyName} de ${formatBR(draft.checkin)} a ${formatBR(draft.checkout)} por outro meio de pagamento. ID: ${id}`,
  );
  const titulo = "Não conseguimos concluir o pagamento.";
  const paragrafos = [
    "O pagamento com este cartão não pôde ser concluído, e nenhum valor foi cobrado.",
    "Se ainda quiser estas datas, é só chamar no WhatsApp: fechamos com você por Pix ou outro cartão, do jeito mais simples.",
  ];
  const estadia = blocoEstadia(draft, "Nenhum valor cobrado");
  return {
    assunto: `Sua reserva no ${draft.propertyName}`,
    texto: [nome ? `Olá, ${nome}.` : "Olá.", "", titulo, ...paragrafos, "", ...estadia.texto, "", `WhatsApp: ${SITE.whatsappDisplay} — ${whatsapp}`, "", `ID da reserva: ${id}`, "Solarium Mantiqueira"].join("\n"),
    html: envelope(nome, titulo, paragrafos, estadia, whatsapp, id),
  };
}

export async function enviarEmailDesfechoUmaVez(
  tipo: "confirmacao" | "nao-concluido",
  draft: ReservationDraft,
  draftId: string,
): Promise<string> {
  const analise = draft.analise;
  if (!analise) return "não enviado: draft sem bloco de análise";
  if (!draft.guestEmail) return "não enviado: draft sem e-mail do hóspede";
  const chave = `email:${tipo}:${analise.paymentId}`;
  if (!(await reservarEnvioUnico(chave, TTL_ENVIO_UNICO))) return "já enviado antes";
  const email =
    tipo === "confirmacao"
      ? montarEmailConfirmacao(draft, draftId, analise.valorAutorizado)
      : montarEmailNaoConcluido(draft, draftId);
  return enviarComTrava(chave, draft.guestEmail, email);
}
