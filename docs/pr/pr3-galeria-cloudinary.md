Rodada 1 da galeria. As 26 fotos das casas saem de `/public` e passam a ser servidas pelo Cloudinary a partir de um manifesto gerado e validado no build. Nada muda em `/reservar/[draftId]/pagamento`, nem em `cielo.ts`, nem no fluxo de pagamento.

## LCP das três páginas de casa

Lighthouse 12, preset desktop, build de produção em `next start`, execução aquecida (a primeira passada de cada página foi descartada para não medir cache frio do otimizador).

| página | LCP antes | LCP depois | imagens antes | imagens depois | requisições |
|---|---|---|---|---|---|
| solarium-1 | 1,77s | **0,76s** | 372KB | 302KB | 18 → 13 |
| solarium-2 | 0,99s | **0,80s** | 344KB | 330KB | 18 → 13 |
| solarium-completo | 0,92s | **0,77s** | 355KB | 257KB | 22 → 13 |

Média de LCP: 1,23s → 0,77s (−37%). Bytes de imagem somados: 1072KB → 889KB (−17%), com o Completo mostrando 26 fotos onde antes mostrava 12.

O ganho do Solarium 1 é o maior porque era a única casa cujo hero ainda vinha de `/public` sem recorte no servidor.

## O que foi feito

**Manifesto.** `content/galerias/{casa}.json` com o schema pedido, tipado em zod. O `parse` roda no escopo do módulo em `src/config/galeria.ts`, então manifesto inválido derruba o `next build` apontando arquivo, campo e valores aceitos. Verificado na prática: um `ambiente` inventado aborta o build com exit 1.

**Geração.** `npm run galeria:sync` lê a Admin API do Cloudinary, extrai `context.alt`, tags e dimensões. Idempotente: duas execuções seguidas produzem bytes idênticos, e o campo `ordem` já existente é preservado. Um segundo script, `npm run upload:casas`, faz a migração dos JPGs carimbando alt e tags — sem ele o manifesto não teria de onde ler.

**Loader e performance.** Loader do `next/image` para Cloudinary com `f_auto,q_auto`, no lugar do `unoptimized` que fazia toda imagem externa vir em tamanho original. `sizes` reais por breakpoint em todo uso de imagem. `blurDataURL` embutido no manifesto. `priority` só no hero de cada página.

**Galeria.** `<Galeria casa="..." />` com mosaico de 5, contagem real, lightbox com teclado, swipe, contador, filtro por ambiente, deep-link `?foto={id}` e preload das vizinhas. Aceita `compacto` para a rodada 2. A grade de miniaturas duplicada saiu das três páginas.

**Metadados.** `og:image` e `twitter:image` próprios por página, em 1200x630 pelo Cloudinary. Google Drive eliminado do projeto, inclusive dos `remotePatterns` e do código morto.

**Analytics.** `gallery_open`, `gallery_photo_view` (com id e ambiente) e `gallery_filter_ambiente`, pelo módulo `dataLayer` existente.

## Duas decisões que valem revisão

**`SmartImage` virou client component.** Não foi escolha de estilo: `loader` é uma função, e função não atravessa a fronteira de um Server Component para um Client Component. O build quebrava inteiro com "Functions cannot be passed directly to Client Components". A alternativa era registrar o loader global em `next.config.mjs`, descartada porque mexeria na rota de pagamento.

**Solarium Completo mostra o acervo inteiro.** Os três grupos fixos de quatro fotos viraram o filtro por ambiente, e o manifesto agrega as três pastas do Cloudinary: 26 fotos em vez de 12. A reserva é das duas casas, então a galeria dela é o acervo das duas.

## Uma armadilha que quase passou

A primeira medição, antes do recorte no servidor, mostrou os bytes de imagem do Solarium 2 **subindo 124%**. O hero saía de 146KB para 586KB: `c_limit` entregava o retrato de 3000x4000 inteiro para preencher uma faixa que o CSS ia cortar de qualquer jeito. Os heros full-bleed agora recortam no servidor em 4:3 com teto de 1200px, o que iguala os bytes de hoje no desktop e entrega variantes bem menores no celular (375px a dpr 2 pede `w_750` em vez dos 1200 fixos).

## Verificação

- Suíte completa: **313 testes passando**, 58 novos.
- Cobertura pedida: validação do manifesto, ordenação, filtro por ambiente, deep-link, e o teste que falha se sobrar qualquer `/images/solarium-` ou `drive.google.com`.
- `tsc --noEmit` limpo, `next build` limpo.
- Testado no browser: mosaico, lightbox, setas, filtro, deep-link a frio, deep-link inválido (não abre foto arbitrária e limpa o parâmetro), eventos no `dataLayer`, e mobile a 375px sem rolagem horizontal.

Decisões registradas em `DECISOES.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
