# Relatório de imagens

Gerado por `npm run galerias:preparar`. Não editar à mão.
Nomes originais não aparecem aqui: vários trazem nome de hóspede.
**As pastas de `galerias-local/` decidem o que aparece e em qual chip.**

## Números

- Arquivos de imagem nas pastas: **183**
- Ignorados (não são imagem ou pasta fora do escopo): 0
- Imagens distintas (SHA-256): **165** — a diferença são cópias idênticas em mais de uma pasta
- Grupos de quase-duplicatas: **4** (4 versões fora do site)
- Fotos no site: **161**
- Fotos novas nesta rodada (sem curadoria de alt/estação): **0**
- Convertidos de HEIC/PNG para JPG: **6**
- Baixa resolução (lado maior < 1600px no original): **10**
- Com marca d'água "T": **28** — fora de capa, mosaico e Google
- Com tela mostrando conteúdo: **7** — fora de capa, mosaico e Google

## Fotos por chip × arquivos na pasta

"Arquivos" conta o que está na pasta; "No chip" conta fotos distintas (cópias idênticas e quase-duplicatas da mesma pasta viram uma).

| Casa | Chip (pasta) | Arquivos na pasta | No chip |
|---|---|---:|---:|
| solarium-1 | Vista (`vista`) | 11 | 11 |
| solarium-1 | SPA (`spa`) | 10 | 10 |
| solarium-1 | Quarto (`quarto`) | 11 | 11 |
| solarium-1 | Banheiro da suíte (`banheiro-suite`) | 7 | 7 |
| solarium-1 | Banheiro social (`banheiro-social`) | 5 | 5 |
| solarium-1 | Cozinha (`cozinha`) | 7 | 7 |
| solarium-1 | Área gourmet (`area-gourmet`) | 7 | 7 |
| solarium-1 | Sala (`sala`) | 4 | 4 |
| solarium-1 | Rede (`rede`) | 9 | 9 |
| solarium-1 | Amanhecer (`amanhecer`) | 9 | 9 |
| solarium-1 | Área externa (`externa`) | 11 | 11 |
| solarium-1 | Mais fotos (`geral`) | 1 | 1 |
| **solarium-1** | **Todas** | **92** | **84** |
| solarium-2 | Vista (`vista`) | 10 | 10 |
| solarium-2 | SPA (`spa`) | 7 | 7 |
| solarium-2 | Quarto (`quarto`) | 6 | 6 |
| solarium-2 | Cinema (`cinema`) | 5 | 5 |
| solarium-2 | Banheiro (`banheiro`) | 8 | 8 |
| solarium-2 | Cozinha (`cozinha`) | 11 | 11 |
| solarium-2 | Área gourmet (`area-gourmet`) | 7 | 7 |
| solarium-2 | Amanhecer (`amanhecer`) | 4 | 4 |
| solarium-2 | Área externa (`externa`) | 11 | 11 |
| solarium-2 | Mais fotos (`geral`) | 1 | 1 |
| **solarium-2** | **Todas** | **70** | **57** |
| completo | As duas casas (`conjunto`) | 8 | 8 |
| completo | Mais fotos (`geral`) | 1 | 1 |
| **completo** | **Todas** | **9** | **8** |
| experiencias | Experiencias (`experiencias`) | 10 | 10 |
| **experiencias** | **Todas** | **10** | **10** |
| comum | Marca (`marca`) | 2 | 2 |
| **comum** | **Todas** | **2** | **2** |

## Quase-duplicatas

Mesma cena em recorte ou edição diferente. Fica uma (maior resolução; entre as de resolução parecida, a retocada "Ret_"), que herda as pastas de todas. Miniaturas lado a lado na folha de contato (`npm run galerias:folha`).

- **`solarium-1/rede/rede-suspensa-com-almofadas.jpg`** (4032×3024) — confirmado: Solarium 1: rede suspensa com almofadas, mesma cena. Fora do site: `vista/rede-com-almofadas-e-vista-do-por-do-sol-e-da-serra` (4032×3024). Chips: Vista, Rede.
- **`solarium-2/banheiro/cama-spa-e-box.jpg`** (3000×4000) — confirmado: Solarium 2: cama e SPA de imersão com o box, recorte e edição diferentes. Fora do site: `spa/quarto-cama-e-banheira` (2048×1536). Chips: SPA, Banheiro.
- **`solarium-2/vista/telao-abrindo-ao-por-do-sol.jpg`** (3000×4000) — confirmado: Solarium 2: telão aberto para o deck ao pôr do sol. Fora do site: `cinema/cinema-por-do-sol` (2048×1536). Chips: Vista, Cinema.
- **`solarium-2/vista/quarto-e-spa-ao-por-do-sol.jpg`** (4000×3000) — confirmado: Solarium 2: quarto e SPA ao pôr do sol, mesmo enquadramento em outro recorte. Fora do site: `geral/quarto-por-do-sol` (2048×1536). Chips: Vista, SPA, Mais fotos.

