#!/usr/bin/env node
/**
 * Reenvio RETROATIVO de uma conversão que nunca foi disparada.
 *
 * Existe por causa da reserva 65375857: ela entrou pela rota Cielo, que não
 * tinha a instrumentação de conversão, e por isso não gerou nem GA4 nem Meta.
 *
 * PRAZOS DE RETROAÇÃO — são a razão da pressa:
 *   - GA4 Measurement Protocol: 72 horas. Passou disso, o evento é aceito com
 *     204 e descartado em silêncio.
 *   - Meta CAPI: 7 dias.
 *
 * Idempotente: consulta e grava em `conversions_sent` (o mesmo registro que as
 * rotas usam), então rodar duas vezes não conta a reserva duas vezes.
 *
 * Uso:
 *   node scripts/recuperar-conversao.mjs --draft <uuid> --reserva <id> \
 *        --valor 5700 --quando 2026-08-28T02:04:17Z [--dry-run]
 *
 * Sem `--dry-run` ele ENVIA. Com, só mostra o que faria.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Argumentos

function lerArgs(argv) {
  const args = { dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--draft") args.draft = argv[++i];
    else if (a === "--reserva") args.reserva = argv[++i];
    else if (a === "--valor") args.valor = Number(argv[++i]);
    else if (a === "--quando") args.quando = argv[++i];
    else if (a === "--moeda") args.moeda = argv[++i];
  }
  return args;
}

const args = lerArgs(process.argv);
if (!args.reserva) {
  console.error("Falta --reserva <id>. Veja o cabeçalho do arquivo para o uso completo.");
  process.exit(1);
}
const MOEDA = args.moeda || "BRL";
const QUANDO = args.quando ? new Date(args.quando) : new Date();
if (Number.isNaN(QUANDO.getTime())) {
  console.error(`--quando inválido: ${args.quando}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Env: lê .env.local sem dependência externa.

function carregarEnv() {
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
}
carregarEnv();

const GA4_ID = (process.env.GA4_MEASUREMENT_ID || "").trim();
const GA4_SECRET = (process.env.GA4_API_SECRET || "").trim();
const META_PIXEL = (process.env.META_PIXEL_ID || "").trim();
const META_TOKEN = (process.env.META_CAPI_ACCESS_TOKEN || "").trim();
const REDIS_URL = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").trim();
const REDIS_TOKEN = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();

// ---------------------------------------------------------------------------
// Redis via REST (mesmas chaves que a aplicação usa).

async function redis(comando) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  try {
    const res = await fetch(REDIS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(comando),
    });
    const json = await res.json().catch(() => ({}));
    return json?.result ?? null;
  } catch (err) {
    console.error("  [redis] falhou:", err.message);
    return null;
  }
}

async function lerDraft(id) {
  const bruto = await redis(["GET", `draft:${id}`]);
  if (!bruto) return null;
  try {
    return typeof bruto === "string" ? JSON.parse(bruto) : bruto;
  } catch {
    return null;
  }
}

async function jaEnviado(transactionId, destino) {
  const r = await redis(["GET", `conversions_sent:${destino}:${transactionId}`]);
  return Boolean(r);
}

async function marcarEnviado(transactionId, destino, httpStatus) {
  const registro = JSON.stringify({
    transaction_id: transactionId,
    destino,
    sent_at: new Date().toISOString(),
    http_status: httpStatus,
  });
  // 24 meses, igual ao TTL da aplicação.
  await redis(["SET", `conversions_sent:${destino}:${transactionId}`, registro, "EX", String(60 * 60 * 24 * 730)]);
}

const sha256 = (v) => createHash("sha256").update(String(v).trim().toLowerCase()).digest("hex");

// ---------------------------------------------------------------------------

function horasDesde(data) {
  return (Date.now() - data.getTime()) / 36e5;
}

async function main() {
  const transactionId = String(args.reserva);
  console.log("=".repeat(72));
  console.log(`RECUPERACAO DE CONVERSAO — reserva ${transactionId}${args.dryRun ? "  [DRY-RUN]" : ""}`);
  console.log("=".repeat(72));

  // --- PASSO 1: identificadores de atribuição do draft --------------------
  console.log("\n[1] Identificadores de atribuicao");
  let draft = null;
  if (!REDIS_URL || !REDIS_TOKEN) {
    // Sem isto, "draft nao encontrado" seria uma conclusao falsa: o script nem
    // chegou a perguntar ao Redis.
    console.log("  Redis NAO CONFIGURADO neste ambiente (KV_REST_API_URL/TOKEN).");
    console.log("  Impossivel dizer se o draft existe. Rode com as credenciais de producao.");
  } else if (args.draft) {
    draft = await lerDraft(args.draft);
    if (!draft) {
      console.log(`  draft ${args.draft}: NAO ENCONTRADO no Redis (consulta feita).`);
      console.log("  O TTL do draft e de 2 horas — passado esse prazo ele expira e os");
      console.log("  identificadores de atribuicao se perdem em definitivo.");
      console.log("  A conversao ainda pode ser enviada, mas SEM atribuicao de origem.");
    } else {
      console.log(`  draft ${args.draft}: encontrado.`);
    }
  } else {
    console.log("  --draft nao informado; seguindo sem identificadores.");
  }

  const campos = {
    gaClientId: draft?.gaClientId ?? null,
    gaSessionId: draft?.gaSessionId ?? null,
    fbp: draft?.fbp ?? null,
    fbc: draft?.fbc ?? null,
    gclid: draft?.atribuicao?.gclid ?? null,
    utm_source: draft?.atribuicao?.utm_source ?? null,
    utm_medium: draft?.atribuicao?.utm_medium ?? null,
    utm_campaign: draft?.atribuicao?.utm_campaign ?? null,
    utm_term: draft?.atribuicao?.utm_term ?? null,
    utm_content: draft?.atribuicao?.utm_content ?? null,
  };
  for (const [k, v] of Object.entries(campos)) {
    console.log(`  ${k.padEnd(14)} ${v === null ? "AUSENTE (null)" : v}`);
  }

  const valor = args.valor ?? draft?.finalTotal ?? null;
  if (valor === null) {
    console.error("\n  Sem --valor e sem draft para inferir. Abortando.");
    process.exit(1);
  }
  const itemId = draft?.pacoteId || draft?.packageSlug || draft?.propertyId || "estadia";
  const itemName = draft?.pacoteNome || draft?.packageName || draft?.propertyName || "Estadia";

  console.log(`\n  valor=${valor} ${MOEDA}  item=${itemId} (${itemName})`);
  console.log(`  horario original=${QUANDO.toISOString()}`);

  // --- PASSO 2: prazos ----------------------------------------------------
  const horas = horasDesde(QUANDO);
  const ga4NoPrazo = horas <= 72;
  const metaNoPrazo = horas <= 24 * 7;
  console.log("\n[2] Prazos de retroacao");
  console.log(`  decorrido: ${horas.toFixed(1)}h`);
  console.log(`  GA4  (limite 72h):  ${ga4NoPrazo ? "DENTRO" : "VENCIDO — evento sera descartado"}`);
  console.log(`  Meta (limite 7d):   ${metaNoPrazo ? "DENTRO" : "VENCIDO"}`);
  if (ga4NoPrazo) {
    const restam = 72 - horas;
    console.log(`  >>> restam ${restam.toFixed(1)}h para o GA4 (vence ${new Date(QUANDO.getTime() + 72 * 36e5).toISOString()})`);
  }

  // --- PASSO 3: envio -----------------------------------------------------
  console.log("\n[3] Envio");

  // GA4
  if (!GA4_ID || !GA4_SECRET) {
    console.log("  GA4:  PULADO — GA4_MEASUREMENT_ID/GA4_API_SECRET ausentes no ambiente.");
  } else if (await jaEnviado(transactionId, "ga4")) {
    console.log("  GA4:  PULADO — ja registrado em conversions_sent (idempotencia).");
  } else if (!ga4NoPrazo) {
    console.log("  GA4:  PULADO — fora da janela de 72h; o envio seria aceito e descartado.");
  } else {
    const corpo = {
      client_id: campos.gaClientId || `server.${sha256(transactionId).slice(0, 16)}`,
      non_personalized_ads: false,
      timestamp_micros: QUANDO.getTime() * 1000,
      events: [
        {
          name: "purchase",
          params: {
            transaction_id: transactionId,
            value: valor,
            currency: MOEDA,
            ...(campos.gaSessionId ? { session_id: campos.gaSessionId } : {}),
            items: [{ item_id: itemId, item_name: itemName, price: valor, quantity: 1 }],
          },
        },
      ],
    };
    if (args.dryRun) {
      console.log("  GA4:  [dry-run] enviaria:", JSON.stringify(corpo));
      // Mesmo em dry-run, valida: o endpoint de debug nao contabiliza nada.
      const v = await fetch(
        `https://www.google-analytics.com/debug/mp/collect?measurement_id=${encodeURIComponent(GA4_ID)}&api_secret=${encodeURIComponent(GA4_SECRET)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) },
      ).then((r) => r.json()).catch(() => null);
      const msgs = v?.validationMessages ?? [];
      console.log(`  GA4:  [dry-run] validacao: ${msgs.length === 0 ? "OK" : JSON.stringify(msgs)}`);
    } else {
      const r = await fetch(
        `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(GA4_ID)}&api_secret=${encodeURIComponent(GA4_SECRET)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) },
      );
      console.log(`  GA4:  enviado http=${r.status} (204 e o normal — nao prova aceitacao)`);
      const v = await fetch(
        `https://www.google-analytics.com/debug/mp/collect?measurement_id=${encodeURIComponent(GA4_ID)}&api_secret=${encodeURIComponent(GA4_SECRET)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) },
      ).then((x) => x.json()).catch(() => null);
      const msgs = v?.validationMessages ?? [];
      console.log(`  GA4:  validacao: ${msgs.length === 0 ? "OK" : JSON.stringify(msgs)}`);
      await marcarEnviado(transactionId, "ga4", r.status);
    }
  }

  // Meta
  if (!META_PIXEL || !META_TOKEN) {
    console.log("  Meta: PULADO — META_PIXEL_ID/META_CAPI_ACCESS_TOKEN ausentes no ambiente.");
  } else if (await jaEnviado(transactionId, "meta")) {
    console.log("  Meta: PULADO — ja registrado em conversions_sent (idempotencia).");
  } else if (!metaNoPrazo) {
    console.log("  Meta: PULADO — fora da janela de 7 dias.");
  } else {
    const userData = {};
    if (campos.fbp) userData.fbp = campos.fbp;
    if (campos.fbc) userData.fbc = campos.fbc;
    if (draft?.guestEmail) userData.em = [sha256(draft.guestEmail)];
    if (draft?.guestPhone) userData.ph = [sha256(String(draft.guestPhone).replace(/\D/g, ""))];

    const corpo = {
      data: [
        {
          event_name: "Purchase",
          event_id: transactionId,
          event_time: Math.floor(QUANDO.getTime() / 1000),
          action_source: "website",
          user_data: userData,
          custom_data: {
            value: valor,
            currency: MOEDA,
            content_type: "product",
            contents: [{ id: itemId, quantity: 1, item_price: valor }],
          },
        },
      ],
    };
    if (args.dryRun) {
      console.log("  Meta: [dry-run] enviaria:", JSON.stringify(corpo));
    } else {
      const r = await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(META_PIXEL)}/events?access_token=${encodeURIComponent(META_TOKEN)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) },
      );
      const txt = await r.text().catch(() => "");
      console.log(`  Meta: enviado http=${r.status} resposta=${txt.slice(0, 200)}`);
      await marcarEnviado(transactionId, "meta", r.status);
    }
  }

  // --- PASSO 4: CSV do Google Ads ----------------------------------------
  console.log("\n[4] Google Ads (importacao manual)");
  if (!campos.gclid) {
    console.log("  Sem gclid no draft — nada a importar. A conversao de Ads,");
    console.log("  se houver, sai da tag do GTM, nao daqui.");
  } else {
    // Formato de importacao de conversoes offline do Google Ads. O envio pela
    // API nao e feito aqui de proposito: a importacao e manual no painel.
    const quandoAds = QUANDO.toISOString().replace("T", " ").slice(0, 19) + " +0000";
    const linhas = [
      "Parameters:TimeZone=+0000",
      "Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency",
      `${campos.gclid},Reserva concluida,${quandoAds},${valor},${MOEDA}`,
    ];
    const arquivo = join(process.cwd(), `google-ads-conversao-${transactionId}.csv`);
    if (args.dryRun) {
      console.log(`  [dry-run] geraria ${arquivo}:`);
      for (const l of linhas) console.log(`    ${l}`);
    } else {
      writeFileSync(arquivo, linhas.join("\n") + "\n", "utf8");
      console.log(`  CSV gerado: ${arquivo}`);
      console.log("  Importar em: Google Ads > Objetivos > Conversoes > Enviar conversoes offline");
    }
  }

  console.log("\n" + "=".repeat(72));
  if (args.dryRun) console.log("DRY-RUN: nada foi enviado nem gravado.");
  console.log("=".repeat(72));
}

main().catch((err) => {
  console.error("Falha:", err);
  process.exit(1);
});
