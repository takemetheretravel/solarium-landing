#!/usr/bin/env node
/**
 * Ensaio ponta a ponta do pós-pagamento, sem cobrar cartão nenhum.
 *
 * Cria um draft com datas seguras, chama `/api/admin/simular-pos-pagamento` e
 * imprime o que cada etapa respondeu. Ao final, cancela a reserva de ensaio —
 * a não ser que você passe `--manter`.
 *
 * O que ele NÃO testa: o 3DS. O 3DS acontece antes da autorização, no navegador,
 * e continua sem ter como ser exercitado fora de produção.
 *
 * Uso:
 *   node scripts/simular-reserva.mjs
 *   node scripts/simular-reserva.mjs --provider cielo --metodo pix
 *   node scripts/simular-reserva.mjs --manter          (não cancela no fim)
 *   BASE_URL=https://preview.vercel.app node scripts/simular-reserva.mjs
 *
 * Exige no ambiente: ADMIN_API_TOKEN e META_TEST_EVENT_CODE.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// --- .env.local, se existir -------------------------------------------------
(() => {
  const caminho = join(process.cwd(), ".env.local");
  if (!existsSync(caminho)) return;
  for (const linha of readFileSync(caminho, "utf8").split("\n")) {
    const t = linha.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const chave = t.slice(0, i).trim();
    let valor = t.slice(i + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    if (!(chave in process.env)) process.env[chave] = valor;
  }
})();

function arg(nome, padrao) {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : padrao;
}
const MANTER = process.argv.includes("--manter");
const PROVIDER = arg("provider", "braspag");
const METODO = arg("metodo", "credito");
const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const TOKEN = (process.env.ADMIN_API_TOKEN || "").trim();

/** Mesma detecção de placeholder do checar-ambiente: `[SENSITIVE]` não é token. */
function ehPlaceholder(v) {
  return [/^\[.*\]$/, /^<.*>$/, /^(undefined|null|changeme|placeholder)$/i].some((re) => re.test(v));
}

function titulo(t) {
  console.log("\n" + "=".repeat(72));
  console.log(t);
  console.log("=".repeat(72));
}

/** Data ISO daqui a N dias. A rota exige 90+; usamos folga. */
function daquiA(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

async function main() {
  titulo("SIMULACAO DE POS-PAGAMENTO" + (MANTER ? "  [--manter]" : ""));
  console.log(`base:     ${BASE_URL}`);
  console.log(`provider: ${PROVIDER}   metodo: ${METODO}`);

  if (!TOKEN || ehPlaceholder(TOKEN)) {
    console.error(
      "\nFALHA  ADMIN_API_TOKEN ausente ou placeholder.\n" +
        "       Variavel Sensitive na Vercel nao volta por 'vercel env pull' —\n" +
        "       leia o valor no painel e exporte antes de rodar.",
    );
    process.exit(1);
  }
  if (!(process.env.META_TEST_EVENT_CODE || "").trim()) {
    console.error(
      "\nFALHA  META_TEST_EVENT_CODE ausente.\n" +
        "       Sem ele a rota RECUSA a simulacao — e recusa de proposito: o Purchase\n" +
        "       iria ao Meta como venda real e entraria na otimizacao de campanha.",
    );
    process.exit(1);
  }

  // --- 1) Draft com datas seguras e valor baixo ----------------------------
  // 120 dias adiante: bem acima do minimo de 90 exigido pela rota.
  const checkin = daquiA(120);
  const checkout = daquiA(122);

  titulo("[1] Criando draft");
  console.log(`datas: ${checkin} -> ${checkout}  (2 noites, 120 dias adiante)`);

  const draftRes = await fetch(`${BASE_URL}/api/reservations/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      propertySlug: "solarium-1",
      checkin,
      checkout,
      guests: 2,
      paymentMethod: METODO === "pix" ? "pix" : "card",
      guest: {
        name: "Simulacao Automatizada",
        email: "simulacao@solariummantiqueira.com.br",
        // CPF valido apenas em digito verificador — nao pertence a ninguem.
        cpf: "12345678909",
        phone: "+5535984075652",
        notes: "RESERVA DE ENSAIO — gerada por scripts/simular-reserva.mjs",
      },
    }),
  });
  const draftBody = await draftRes.json().catch(() => ({}));
  if (!draftRes.ok || !draftBody.draftId) {
    console.error(`FALHA  http=${draftRes.status}`, JSON.stringify(draftBody, null, 2));
    process.exit(1);
  }
  console.log(`ok     draftId=${draftBody.draftId}  finalTotal=R$ ${draftBody.finalTotal}`);

  // --- 2) Simulacao ---------------------------------------------------------
  titulo("[2] Simulando pos-pagamento");
  const simRes = await fetch(`${BASE_URL}/api/admin/simular-pos-pagamento`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-token": TOKEN },
    body: JSON.stringify({ draftId: draftBody.draftId, provider: PROVIDER, metodo: METODO }),
  });
  const sim = await simRes.json().catch(() => ({}));

  // --- 3) Relatorio etapa por etapa ----------------------------------------
  titulo("[3] Relatorio");
  for (const e of sim.etapas ?? []) {
    console.log(`\n${e.ok ? "  ok   " : "  FALHA"}  ${e.etapa}`);
    console.log(
      "         " + JSON.stringify(e.detalhe, null, 2).split("\n").join("\n         ").slice(0, 2000),
    );
  }

  if (!simRes.ok) {
    console.error(`\nSimulacao interrompida — http=${simRes.status}`);
    console.error(JSON.stringify(sim, null, 2).slice(0, 3000));
    process.exit(1);
  }

  console.log("\n--- resumo ---");
  console.log(`reserva Hostaway: ${sim.reservationId}`);
  console.log(`paymentId:        ${sim.paymentIdSintetico}  (sintetico — nenhum gateway chamado)`);
  console.log(`gateway chamado:  ${sim.gatewayChamado}`);
  console.log(`valida 3DS:       ${sim.validou3ds}  (o 3DS so existe em producao)`);

  console.log("\n--- resposta CRUA da Hostaway (contrato da decomposicao) ---");
  console.log(JSON.stringify(sim.respostaCruaHostaway, null, 2).slice(0, 4000));

  // --- 4) Limpeza -----------------------------------------------------------
  titulo("[4] Limpeza");
  const cmd =
    `curl -X DELETE -H "x-admin-token: $ADMIN_API_TOKEN" ` +
    `"${BASE_URL}/api/admin/simular-pos-pagamento/${sim.reservationId}"`;

  if (MANTER) {
    console.log("--manter: a reserva de ensaio FICA. Cancele quando terminar:\n");
    console.log(`  ${cmd}\n`);
    return;
  }

  const delRes = await fetch(
    `${BASE_URL}/api/admin/simular-pos-pagamento/${sim.reservationId}`,
    { method: "DELETE", headers: { "x-admin-token": TOKEN } },
  );
  const del = await delRes.json().catch(() => ({}));
  console.log(
    del.ok
      ? `ok     reserva ${sim.reservationId} cancelada e removida da fila`
      : `FALHA  nao cancelou (http=${delRes.status}). Rode a mao:\n\n  ${cmd}\n`,
  );
  if (!del.ok) console.log(JSON.stringify(del, null, 2).slice(0, 1500));
}

main().catch((err) => {
  console.error("\nErro inesperado:", err?.message || err);
  process.exit(1);
});
