/**
 * Mensagem de chegada bloqueada. Módulo PURO, sem imports.
 *
 * Vive separado porque `hostaway.ts` e `restricoes-chegada.ts` precisam dela e
 * um importa o outro — juntá-la a qualquer um dos dois fecharia um ciclo.
 */

/**
 * "domingo" → "aos domingos"; "segunda-feira" → "às segundas".
 *
 * O plural de "segunda-feira" é "segundas-feiras", que soa burocrático numa
 * mensagem ao hóspede — a forma curta é a que se fala.
 */
const DIA_POR_EXTENSO = [
  "aos domingos",
  "às segundas",
  "às terças",
  "às quartas",
  "às quintas",
  "às sextas",
  "aos sábados",
];

/**
 * Voz da marca: diz o que fazer, não o que falhou. Sem "erro", sem
 * "indisponível" seco, sem jargão de PMS.
 */
export function mensagemChegadaBloqueada(iso: string): string {
  const dia = DIA_POR_EXTENSO[new Date(iso + "T12:00:00").getDay()] ?? "neste dia";
  return `Esta casa não recebe chegadas ${dia}. Escolha outra data de entrada ou fale com a gente pelo WhatsApp.`;
}
