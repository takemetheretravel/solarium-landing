#!/usr/bin/env node
/**
 * Pergunta à API da Hostaway o que a documentação não responde por escrito.
 *
 * O suporte respondeu por bot que "o schema não é documentado". O changelog da
 * referência lista os recursos, mas a página não abre os campos — e tentativa e
 * erro contra a conta de produção é caro. Este script pergunta direto à API, só
 * com chamadas de LEITURA.
 *
 * NÃO cria, não altera e não cancela nada.
 *
 * Uso:
 *   HOSTAWAY_ACCOUNT_ID=... HOSTAWAY_API_KEY=... node scripts/hostaway-contrato.mjs
 *   node scripts/hostaway-contrato.mjs --reserva 65375857   (abre uma reserva real)
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

(() => {
  const caminho = join(process.cwd(), ".env.local");
  if (!existsSync(caminho)) return;
  for (const linha of readFileSync(caminho, "utf8").split(/\r?\n/)) {
    const t = linha.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
})();

const BASE = process.env.HOSTAWAY_API_BASE_URL || "https://api.hostaway.com/v1";
const ID = (process.env.HOSTAWAY_ACCOUNT_ID || "").trim();
const KEY = (process.env.HOSTAWAY_API_KEY || "").trim();

function arg(nome) {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function titulo(t) {
  console.log("\n" + "=".repeat(72));
  console.log(t);
  console.log("=".repeat(72));
}

async function token() {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: ID,
    client_secret: KEY,
    scope: "general",
  });
  const r = await fetch(`${BASE}/accessTokens`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-control": "no-cache" },
    body,
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) {
    console.error(`\nFALHA  token http=${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
    console.error(
      "       Credenciais invalidas ou nao carregadas. Variavel Sensitive na Vercel\n" +
        "       nao volta por 'vercel env pull' — leia no painel e exporte.",
    );
    process.exit(1);
  }
  return j.access_token;
}

async function ler(t, caminho) {
  const r = await fetch(`${BASE}${caminho}`, {
    headers: { Authorization: `Bearer ${t}`, "Cache-control": "no-cache" },
  });
  const corpo = await r.json().catch(() => null);
  return { http: r.status, corpo };
}

async function main() {
  if (!ID || !KEY) {
    console.error("FALHA  HOSTAWAY_ACCOUNT_ID / HOSTAWAY_API_KEY ausentes.");
    process.exit(1);
  }
  const t = await token();
  console.log("token: ok");

  // --- 1) Metodos de pagamento validos para reserva ------------------------
  // Responde direto "qual valor usar em cartao e em Pix" na fila de finalizacao.
  titulo("[1] GET /reservations/paymentMethods");
  const pm = await ler(t, "/reservations/paymentMethods");
  console.log(`http=${pm.http}`);
  console.log(JSON.stringify(pm.corpo, null, 2).slice(0, 2500));

  // --- 2) Uma reserva COM includeResources ---------------------------------
  // Sem includeResources=1, `reservationFees` volta array vazio — daria para
  // concluir "nao ha decomposicao" quando na verdade ela nao foi pedida.
  const reserva = arg("reserva");
  if (reserva) {
    titulo(`[2] GET /reservations/${reserva}?includeResources=1`);
    const comRec = await ler(t, `/reservations/${reserva}?includeResources=1`);
    console.log(`http=${comRec.http}`);
    const r = comRec.corpo?.result ?? {};
    console.log("status:          ", r.status);
    console.log("isPaid:          ", r.isPaid, " paymentStatus:", r.paymentStatus);
    console.log("reservationFees: ", JSON.stringify(r.reservationFees ?? null, null, 2).slice(0, 2000));

    titulo(`[2b] A MESMA reserva SEM includeResources — comparacao`);
    const sem = await ler(t, `/reservations/${reserva}`);
    const r2 = sem.corpo?.result ?? {};
    console.log(
      `com includeResources: ${(r.reservationFees ?? []).length} taxas | ` +
        `sem: ${(r2.reservationFees ?? []).length} taxas`,
    );
    console.log(
      (r.reservationFees ?? []).length > 0 && (r2.reservationFees ?? []).length === 0
        ? "CONFIRMADO: sem o parametro, as taxas somem da resposta."
        : "Nao confirmou a diferenca nesta reserva.",
    );
  } else {
    titulo("[2] pulado — passe --reserva <id> para abrir uma reserva real");
  }

  // --- 3) Amostra de reservas: quais status a conta realmente tem ----------
  // A doc nao enumera os status; a conta enumera.
  titulo("[3] Status realmente presentes na conta (amostra de 100)");
  const lista = await ler(t, "/reservations?limit=100&includeResources=1");
  const linhas = lista.corpo?.result ?? [];
  const porStatus = {};
  for (const x of linhas) porStatus[x.status] = (porStatus[x.status] ?? 0) + 1;
  console.log(`http=${lista.http}  reservas lidas=${linhas.length}`);
  console.log(JSON.stringify(porStatus, null, 2));

  const comTaxas = linhas.filter((x) => (x.reservationFees ?? []).length > 0);
  console.log(`\nreservas com reservationFees preenchido: ${comTaxas.length}`);
  if (comTaxas[0]) {
    console.log("exemplo de decomposicao real (tipos e nomes):");
    console.log(JSON.stringify(comTaxas[0].reservationFees, null, 2).slice(0, 2500));
  }
}

main().catch((e) => {
  console.error("Erro:", e?.message || e);
  process.exit(1);
});
