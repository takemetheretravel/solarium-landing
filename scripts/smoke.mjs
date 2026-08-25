#!/usr/bin/env node
/**
 * Smoke de integridade — falha o build/CI quando uma das invariantes cai.
 *
 * Cada checagem existe porque a coisa que ela protege já quebrou uma vez em
 * produção. Rodar: `npm run smoke`.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { execFileSync } from "node:child_process";

const RAIZ = process.cwd();
const SRC = join(RAIZ, "src");

let falhas = 0;

function reprovar(titulo, detalhes) {
  falhas++;
  console.error(`\n✗ ${titulo}`);
  for (const d of detalhes) console.error(`    ${d}`);
}

function aprovar(titulo) {
  console.log(`✓ ${titulo}`);
}

/** Todos os arquivos .ts/.tsx sob src/, com caminho relativo normalizado a "/". */
function arquivosFonte(dir = SRC) {
  const saida = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      if (nome === "node_modules" || nome === ".next") continue;
      saida.push(...arquivosFonte(caminho));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(nome)) continue;
    saida.push({
      caminho,
      rel: relative(RAIZ, caminho).split(sep).join("/"),
      conteudo: readFileSync(caminho, "utf8"),
    });
  }
  return saida;
}

const FONTES = arquivosFonte();

function linhasQueCasam(conteudo, regex) {
  const achados = [];
  conteudo.split("\n").forEach((linha, i) => {
    if (regex.test(linha)) achados.push(`linha ${i + 1}: ${linha.trim().slice(0, 120)}`);
  });
  return achados;
}

// ---------------------------------------------------------------------------
// 1. Nenhum fbq( ou gtag( fora de src/lib/analytics/
//
// Todo disparo de pixel passa por um lugar só. Espalhado, ninguém consegue
// dizer quantas vezes um Purchase é contado nem trocar as tags sem caçar
// chamadas por toda parte.
// ---------------------------------------------------------------------------
{
  const PERMITIDO = "src/lib/analytics/";
  const CHAMADA = /\b(fbq|gtag)\s*\(/;
  const infratores = [];
  for (const f of FONTES) {
    if (f.rel.startsWith(PERMITIDO)) continue;
    const achados = linhasQueCasam(f.conteudo, CHAMADA);
    if (achados.length) infratores.push(`${f.rel}\n      ${achados.join("\n      ")}`);
  }
  if (infratores.length) {
    reprovar("fbq(/gtag( fora de src/lib/analytics/", infratores);
  } else {
    aprovar("nenhum fbq(/gtag( fora de src/lib/analytics/");
  }
}

// ---------------------------------------------------------------------------
// 2. Nenhum console.* com chave sensível no fluxo de pagamento.
//
// Os logs de produção são exportáveis. BIN, credencial, código de
// estabelecimento e identificador de antifraude não podem chegar lá.
// ---------------------------------------------------------------------------
{
  const CHAVES = [
    "cardNumber",
    "cardBin",
    "cardbin",
    "merchantId",
    "merchantKey",
    "clientIdLen",
    "secretLen",
    "secretEndsWithEq",
    "clientSecret",
    "establishmentCode",
    "EstablishmentCode",
    "FraudAnalysisId",
    "FraudScore",
    "browserFingerprint",
    "SecurityCode",
    "cardCvv",
  ];
  // Só a LINHA do console interessa; a definição da constante em redact.ts, não.
  const infratores = [];
  for (const f of FONTES) {
    if (f.rel === "src/lib/log/redact.ts") continue;
    if (f.rel === "scripts/smoke.mjs") continue;
    f.conteudo.split("\n").forEach((linha, i) => {
      if (!/console\.(log|error|warn|info|debug)/.test(linha)) return;
      const achadas = CHAVES.filter((k) => linha.includes(k));
      if (achadas.length) {
        infratores.push(`${f.rel} linha ${i + 1} [${achadas.join(", ")}]: ${linha.trim().slice(0, 120)}`);
      }
    });
  }
  if (infratores.length) {
    reprovar("console.* com chave sensível no fluxo de pagamento", infratores);
  } else {
    aprovar("nenhum console.* com chave sensível");
  }
}

// ---------------------------------------------------------------------------
// 3. As rotas de pagamento não importam módulos de analytics.
//
// A rota de pagamento renderiza os campos bpmpi_* com dados de cartão no DOM.
// Um import de analytics ali é um script de terceiro com acesso a esse DOM.
// ---------------------------------------------------------------------------
{
  const ROTAS_PAGAMENTO = [
    /^src\/app\/reservar\/\[draftId\]\/pagamento\//,
    /^src\/app\/api\/payments\//,
    /^src\/app\/braspag-3ds-test\//,
  ];
  // O envio server-side de conversão é o único módulo de analytics permitido
  // nas rotas de API de pagamento: ele roda no servidor, sem DOM.
  const IMPORT_ANALYTICS = /from\s+["']@\/lib\/analytics\/(?!server-conversions)[^"']+["']/;
  const infratores = [];
  for (const f of FONTES) {
    if (!ROTAS_PAGAMENTO.some((re) => re.test(f.rel))) continue;
    const achados = linhasQueCasam(f.conteudo, IMPORT_ANALYTICS);
    if (achados.length) infratores.push(`${f.rel}\n      ${achados.join("\n      ")}`);
  }
  if (infratores.length) {
    reprovar("rota de pagamento importando módulo de analytics", infratores);
  } else {
    aprovar("rotas de pagamento sem import de analytics de navegador");
  }
}

// ---------------------------------------------------------------------------
// 4. Os quatro totais golden continuam corretos.
//
// São o contrato de preço do motor de pacotes. Se um deles mudar, o valor
// esperado NÃO se ajusta: a mudança de preço é que precisa ser justificada.
// ---------------------------------------------------------------------------
{
  const GOLDEN = [3460, 3740, 5990, 6340];
  const testes = join(RAIZ, "src", "lib", "pricing", "pacotes.test.ts");
  const conteudo = readFileSync(testes, "utf8");
  const ausentes = GOLDEN.filter((v) => !conteudo.includes(String(v)));
  if (ausentes.length) {
    reprovar("total golden sumiu da suíte de preço", [
      `não encontrados em src/lib/pricing/pacotes.test.ts: ${ausentes.join(", ")}`,
    ]);
  } else {
    try {
      // `shell: true` porque no Windows o executável é um .cmd, que o
      // execFileSync não resolve sozinho.
      execFileSync("npx", ["vitest", "run", "src/lib/pricing", "--reporter=dot"], {
        stdio: "pipe",
        cwd: RAIZ,
        shell: true,
      });
      aprovar(`totais golden verificados (${GOLDEN.join(" / ")})`);
    } catch (err) {
      const saida = [err.stdout?.toString() ?? "", err.stderr?.toString() ?? ""].join("\n");
      reprovar("suíte de preço reprovou", [
        "NÃO ajuste o valor esperado — investigue a mudança de preço.",
        ...saida.split("\n").filter(Boolean).slice(-25),
      ]);
    }
  }
}

console.log("");
if (falhas > 0) {
  console.error(`smoke: ${falhas} verificação(ões) reprovada(s).`);
  process.exit(1);
}
console.log("smoke: tudo certo.");