## Mesma foto em mais de uma pasta

- `solarium-1/sala/mesa-posta-ao-nascer-do-sol.jpg` → Sala, Amanhecer
- `solarium-1/rede/spa-e-rede-suspensa-vista-serra.jpg` → Vista, Rede, Amanhecer
- `solarium-1/vista/vista-aerea-parque-itatiaia.jpg` → Vista, Amanhecer
- `solarium-1/vista/silhueta-da-serra-ao-amanhecer.jpg` → Vista, Amanhecer
- `solarium-1/cozinha/cozinha-com-vista-parque-itatiaia.jpg` → Cozinha, Sala
- `solarium-1/rede/rede-suspensa-com-almofadas.jpg` → Vista, Rede
- `solarium-1/spa/reflexo-da-serra-na-agua-do-spa.jpg` → Vista, SPA
- `solarium-2/banheiro/chuveiro-com-nascer-do-sol.jpg` → Vista, Banheiro, Amanhecer
- `solarium-2/spa/banheira-e-chuveiro-ao-nascer-do-sol.jpg` → Banheiro, Amanhecer
- `solarium-2/area-gourmet/brinde-no-pufe-do-deck.jpg` → Vista, Área gourmet
- `solarium-2/banheiro/bancada-com-vista-parque-itatiaia.jpg` → Vista, Banheiro
- `solarium-2/banheiro/cama-spa-e-box.jpg` → SPA, Banheiro
- `solarium-2/vista/telao-abrindo-ao-por-do-sol.jpg` → Vista, Cinema
- `solarium-2/quarto/quarto-com-telao-e-spa.jpg` → Quarto, Cinema
- `solarium-2/cozinha/preparando-pao-com-vista.jpg` → Vista, Cozinha
- `solarium-2/cozinha/cantinho-do-cafe-com-vista.jpg` → Vista, Cozinha
- `solarium-2/vista/quarto-e-spa-ao-por-do-sol.jpg` → Vista, SPA, Mais fotos
- `solarium-2/externa/ducha-e-pufe-no-deck.jpg` → Vista, Área externa
- `completo/casas-ao-por-do-sol.jpg` → As duas casas, Mais fotos

## Convertidos de HEIC/PNG

- `solarium-1/vista/vista-aerea-parque-itatiaia.jpg` (png)
- `solarium-1/amanhecer/vista-aerea-serra-do-papagaio.jpg` (png)
- `solarium-1/externa/vista-aerea-da-casa-ao-anoitecer.jpg` (png)
- `solarium-1/spa/spa-rede-e-quarto-vista-externa.jpg` (png)
- `solarium-2/banheiro/lavabo-com-janela-estreita.jpg` (heic)
- `solarium-2/cozinha/cozinha-com-mesa-e-vista.jpg` (heic)

## Baixa resolução

Aparecem na galeria; nunca são capa, mosaico ou Google.

- `solarium-1/area-gourmet/jantar-no-deck.jpg` — original 1199x1200
- `solarium-1/geral/rede-e-spa-no-por-do-sol.jpg` — original 1199x900
- `solarium-1/externa/amigos-no-deck-ao-por-do-sol.jpg` — original 768x1024
- `solarium-1/rede/rede-com-edredom-e-spa.jpg` — original 1199x900
- `solarium-1/rede/musica-na-rede.jpg` — original 1199x900
- `solarium-1/spa/hidromassagem-ao-por-do-sol.jpg` — original 1199x900
- `solarium-1/spa/spa-iluminado-a-noite.jpg` — original 1124x1124
- `solarium-1/spa/espuma-da-hidro-com-tacas.jpg` — original 1199x900
- `solarium-2/externa/ducha-e-pufe-no-deck.jpg` — original 720x1280
- `experiencias/cesta-de-cafe-na-mesa.jpg` — original 1076x1350

## Marca d'água "T"

