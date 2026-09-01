import { calculatePriceDetailed, getCalendar } from "@/lib/hostaway";
import { getPropertyBySlug } from "@/config/properties";
import { getPacoteV2 } from "@/config/precos-e-extras";
import { listingsForProperty } from "@/config/operational-extras";
import { SITE } from "@/config/site";
import type { ReservationDraft } from "@/lib/kv-store";

/**
 * Reconferência do draft contra a Hostaway, IMEDIATAMENTE ANTES DE COBRAR.
 *
 * POR QUE ISSO EXISTE. O TTL do draft passou de 2h para 24h para não perder a
 * atribuição de campanha de um checkout com retentativas (medido: 44 minutos
 * entre a primeira tentativa e o pagamento concluído). Um draft que vive 24h,
 * porém, carrega um preço e uma disponibilidade que podem ter envelhecido: a
 * diária muda no PMS, a data é vendida por outro canal, o dia de chegada é
 * fechado. Estender o TTL sem reconferir troca um problema de atribuição por um
 * problema de cobrança errada — que é muito pior.
 *
 * O QUE É RECONFERIDO. Só o que vem da Hostaway e muda sozinho:
 *   1. disponibilidade das noites da estadia;
 *   2. total da Hostaway (diárias + limpeza + hóspede extra);
 *   3. restrição de chegada (`closedOnArrival`) do dia de check-in.
 *
 * O que vem do config local (cupom, preço de extra, regra de pacote) não muda
 * entre a criação do draft e o pagamento dentro de um mesmo deploy, e por isso
 * não é reconferido aqui.
 *
 * DIVERGÊNCIA NUNCA VIRA COBRANÇA. Nem o valor antigo nem o novo são cobrados
 * em silêncio: a rota devolve a mensagem ao hóspede e a tentativa para. Refazer
 * a reserva recalcula tudo do zero, pelo mesmo motor de sempre — é essa a forma
 * honesta de "pedir confirmação" do novo valor.
 */

export type MotivoRecusa =
  | "indisponivel"
  | "preco-mudou"
  | "chegada-bloqueada"
  | "indeterminado";

export type Revalidacao =
  | { ok: true }
  | {
      ok: false;
      motivo: MotivoRecusa;
      /** Texto exibido ao hóspede. As rotas devolvem em `returnMessage`/`error`. */
      mensagem: string;
      status: number;
    };

const LINK_WHATSAPP = `https://wa.me/${SITE.whatsappNumber}`;

/** Tolerância de comparação. Centavos de arredondamento não são divergência. */
const TOLERANCIA_REAIS = 0.5;

