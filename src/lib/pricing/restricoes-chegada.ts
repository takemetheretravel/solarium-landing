import { getCalendar } from "@/lib/hostaway";
import { listingsForProperty } from "@/config/operational-extras";
import { mensagemChegadaBloqueada } from "./mensagem-chegada";

export { mensagemChegadaBloqueada };

/**
 * Restrições de CHEGADA, lidas da Hostaway.
 *
 * O PMS marca `closedOnArrival` dia a dia no calendário. Enquanto o site não
 * lia esse campo, um pacote podia ser vendido com entrada num dia que a
 * Hostaway recusa — o hóspede escolhia, pagava, e a reserva não podia ser
 * efetivada. Falha de venda, não de exibição.
 *
 * POR QUE LER DA API, E NÃO CONFIGURAR LOCALMENTE. Medido em produção
 * (01/09–31/10/2026): o Completo bloqueia 8 de 8 domingos, o Sol 1 idem, e o
 * Sol 2 bloqueia **7 de 8** — mais alguns segundas em todos. A restrição não é
 * "domingo", é um calendário. Uma regra local de dia da semana erraria já no
 * primeiro domingo liberado do Sol 2, e desatualizaria em silêncio na primeira
 * mudança feita no PMS.
 *
 * A restrição é de CHEGADA, não de ocupação: passar por cima de um domingo no
 * meio da estadia é permitido e continua permitido.
 */

export type ResultadoChegada =
  | { permitida: true }
  /**
   * `indeterminado` distingue "a Hostaway disse não" de "não consegui
   * perguntar". Quem está prestes a cobrar trata os dois como recusa; quem só
   * exibe preço pode seguir o tratamento de indisponibilidade que já existe.
   */
  | { permitida: false; motivo: string; indeterminado: boolean };

/**
 * A casa aceita chegada nesta data?
 *
 * O Completo ocupa as duas listings: basta uma delas recusar a chegada para a
 * data estar fora — a casa inteira não pode ser entregue pela metade.
 */
export async function chegadaPermitida(
  propertySlug: string,
  checkin: string,
): Promise<ResultadoChegada> {
  const listings = listingsForProperty(propertySlug);
  if (listings.length === 0) {
    return {
      permitida: false,
      motivo: "Não foi possível confirmar esta casa. Fale com a gente pelo WhatsApp.",
      indeterminado: true,
    };
  }

  const calendarios = await Promise.all(listings.map((id) => getCalendar(id, checkin, checkin)));

  for (let i = 0; i < calendarios.length; i++) {
    const dia = calendarios[i]?.find((d) => d.date === checkin);
    if (!dia) {
      // Sem o dia no calendário não dá para afirmar nada. Não inventamos
      // permissão: quem cobra recusa, quem exibe cai no caminho de
      // indisponibilidade que já existe.
      console.error(
        `[Restricoes:chegada] calendário sem o dia ${checkin} para listing ${listings[i]} (${propertySlug})`,
      );
      return {
        permitida: false,
        motivo: "Não conseguimos confirmar esta data agora. Fale com a gente pelo WhatsApp.",
        indeterminado: true,
      };
    }
    if (dia.closedOnArrival === 1) {
      console.log(
        `[Restricoes:chegada] bloqueada ${checkin} listing=${listings[i]} property=${propertySlug}`,
      );
      return { permitida: false, motivo: mensagemChegadaBloqueada(checkin), indeterminado: false };
    }
  }

  return { permitida: true };
}

/**
 * Dias de chegada bloqueados num intervalo, para o front marcar no seletor.
 *
 * Conveniência de interface: o servidor continua sendo quem decide. Falha aqui
 * devolve lista vazia — o seletor deixa de pintar os dias, e a recusa acontece
 * na validação, que nunca é pulada.
 */
export async function diasSemChegada(
  propertySlug: string,
  inicio: string,
  fim: string,
): Promise<string[]> {
  const listings = listingsForProperty(propertySlug);
  if (listings.length === 0) return [];

  try {
    const calendarios = await Promise.all(listings.map((id) => getCalendar(id, inicio, fim)));
    const bloqueados = new Set<string>();
    for (const dias of calendarios) {
      for (const d of dias) {
        if (d.closedOnArrival === 1) bloqueados.add(d.date);
      }
    }
    return Array.from(bloqueados).sort();
  } catch (err) {
    console.error("[Restricoes:diasSemChegada] falhou:", (err as Error)?.message);
    return [];
  }
}