- `solarium-1/rede/spa-e-rede-suspensa-vista-serra.jpg`
- `solarium-1/spa/reflexo-da-serra-na-agua-do-spa.jpg`
- `solarium-1/spa/spa-vidro-meio-aberto.jpg`
- `solarium-1/spa/spa-integrado-ao-quarto.jpg`
- `solarium-1/spa/spa-vidro-fechado-reflexo-por-do-sol.jpg`
- `solarium-1/quarto/quarto-com-lareira-acesa.jpg`
- `solarium-1/quarto/lareira-de-pedras-vulcanicas.jpg`
- `solarium-1/quarto/quarto-com-nascer-do-sol.jpg`
- `solarium-1/quarto/piso-aquecido-e-spa-vistos-do-quarto.jpg`
- `solarium-1/cozinha/cozinha-completa-com-vista.jpg`
- `solarium-1/cozinha/cozinha-com-vista-parque-itatiaia.jpg`
- `solarium-1/sala/mesa-posta-ao-nascer-do-sol.jpg`
- `solarium-1/cozinha/adega-tacas-e-cafeteira.jpg`
- `solarium-1/vista/cozinha-no-reflexo-do-nascer-do-sol.jpg`
- `solarium-1/area-gourmet/cafe-no-deck-com-vista.jpg`
- `solarium-1/externa/fire-pit-ao-entardecer.jpg`
- `solarium-1/externa/fachada-com-cachorro-no-gramado.jpg`
- `solarium-1/area-gourmet/fachada-com-palmeira.jpg`
- `solarium-1/area-gourmet/escada-e-deck-com-ombrelones.jpg`
- `solarium-1/vista/lateral-ao-por-do-sol.jpg`
- `solarium-1/banheiro-suite/bancada-e-toalhas-da-suite.jpg`
- `solarium-1/banheiro-social/lavatorio-social-e-cozinha.jpg`
- `solarium-1/banheiro-suite/banheiro-da-suite-com-roupoes.jpg`
- `solarium-1/externa/rede-e-spa-serra-fina.jpg`
- `solarium-1/vista/amanhecer-parque-itatiaia.jpg`
- `solarium-1/banheiro-social/chuveiro-do-banheiro-social.jpg`
- `experiencias/agulhas-negras-parque-itatiaia.jpg`
- `experiencias/maturacao-de-queijos.jpg`

## Tela com conteúdo (Netflix ou outra interface)

- `solarium-2/quarto/quarto-com-telao-e-spa.jpg`
- `solarium-2/quarto/cama-de-frente-para-o-telao.jpg`
- `solarium-2/quarto/quarto-amplo-com-closet.jpg`
- `solarium-2/cinema/sessao-de-cinema-a-noite.jpg`
- `solarium-2/vista/home-office-com-vista.jpg`
- `solarium-2/spa/telao-cama-e-spa.jpg`
- `solarium-2/vista/telao-abrindo-ao-por-do-sol.jpg`

## Capas

- solarium-1: `solarium-1/spa/spa-hidro-ligada-vista-serra-fina.jpg`
- solarium-2: `solarium-2/vista/quarto-e-spa-ao-por-do-sol.jpg`
- completo: `completo/casas-ao-por-do-sol.jpg`

## Google Perfil da Empresa — 25 fotos recomendadas

Cópias em 4:3, lado maior 1600px, em `galerias-processadas/gmb/` (subir à mão).

1. `solarium-1/spa/spa-hidro-ligada-vista-serra-fina.jpg` — **sugestão de capa**
2. `solarium-1/amanhecer/vista-aerea-serra-do-papagaio.jpg`
3. `solarium-1/amanhecer/mar-de-nuvens-ao-amanhecer.jpg`
4. `solarium-1/externa/casal-caminhando-no-deck.jpg`
5. `solarium-1/externa/vista-aerea-da-casa-ao-anoitecer.jpg`
6. `solarium-1/externa/fachada-iluminada-ao-anoitecer.jpg`
7. `solarium-1/quarto/quarto-cama-closet-e-janela.jpg`
8. `solarium-1/rede/rede-suspensa-com-almofadas.jpg`
9. `solarium-1/vista/spa-borda-infinita-serra-fina.jpg`
10. `solarium-1/vista/deck-com-vista-serra-fina.jpg`
11. `solarium-2/area-gourmet/deck-iluminado-a-noite.jpg`
12. `solarium-2/cinema/cinema-aberto-com-neblina.jpg`
13. `solarium-2/cozinha/cozinha-com-mesa-e-vista.jpg`
14. `solarium-2/cozinha/cozinha-completa-com-fondue.jpg`
15. `solarium-2/vista/quarto-e-spa-ao-por-do-sol.jpg`
16. `solarium-2/externa/fogueira-e-redario.jpg`
17. `solarium-2/externa/casa-vista-do-jardim-florido.jpg`
18. `solarium-2/externa/fachada-com-ceu-de-nuvens.jpg`
19. `solarium-2/vista/casal-no-pufe-ao-por-do-sol.jpg`
20. `completo/nevoeiro-abaixo-da-estrada.jpg`
21. `completo/fogueira-e-vista-do-solarium-1.jpg`
22. `completo/casas-ao-por-do-sol.jpg`
23. `completo/noite-com-lua-nas-duas-casas.jpg`
24. `completo/casas-diante-da-serra.jpg`
25. `completo/vista-norte-com-nevoa.jpg`
