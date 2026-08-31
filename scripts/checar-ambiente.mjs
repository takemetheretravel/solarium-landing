#!/usr/bin/env node
/**
 * Confere as credenciais de medição: presença, formato e — o que importa —
 * se são **aceitas** pelo destino.
 *
 * "A variável existe" não responde a pergunta que interessa. Um `GA4_API_SECRET`
 * revogado existe e é uma string; só uma chamada real revela que ele não vale.
 *
 * NUNCA imprime valor de credencial. Só presença, formato e veredito.
 *
 * Uso:
 *   node scripts/checar-ambiente.mjs
 *   node scripts/checar-ambiente.mjs --sem-rede    (só presença/formato)
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SEM_REDE = process.argv.includes("--sem-rede");

function carregarEnv() {
  const caminho = join(process.cwd(), ".env.local");
  if (!existsSync(caminho)) return false;
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
  return true;
}
const temEnvLocal = carregarEnv();

let problemas = 0;
const OK = "  ok   ";
const FALHA = "  FALHA";
const AVISO = "  aviso";

function linha(marca, nome, detalhe) {
  console.log(`${marca}  ${nome.padEnd(28)} ${detalhe}`);
}

/** Presença + formato. Nunca ecoa o valor — só o comprimento. */
function checar(nome, { obrigatoria = true, formato = null, descricaoFormato = "" } = {}) {
  const bruto = process.env[nome];
  const valor = (bruto ?? "").trim();
  if (!valor) {
    if (obrigatoria) {
      problemas++;
      linha(FALHA, nome, "AUSENTE");
    } else {
      linha(AVISO, nome, "ausente (opcional)");
    }
    return null;
  }
  // Espaço nas pontas já derrubou um token em produção: vale avisar.
  if (bruto !== valor) {
    linha(AVISO, nome, `presente (${valor.length} chars) — TEM ESPAÇO/QUEBRA NAS PONTAS`);
  }
  if (formato && !formato.test(valor)) {
    problemas++;
    linha(FALHA, nome, `presente (${valor.length} chars) mas fora do formato: ${descricaoFormato}`);
    return valor;
  }
  linha(OK, nome, `presente (${valor.length} chars)`);
  return valor;
}

console.log("=".repeat(70));
console.log("CHECAGEM DE AMBIENTE" + (SEM_REDE ? "  [sem rede]" : ""));
console.log(`.env.local: ${temEnvLocal ? "carregado" : "nao encontrado (usando so o ambiente)"}`);
console.log("=".repeat(70));

console.log("\n[1] Presenca e formato");
const ga4Id = checar("GA4_MEASUREMENT_ID", {
  formato: /^G-[A-Z0-9]+$/,
  descricaoFormato: "deve comecar com 'G-'",
});
const ga4Secret = checar("GA4_API_SECRET");
const metaPixel = checar("META_PIXEL_ID", {
  formato: /^\d+$/,
  descricaoFormato: "so digitos",
});
const metaToken = checar("META_CAPI_ACCESS_TOKEN");
checar("ADMIN_API_TOKEN");
checar("HOSTAWAY_FINALIZE_SECRET", { obrigatoria: false });

const cspModo = (process.env.CSP_MODE ?? "").trim();
if (!cspModo) {
  linha(OK, "CSP_MODE", "ausente -> resolve para 'report-only' (padrao seguro)");
} else if (cspModo === "report-only" || cspModo === "enforce") {
  linha(cspModo === "enforce" ? AVISO : OK, "CSP_MODE", `'${cspModo}'${cspModo === "enforce" ? " — BLOQUEANDO" : ""}`);
} else {
  problemas++;
  linha(FALHA, "CSP_MODE", `'${cspModo}' invalido — aceitos: report-only | enforce`);
}

// ---------------------------------------------------------------------------
// Validacao REAL. Presenca nao prova aceitacao.

if (!SEM_REDE) {
  console.log("\n[2] As credenciais sao aceitas?");

  // GA4: /debug/mp/collect devolve validationMessages. Credencial errada
  // aparece aqui — o /mp/collect normal responderia 204 e nao diria nada.
  if (!ga4Id || !ga4Secret) {
    linha(AVISO, "GA4", "pulado — falta credencial");
  } else {
    try {
      const corpo = {
        client_id: "1.1",
        events: [
          {
            name: "purchase",
            params: { transaction_id: "checagem-ambiente", value: 1, currency: "BRL" },
          },
        ],
      };
      const res = await fetch(
        `https://www.google-analytics.com/debug/mp/collect?measurement_id=${encodeURIComponent(ga4Id)}&api_secret=${encodeURIComponent(ga4Secret)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) },
      );
      const dados = await res.json().catch(() => ({}));
      const msgs = dados?.validationMessages ?? [];
      if (msgs.length === 0) {
        // O endpoint de debug NAO contabiliza nada: isto e so validacao.
        linha(OK, "GA4 (debug/mp/collect)", "credenciais ACEITAS, payload valido");
      } else {
        problemas++;
        linha(FALHA, "GA4 (debug/mp/collect)", msgs.map((m) => `${m.validationCode ?? "?"}: ${m.description ?? "?"}`).join(" | "));
      }
    } catch (err) {
      problemas++;
      linha(FALHA, "GA4 (debug/mp/collect)", `erro de rede: ${err.message}`);
    }
  }

  // Meta: `test_event_code` sem codigo real ainda valida token e pixel — um
  // token invalido devolve erro 190/OAuth, que e exatamente o que queremos ver.
  if (!metaPixel || !metaToken) {
    linha(AVISO, "Meta", "pulado — falta credencial");
  } else {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(metaPixel)}?fields=id,name&access_token=${encodeURIComponent(metaToken)}`,
      );
      const dados = await res.json().catch(() => ({}));
      if (res.ok && dados?.id) {
        linha(OK, "Meta (Graph API)", `token ACEITO, pixel ${dados.id} acessivel`);
      } else {
        problemas++;
        const e = dados?.error ?? {};
        linha(FALHA, "Meta (Graph API)", `http=${res.status} ${e.type ?? ""} ${e.code ?? ""}: ${e.message ?? "resposta inesperada"}`);
      }
    } catch (err) {
      problemas++;
      linha(FALHA, "Meta (Graph API)", `erro de rede: ${err.message}`);
    }
  }
}

console.log("\n" + "=".repeat(70));
if (problemas > 0) {
  console.log(`${problemas} problema(s). A medicao NAO esta integra.`);
  process.exit(1);
}
console.log("Ambiente integro.");