export async function revalidarDraftAntesDeCobrar(
  draft: ReservationDraft,
): Promise<Revalidacao> {
  const property = getPropertyBySlug(draft.propertyId);
  if (!property) {
    console.error(
      "[Revalidacao] propriedade não resolvida " +
        JSON.stringify({ draftId: draft.id, propertyId: draft.propertyId }),
    );
    return {
      ok: false,
      motivo: "indeterminado",
      status: 409,
      mensagem:
        `Não conseguimos confirmar esta reserva agora. Fale com a gente pelo WhatsApp: ${LINK_WHATSAPP}`,
    };
  }

  // 1) Chegada. Checada primeiro: se o PMS fechou o dia de entrada, nem preço
  //    nem disponibilidade importam — a reserva não pode ser criada.
  //
  //    NOTA DE MANUTENÇÃO: quando `fix/restricoes-chegada-hostaway` entrar,
  //    trocar este bloco por `chegadaPermitida(property.slug, draft.checkin)`
  //    de `@/lib/pricing/restricoes-chegada`, que é a mesma leitura.
  const chegada = await chegadaAindaPermitida(property.slug, draft.checkin);
  if (!chegada.ok) {
    console.error(
      "[Revalidacao] chegada bloqueada " +
        JSON.stringify({
          draftId: draft.id,
          property: draft.propertyId,
          checkin: draft.checkin,
          indeterminado: chegada.indeterminado,
        }),
    );
    return {
      ok: false,
      motivo: chegada.indeterminado ? "indeterminado" : "chegada-bloqueada",
      status: 409,
      mensagem: chegada.indeterminado
        ? `Não conseguimos confirmar esta data agora. Fale com a gente pelo WhatsApp: ${LINK_WHATSAPP}`
        : `A casa deixou de aceitar entrada em ${formatarData(draft.checkin)} desde que você começou esta reserva. ` +
          `Escolha outra data de chegada ou fale com a gente pelo WhatsApp: ${LINK_WHATSAPP}`,
    };
  }

  // 2) Disponibilidade + preço, na mesma chamada — é a mesma que criou o draft.
  //    O bypass de mínimo de noites do pacote precisa ser repetido aqui, senão
  //    um draft legítimo seria recusado pela regra que ele tem permissão de
  //    ignorar.
  const pacote = draft.pacoteId ? getPacoteV2(draft.pacoteId) : undefined;
  const opcoes = { ignorarMinimoDeNoites: pacote?.ignorarMinimoPMS === true };

  const r = await calculatePriceDetailed(
    property.id,
    draft.checkin,
    draft.checkout,
    draft.guests,
    opcoes,
  );

  if ("failure" in r) {
    const { reason, message } = r.failure;
    console.error(
      "[Revalidacao] cotação recusada " +
        JSON.stringify({
          draftId: draft.id,
          property: draft.propertyId,
          checkin: draft.checkin,
          checkout: draft.checkout,
          reason,
          message,
        }),
    );
    // `api-error` é "não consegui perguntar", não "a Hostaway disse não". Quem
    // está prestes a cobrar trata os dois como recusa — cobrar sem confirmar é
    // o único desfecho inaceitável.
    if (reason === "unavailable-day" || reason === "min-stay-not-met") {
      return {
        ok: false,
        motivo: "indisponivel",
        status: 409,
        mensagem:
          `Estas datas não estão mais disponíveis: ${message} ` +
          `Fale com a gente pelo WhatsApp e a gente encontra uma alternativa: ${LINK_WHATSAPP}`,
      };
    }
    return {
      ok: false,
      motivo: "indeterminado",
      status: 409,
      mensagem:
        `Não conseguimos confirmar estas datas agora. Fale com a gente pelo WhatsApp: ${LINK_WHATSAPP}`,
    };
  }

  // 3) Preço. `draft.totalPrice` é exatamente o total da Hostaway gravado na
  //    criação do draft (nos dois caminhos: avulso e pacote V2). Comparar as
  //    duas pontas da MESMA grandeza é o que torna esta checagem confiável —
  //    comparar contra `finalTotal` misturaria desconto, extras e Pix.
  const totalAntigo = Number(draft.totalPrice);
  const totalNovo = r.quote.totalPrice;
  const diferenca = totalNovo - totalAntigo;

  if (Number.isFinite(totalAntigo) && Math.abs(diferenca) > TOLERANCIA_REAIS) {
    console.error(
      "[Revalidacao] PREÇO DIVERGENTE — cobrança interrompida " +
        JSON.stringify({
          draftId: draft.id,
          property: draft.propertyId,
          checkin: draft.checkin,
          checkout: draft.checkout,
          guests: draft.guests,
          pacoteId: draft.pacoteId ?? null,
          hostawayAntigo: totalAntigo,
          hostawayNovo: totalNovo,
          diferenca: Number(diferenca.toFixed(2)),
          finalTotalDoDraft: draft.finalTotal,
          criadoEm: draft.createdAt,
        }),
    );
    // Sem valor novo na mensagem de propósito: o total final do pacote não é o
    // total da Hostaway (desconto progressivo, bônus e extras entram depois), e
    // anunciar aqui um número que não é o que seria cobrado seria pior do que
    // não anunciar nenhum. Refazer a reserva mostra o preço certo.
    return {
      ok: false,
      motivo: "preco-mudou",
      status: 409,
      mensagem:
        "Os valores destas datas mudaram desde que você começou esta reserva, então não concluímos a cobrança. " +
        "Refaça a busca para ver o preço atualizado e confirmar, ou fale com a gente pelo WhatsApp: " +
        LINK_WHATSAPP,
    };
  }

  return { ok: true };
}

/**
 * O dia de chegada segue aceito? O Completo ocupa as duas listings: basta uma
 * recusar para a data estar fora.
 *
 * `indeterminado` separa "a Hostaway disse não" de "não consegui perguntar".
 * Antes de cobrar, os dois param a tentativa — mas a mensagem ao hóspede muda.
 */
async function chegadaAindaPermitida(
  propertySlug: string,
  checkin: string,
): Promise<{ ok: true } | { ok: false; indeterminado: boolean }> {
  const listings = listingsForProperty(propertySlug);
  if (listings.length === 0) return { ok: false, indeterminado: true };

  let calendarios: Awaited<ReturnType<typeof getCalendar>>[];
  try {
    calendarios = await Promise.all(listings.map((id) => getCalendar(id, checkin, checkin)));
  } catch (err) {
    console.error("[Revalidacao:chegada] falha ao ler calendário:", (err as Error)?.message);
    return { ok: false, indeterminado: true };
  }

  for (const dias of calendarios) {
    const dia = dias.find((d) => d.date === checkin);
    // Sem o dia no calendário não dá para afirmar nada — e não inventamos
    // permissão em cima de uma cobrança.
    if (!dia) return { ok: false, indeterminado: true };
    if (dia.closedOnArrival === 1) return { ok: false, indeterminado: false };
  }

  return { ok: true };
}

/** `2026-09-14` → `14/09/2026`. Sem Date: a string já é a data local do PMS. */
function formatarData(iso: string): string {
  const [ano, mes, dia] = (iso || "").split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : iso;
}
