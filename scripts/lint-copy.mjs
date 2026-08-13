#!/usr/bin/env node
/**
 * Lint de vocabulário sobre a copy nova (Pacotes V2).
 *
 * Falha o build quando encontra palavra proibida pelo Manual da Marca. O escopo é
 * deliberadamente restrito aos arquivos novos: a copy legada e os depoimentos de
 * hóspedes são citações e não podem ser reescritos.
 */

import fs from "fs";
import path from "path";

const RAIZ = path.resolve(process.argv[2] ?? ".");

/** Só a copy nova. Ampliar conforme a fase avança. */
const ESCOPO = [
  "src/config/precos-e-extras.ts",
  "src/app/pacotes",
  "src/components/pacotes",
  "src/components/extras",
];

const PROIBIDAS = [
  "luxo",
  "luxuoso",
  "exclusivo",
  "exclusiva",
  "premium",
  "sofisticado",
  "sofisticada",
  "experiencia unica",
  "momentos inesqueciveis",
  "o lugar perfeito",
  "chale",
  "pousada",
  "amenidades",
  "unidade",
  "unidades",
];

/** "investimento" só é proibido quando fala de diária/estadia/preço. */
const CONTEXTUAIS = [
  {
    termo: "investimento",
    contexto: /(diaria|estadia|noite|preco|valor|reserva)/,
    janela: 60,
  },
];

function semAcento(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function arquivosDe(alvo) {
  const abs = path.join(RAIZ, alvo);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return [abs];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? arquivosDe(path.join(alvo, e.name))
        : /\.(ts|tsx|md)$/.test(e.name)
          ? [path.join(abs, e.name)]
          : [],
    );
}

/**
 * Só o que o cliente lê: literais de string e texto JSX. Nomes de identificador e
 * comentários ficam de fora — `unidade: UnidadeExtra` é tipo, não copy.
 */
function textoVisivel(linha) {
  const trechos = [];

  const literais = linha.match(/"[^"]*"|'[^']*'|`[^`]*`/g) ?? [];
  // `${...}` dentro de template literal é código, não copy.
  for (const l of literais) trechos.push(l.slice(1, -1).replace(/\$\{[^}]*\}/g, " "));

  const semLiterais = linha.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "");
  const jsx = semLiterais.match(/>([^<>{}]+)</g) ?? [];
  for (const j of jsx) trechos.push(j.slice(1, -1));

  return trechos.join(" ");
}

const achados = [];

for (const alvo of ESCOPO) {
  for (const arquivo of arquivosDe(alvo)) {
    const linhas = fs.readFileSync(arquivo, "utf8").split(/\r?\n/);
    linhas.forEach((linha, i) => {
      const plana = semAcento(textoVisivel(linha));
      if (!plana.trim()) return;

      for (const palavra of PROIBIDAS) {
        const re = new RegExp(`\\b${palavra.replace(/ /g, "\\s+")}\\b`);
        if (re.test(plana)) {
          achados.push({ arquivo, linha: i + 1, termo: palavra, texto: linha.trim() });
        }
      }

      for (const { termo, contexto, janela } of CONTEXTUAIS) {
        const pos = plana.indexOf(termo);
        if (pos === -1) continue;
        const redor = plana.slice(Math.max(0, pos - janela), pos + janela);
        if (contexto.test(redor)) {
          achados.push({ arquivo, linha: i + 1, termo, texto: linha.trim() });
        }
      }
    });
  }
}

if (achados.length === 0) {
  console.log("[lint-copy] ok — nenhuma palavra proibida na copy nova");
  process.exit(0);
}

console.error("\n[lint-copy] PALAVRAS PROIBIDAS ENCONTRADAS:\n");
for (const a of achados) {
  const rel = path.relative(RAIZ, a.arquivo).replace(/\\/g, "/");
  console.error(`  ${rel}:${a.linha}  "${a.termo}"`);
  console.error(`    ${a.texto.slice(0, 120)}`);
}
console.error(`\n${achados.length} ocorrência(s). Build interrompido.\n`);
process.exit(1);
