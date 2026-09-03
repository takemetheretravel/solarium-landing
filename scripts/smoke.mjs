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

/** Quebra de linha nos dois formatos: o repositório tem arquivos CRLF e LF. */
const SEPARADOR_DE_LINHA = /\r?\n/;

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
  // Todo o grupo (checkout) — é ele que renderiza campos bpmpi_* — mais as
  // rotas de API de pagamento.
  const ROTAS_PAGAMENTO = [
    /^src\/app\/\(checkout\)\//,
    /^src\/app\/api\/payments\//,
  ];
  // O envio server-side de conversão é o único módulo de analytics permitido
  // nas rotas de API de pagamento: ele roda no servidor, sem DOM.
  const IMPORT_ANALYTICS =
    /from\s+["'](@\/lib\/analytics\/(?!server-conversions)[^"']+|@\/components\/tracking\/[^"']+)["']/;
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
// 5. Nenhuma ocorrência do measurement id antigo no código da aplicação.
//
// `G-9J8F6Q1Y2M` é o stream do motor de reservas. O funil do site mede numa
// propriedade só; o id antigo voltando ao código divide a conversão em duas
// propriedades e nenhuma fecha com a outra.
// ---------------------------------------------------------------------------
{
  const ID_ANTIGO = "G-9J8F6Q1Y2M";
  const infratores = [];
  for (const f of FONTES) {
    const achados = linhasQueCasam(f.conteudo, new RegExp(ID_ANTIGO));
    if (achados.length) infratores.push(`${f.rel} — ${achados.join(" | ")}`);
  }
  if (infratores.length) {
    reprovar(`measurement id antigo (${ID_ANTIGO}) presente no código`, infratores);
  } else {
    aprovar(`nenhuma ocorrência de ${ID_ANTIGO} no código`);
  }
}

// ---------------------------------------------------------------------------
// 6. A CSP da rota de pagamento não contém tag manager nem analytics.
//
// GTM aparecendo no checkout se corrige no layout — nunca afrouxando a política.
// Esta checagem existe para que "só liberar o domínio" não seja um atalho.
// ---------------------------------------------------------------------------
{
  const PROIBIDOS = [
    "googletagmanager.com",
    "google-analytics.com",
    "connect.facebook.net",
    "facebook.com",
    "doubleclick.net",
    "googleadservices.com",
  ];
  const middleware = FONTES.find((f) => f.rel === "src/middleware.ts");
  if (!middleware) {
    reprovar("src/middleware.ts não encontrado", ["a CSP da rota de pagamento mora nele"]);
  } else {
    const achados = PROIBIDOS.filter((d) => middleware.conteudo.includes(d));
    if (achados.length) {
      reprovar("domínio de analytics/tag manager na CSP da rota de pagamento", [
        `encontrados: ${achados.join(", ")}`,
        "Corrija no layout do grupo (checkout), não na política.",
      ]);
    } else {
      aprovar("CSP da rota de pagamento sem domínio de analytics/tag manager");
    }
  }
}

// ---------------------------------------------------------------------------
// 7. dataLayer.ts não exporta função de compra.
//
// `purchase` é exclusivamente server-side. Uma função de compra no módulo do
// navegador é convite a reativar o disparo duplo.
// ---------------------------------------------------------------------------
{
  const dl = FONTES.find((f) => f.rel === "src/lib/analytics/dataLayer.ts");
  if (!dl) {
    reprovar("src/lib/analytics/dataLayer.ts não encontrado", []);
  } else {
    const achados = linhasQueCasam(dl.conteudo, /export\s+(async\s+)?function\s+\w*[Pp]urchase\w*/);
    if (achados.length) {
      reprovar("dataLayer.ts exporta função de compra", achados);
    } else {
      aprovar("dataLayer.ts não exporta função de compra");
    }
  }
}

// ---------------------------------------------------------------------------
// 8. CSP_MODE ausente resolve para report-only.
//
// O 3DS só é exercitável em produção. Um default que bloqueia recusaria cartão
// legítimo no primeiro deploy que esquecesse a variável.
// ---------------------------------------------------------------------------
{
  const middleware = FONTES.find((f) => f.rel === "src/middleware.ts");
  if (!middleware) {
    reprovar("src/middleware.ts não encontrado", ["o modo da CSP mora nele"]);
  } else if (!/process\.env\.CSP_MODE\s*\|\|\s*["']report-only["']/.test(middleware.conteudo)) {
    reprovar("CSP_MODE não tem default explícito 'report-only'", [
      'esperado algo como: process.env.CSP_MODE || "report-only"',
    ]);
  } else if (!middleware.conteudo.includes("Content-Security-Policy-Report-Only")) {
    reprovar("middleware não emite o header Report-Only", [
      "com CSP_MODE ausente o header precisa ser Content-Security-Policy-Report-Only",
    ]);
  } else {
    aprovar("CSP_MODE ausente resolve para report-only");
  }
}

// ---------------------------------------------------------------------------
// 9. O GTM continua carregado no site.
//
// As checagens 3 e 6 garantem que o container NAO aparece no checkout. Faltava
// a metade oposta: nada verificava que ele AINDA aparece no site. O smoke passou
// verde num deployment em que o container estava invisivel, e o buraco so foi
// descoberto olhando a aba Network.
//
// Verificacao estatica de codigo — o smoke nao sobe servidor. Ela nao substitui
// conferir a tag em producao: `analyticsAtivo()` restringe o carregamento a
// VERCEL_ENV === "production", entao um preview verde aqui continua sem GTM.
// ---------------------------------------------------------------------------
{
  const GTM_ESPERADO = "GTM-MRV2KVJF";
  const LAYOUT_SITE = "src/app/(site)/layout.tsx";
  const CARREGADOR = "src/lib/analytics/AnalyticsScripts.tsx";
  const problemas = [];

  const layout = FONTES.find((f) => f.rel === LAYOUT_SITE);
  if (!layout) {
    problemas.push(`${LAYOUT_SITE} nao encontrado — o layout raiz do site sumiu ou mudou de lugar`);
  } else {
    // Precisa ser IMPORT de verdade: a mencao em comentario nao conta.
    const importa = /^\s*import\s+AnalyticsScripts.*from\s+["']@\/lib\/analytics\/AnalyticsScripts["']/m.test(
      layout.conteudo,
    );
    if (!importa) problemas.push(`${LAYOUT_SITE} nao importa AnalyticsScripts`);
    // E precisa RENDERIZAR o componente, nao so importar.
    if (!/<AnalyticsScripts\s*\/>/.test(layout.conteudo)) {
      problemas.push(`${LAYOUT_SITE} importa mas nao renderiza <AnalyticsScripts />`);
    }
  }

  const carregador = FONTES.find((f) => f.rel === CARREGADOR);
  if (!carregador) {
    problemas.push(`${CARREGADOR} nao encontrado`);
  } else {
    const m = carregador.conteudo.match(/export\s+const\s+GTM_ID\s*=\s*["']([^"']+)["']/);
    if (!m) {
      problemas.push(`${CARREGADOR} nao exporta GTM_ID`);
    } else if (m[1] !== GTM_ESPERADO) {
      problemas.push(`GTM_ID mudou: esperado ${GTM_ESPERADO}, encontrado ${m[1]}`);
    }
    if (!carregador.conteudo.includes("googletagmanager.com/gtm.js")) {
      problemas.push(`${CARREGADOR} nao carrega mais o gtm.js`);
    }
  }

  if (problemas.length) {
    reprovar("GTM deixou de ser carregado no site", problemas);
  } else {
    aprovar(`GTM (${GTM_ESPERADO}) carregado pelo layout do site`);
  }
}

// ---------------------------------------------------------------------------
// 10. Toda rota que cria reserva chama enviarConversaoReserva.
//
// O disparo de conversao morava DENTRO de /api/payments/braspag/credit. A rota
// Cielo, que e o caminho de producao, nunca recebeu a instrumentacao: reserva
// criada, cliente cobrado, zero conversao registrada. Enquanto o disparo for
// codigo dentro de uma rota, a proxima rota nasce com o mesmo buraco.
// ---------------------------------------------------------------------------
{
  const CRIA_RESERVA = "createHostawayReservation";
  const DISPARA = "enviarConversaoReserva";
  // Arquivos que so repassam parametros de reserva, sem criar nada.
  const ISENTOS = new Set([
    "src/lib/hostaway.ts",          // e a implementacao, nao um chamador
    "src/lib/reservation-recovery.ts",
  ]);
  const infratores = [];
  for (const f of FONTES) {
    if (ISENTOS.has(f.rel)) continue;
    if (!f.conteudo.includes(CRIA_RESERVA)) continue;
    if (f.conteudo.includes(DISPARA)) continue;
    infratores.push(`${f.rel} cria reserva mas nao chama ${DISPARA}()`);
  }
  if (infratores.length) {
    reprovar("rota cria reserva sem disparar conversao", infratores);
  } else {
    aprovar(`todo caminho que cria reserva chama ${DISPARA}()`);
  }
}

// ---------------------------------------------------------------------------
// 12. Toda rota de cobranca revalida o draft antes de cobrar.
//
// O draft vive 24h para nao perder a atribuicao de campanha de um checkout com
// retentativas. O preco de viver tanto e envelhecer: diaria muda no PMS, data e
// vendida por outro canal, dia de chegada e fechado. Uma rota de cobranca sem
// esta guarda cobra o valor velho em silencio — que e o unico desfecho pior do
// que perder a atribuicao. A guarda nao pode sumir por descuido de refatoracao.
// ---------------------------------------------------------------------------
{
  const REVALIDA = "revalidarDraftAntesDeCobrar";
  // Cobram de verdade. Rotas de status/polling nao entram: nao autorizam nada.
  const ROTAS_DE_COBRANCA = [
    "src/app/api/payments/credit/route.ts",
    "src/app/api/payments/pix/route.ts",
    "src/app/api/payments/braspag/credit/route.ts",
    "src/app/api/payments/braspag/pix/route.ts",
  ];
  const infratores = [];
  for (const rel of ROTAS_DE_COBRANCA) {
    const f = FONTES.find((x) => x.rel === rel);
    if (!f) {
      infratores.push(`${rel} sumiu ou mudou de lugar`);
      continue;
    }
    // Exige a CHAMADA, nao a mencao: o `import` sozinho satisfaria um includes()
    // e deixaria passar a rota sem a guarda.
    if (!f.conteudo.includes(`await ${REVALIDA}(`)) {
      infratores.push(`${rel} cobra sem chamar ${REVALIDA}()`);
    }
  }
  if (infratores.length) {
    reprovar("rota de cobranca sem revalidacao do draft", [
      ...infratores,
      "Draft de 24h sem revalidacao = cobranca com preco desatualizado.",
    ]);
  } else {
    aprovar(`as ${ROTAS_DE_COBRANCA.length} rotas de cobranca chamam ${REVALIDA}()`);
  }
}

// ---------------------------------------------------------------------------
// 11. A criacao de draft valida restricao de chegada.
//
// O PMS recusa chegada em certos dias (`closedOnArrival`). Enquanto o site nao
// lia esse campo, o pacote Dois Casais oferecia entrada no domingo no Completo:
// o hospede escolhia, pagava, e a reserva nao podia ser efetivada. O draft e a
// ULTIMA barreira antes da cobranca — ela nao pode ser pulada.
// ---------------------------------------------------------------------------
{
  const VALIDACAO = "chegadaPermitida";
  const draft = FONTES.find((f) => f.rel === "src/app/api/reservations/draft/route.ts");
  if (!draft) {
    reprovar("rota de criacao de draft nao encontrada", [
      "src/app/api/reservations/draft/route.ts sumiu ou mudou de lugar",
    ]);
    // Exige a CHAMADA, nao a mencao: `import { chegadaPermitida }` sozinho
    // satisfaria um `includes()` e deixaria passar a rota sem validacao.
  } else if (!draft.conteudo.includes(`await ${VALIDACAO}(`)) {
    reprovar("draft criado sem validar restricao de chegada", [
      `src/app/api/reservations/draft/route.ts nao chama ${VALIDACAO}()`,
      "Sem isso, uma data que a Hostaway recusa vira cobranca.",
    ]);
  } else {
    aprovar(`criacao de draft valida chegada via ${VALIDACAO}()`);
  }
}

// ---------------------------------------------------------------------------
// 13. A simulacao de pos-pagamento nao alcanca gateway nenhum.
//
// A rota existe para exercitar o pos-pagamento SEM cobrar. No dia em que ela
// puder importar braspag.ts ou cielo.ts, deixa de ser simulacao e vira uma forma
// obscura de cobrar de verdade — com token de admin e sem tela.
// ---------------------------------------------------------------------------
{
  const SIMULACAO = "src/app/api/admin/simular-pos-pagamento/route.ts";
  const GATEWAYS = [/@\/lib\/braspag/, /@\/lib\/cielo/, /braspag-pix-confirm/, /pix-pricing/];
  const f = FONTES.find((x) => x.rel === SIMULACAO);
  if (!f) {
    reprovar("rota de simulacao nao encontrada", [`${SIMULACAO} sumiu ou mudou de lugar`]);
  } else {
    const achados = [];
    for (const re of GATEWAYS) {
      const linhas = f.conteudo.split(SEPARADOR_DE_LINHA)
        .filter((l) => /^\s*import\s/.test(l) && re.test(l));
      achados.push(...linhas.map((l) => l.trim()));
    }
    if (achados.length) {
      reprovar("simulacao alcanca modulo de gateway", [
        ...achados,
        "A simulacao NAO pode chamar gateway: e essa a propriedade que a torna segura.",
      ]);
    } else {
      aprovar("simulacao nao importa nenhum modulo de gateway");
    }
  }
}

// ---------------------------------------------------------------------------
// 14. A simulacao exige ADMIN_API_TOKEN e recusa conversao sem test_event_code.
//
// Duas guardas, um bloco: sem token, um estranho cria reserva na conta de
// producao; sem `META_TEST_EVENT_CODE`, o Purchase de ensaio vira venda REAL no
// Meta e entra na otimizacao de campanha. As duas ja custaram caro em outras
// rotas deste repositorio.
// ---------------------------------------------------------------------------
{
  const ROTAS_ADMIN = [
    "src/app/api/admin/simular-pos-pagamento/route.ts",
    "src/app/api/admin/simular-pos-pagamento/[reservationId]/route.ts",
    "src/app/api/admin/diagnostico/route.ts",
  ];
  const problemas = [];

  for (const rel of ROTAS_ADMIN) {
    const f = FONTES.find((x) => x.rel === rel);
    if (!f) {
      problemas.push(`${rel} sumiu ou mudou de lugar`);
      continue;
    }
    // Exige a CHAMADA da guarda, nao a mencao.
    if (!/exigirAdmin(ForaDeProducao)?\(req\)/.test(f.conteudo)) {
      problemas.push(`${rel} nao chama exigirAdmin() — rota administrativa aberta`);
    }
  }

  const sim = FONTES.find((x) => x.rel === "src/app/api/admin/simular-pos-pagamento/route.ts");
  if (sim) {
    if (!sim.conteudo.includes("META_TEST_EVENT_CODE")) {
      problemas.push("simulacao nao le META_TEST_EVENT_CODE — conversao de ensaio viraria venda real");
    }
    // A recusa tem que ACONTECER, nao so a leitura existir.
    if (!/if\s*\(!metaTestEventCode\)/.test(sim.conteudo)) {
      problemas.push("simulacao le META_TEST_EVENT_CODE mas nao recusa quando ele falta");
    }
    if (!sim.conteudo.includes("modoTeste")) {
      problemas.push("simulacao nao marca a conversao como teste (modoTeste)");
    }
  }

  if (problemas.length) {
    reprovar("rota administrativa sem guarda", problemas);
  } else {
    aprovar("rotas admin exigem token; simulacao recusa sem test_event_code");
  }
}

// ---------------------------------------------------------------------------
// 15. Nenhuma chave de acesso escrita no codigo-fonte.
//
// As rotas /api/debug/* eram guardadas por `?key=lucas2026`, com a chave neste
// repositorio PUBLICO. Uma delas cria reserva na conta de producao da Hostaway;
// outra derruba o token de acesso. Segredo em codigo-fonte nao e segredo.
// ---------------------------------------------------------------------------
{
  // Padroes de "chave literal usada como guarda". Comentario nao conta.
  const SUSPEITOS = [
    /(?:key|senha|password|secret|token)\s*(?:===?|!==?)\s*["'][A-Za-z0-9_-]{6,}["']/,
    /const\s+(?:DEBUG_KEY|ADMIN_KEY|API_KEY)\s*=\s*["'][A-Za-z0-9_-]{6,}["']/,
  ];
  const infratores = [];
  for (const f of FONTES) {
    f.conteudo.split(SEPARADOR_DE_LINHA).forEach((linha, i) => {
      const semComentario = linha.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
      if (!semComentario.trim()) return;
      // `e.key === "Escape"` é tecla de teclado, não credencial. A propriedade
      // `key` de um KeyboardEvent casa com o padrão e não tem nada a ver.
      if (/\b(e|ev|evt|event)\.key\b/.test(semComentario)) return;
      if (SUSPEITOS.some((re) => re.test(semComentario))) {
        infratores.push(`${f.rel} linha ${i + 1}: ${semComentario.trim().slice(0, 110)}`);
      }
    });
  }
  if (infratores.length) {
    reprovar("chave de acesso escrita no codigo-fonte", [
      ...infratores,
      "Use ADMIN_API_TOKEN via @/lib/admin-auth. O repositorio e publico.",
    ]);
  } else {
    aprovar("nenhuma chave de acesso literal no codigo");
  }
}

// ---------------------------------------------------------------------------
// 16. As datas padrao dos pacotes respeitam as regras de saida deles.
//
// O Final de Ano abria em 29/12 -> 01/01 (terca a sexta) enquanto a propria tela
// avisava que a saida precisa ser sabado, domingo ou segunda. Sugestao que o
// pacote recusa ensina a data errada. A suite de preco cobre isso; aqui garante
// que o arquivo de teste continua existindo e sendo executado.
// ---------------------------------------------------------------------------
{
  const TESTE = join(RAIZ, "src", "lib", "pricing", "datas-padrao.test.ts");
  let conteudo = "";
  try {
    conteudo = readFileSync(TESTE, "utf8");
  } catch {
    conteudo = "";
  }
  if (!conteudo) {
    reprovar("teste das datas padrao sumiu", [
      "src/lib/pricing/datas-padrao.test.ts e o que impede um pacote de sugerir data que ele proprio recusa.",
    ]);
  } else if (!conteudo.includes("checkoutSugerido") || !conteudo.includes("checkoutDows")) {
    reprovar("teste das datas padrao deixou de checar as regras de saida", [
      "datas-padrao.test.ts precisa comparar a saida sugerida com checkoutDows do pacote.",
    ]);
  } else {
    aprovar("datas padrao dos pacotes cobertas contra as regras de saida");
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 17. As rotas de cron respondem 401 sem header e 200 com header valido.
//
// `/api/hostaway/finalizar-pagamentos` respondeu 401 em 144 de 144 execucoes e
// `pix-reconcile` em 100% das diarias. Duas filas paradas por semanas sem que
// nada reprovasse. Esta checagem so roda quando ha servidor de pe e segredo no
// ambiente (CRON_SECRET ou HOSTAWAY_FINALIZE_SECRET); sem isso ela e PULADA, e
// nunca reprova o build por falta de ambiente.
//
// PowerShell:
//   $env:SMOKE_BASE_URL = "http://localhost:3000"
//   $env:CRON_SECRET = "<valor>"
//   npm run smoke
// ---------------------------------------------------------------------------
{
  const base = (process.env.SMOKE_BASE_URL || "").trim().replace(/\/+$/, "");
  const segredo = (process.env.CRON_SECRET || process.env.HOSTAWAY_FINALIZE_SECRET || "").trim();
  const ROTAS = ["/api/hostaway/finalizar-pagamentos", "/api/payments/braspag/pix-reconcile"];

  if (!base || !segredo) {
    aprovar(
      "crons: checagem HTTP pulada (defina SMOKE_BASE_URL e CRON_SECRET para exercitar)",
    );
  } else {
    const problemas = [];
    for (const rota of ROTAS) {
      try {
        const semHeader = await fetch(base + rota);
        if (semHeader.status !== 401) {
          problemas.push(rota + " sem header respondeu " + semHeader.status + ", esperado 401");
        }
        const comHeader = await fetch(base + rota, {
          headers: { Authorization: "Bearer " + segredo },
        });
        if (comHeader.status !== 200) {
          problemas.push(
            rota + " com header valido respondeu " + comHeader.status + ", esperado 200",
          );
        }
      } catch (err) {
        problemas.push(rota + " inacessivel: " + err.message);
      }
    }
    if (problemas.length) {
      reprovar("rota de cron com autorizacao quebrada", problemas);
    } else {
      aprovar("crons respondem 401 sem header e 200 com header valido");
    }
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
