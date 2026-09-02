import { describe, it, expect } from "vitest";
import { PACOTES_V2 } from "@/config/precos-e-extras";
import { checkoutSugerido, datasElegiveis, proximaDataElegivel } from "./elegibilidade";

/**
 * As datas que o site SUGERE têm que passar na validação do próprio pacote.
 *
 * O Final de Ano abria em 29/12 → 01/01: terça a sexta, enquanto a mesma tela
 * avisava que a saída precisa ser sábado, domingo ou segunda. O cliente chegava
 * num estado que o site recusava, e a primeira coisa que ele via era um erro.
 *
 * Sugestão inválida é pior que sugestão ausente: ela ensina a data errada.
 */

/** Todo dia de um intervalo, em ISO. */
function dias(de: string, ate: string): string[] {
  const saida: string[] = [];
  const fim = new Date(ate + "T12:00:00").getTime();
  for (let d = new Date(de + "T12:00:00"); d.getTime() <= fim; d.setDate(d.getDate() + 1)) {
    saida.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
  }
  return saida;
}

// Janela larga o bastante para cobrir a virada do ano (Final de Ano) e um ciclo
// completo de dias da semana em todos os outros pacotes.
const JANELA = dias("2026-09-01", "2027-02-28");

describe("checkoutSugerido respeita as regras do próprio pacote", () => {
  for (const pacote of PACOTES_V2) {
    for (const casa of pacote.properties) {
      it(`${pacote.slug} @ ${casa}: toda saída sugerida é aceita pelo pacote`, () => {
        const invalidas: string[] = [];

        for (const checkin of JANELA) {
          // Só interessa a chegada que o pacote aceita: a sugestão de saída para
          // uma chegada inválida nunca chega à tela.
          const dow = new Date(checkin + "T12:00:00").getDay();
          if (pacote.checkinDows && !pacote.checkinDows.includes(dow)) continue;

          const checkout = checkoutSugerido(pacote.slug, checkin);
          if (!checkout) continue;

          // Uma chegada pode ser inválida por outro motivo (fora da janela do
          // pacote, feriado ausente). O que este teste cobra é a coerência da
          // SAÍDA: se o pacote fixa dias de check-out, o sugerido tem que ser um
          // deles. Assim uma janela sazonal não mascara o defeito.
          if (pacote.checkoutDows) {
            const dowSaida = new Date(checkout + "T12:00:00").getDay();
            if (!pacote.checkoutDows.includes(dowSaida)) {
              invalidas.push(`chegada ${checkin} → saída ${checkout} (dow ${dowSaida})`);
            }
          }

          // Duração: nunca abaixo do mínimo nem acima do máximo.
          const noites = Math.round(
            (new Date(checkout + "T12:00:00").getTime() -
              new Date(checkin + "T12:00:00").getTime()) /
              86400000,
          );
          if (noites < pacote.noitesMin) {
            invalidas.push(`chegada ${checkin} → saída ${checkout}: ${noites} noites, mínimo ${pacote.noitesMin}`);
          }
          if (pacote.noitesMax !== null && noites > pacote.noitesMax) {
            invalidas.push(`chegada ${checkin} → saída ${checkout}: ${noites} noites, máximo ${pacote.noitesMax}`);
          }
        }

        expect(invalidas, `sugestões que o próprio pacote recusa:\n  ${invalidas.join("\n  ")}`).toEqual([]);
      });
    }
  }
});

describe("proximaDataElegivel devolve par que o pacote aceita", () => {
  for (const pacote of PACOTES_V2) {
    it(`${pacote.slug}: o par sugerido passa em datasElegiveis`, () => {
      const casa = pacote.properties[0];
      // Vários pontos de partida: o primeiro par elegível não pode depender de
      // onde a busca começou.
      for (const partida of ["2026-09-01", "2026-11-15", "2026-12-20", "2027-01-10"]) {
        const par = proximaDataElegivel(pacote.slug, partida);
        if (!par) continue;
        const eleg = datasElegiveis(pacote.slug, casa, par.checkin, par.checkout);
        expect(
          eleg.elegivel,
          `${pacote.slug} a partir de ${partida}: ${par.checkin} → ${par.checkout} — ${
            eleg.elegivel ? "" : eleg.motivo
          }`,
        ).toBe(true);
      }
    });
  }
});
