"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, Expand } from "lucide-react";
import SmartImage from "@/components/ui/SmartImage";
import { cn } from "@/lib/cn";
import type { Ambiente, Foto } from "@/config/galeria";
import {
  AMBIENTE_ROTULO,
  ambientesDisponiveis,
  estadoInicialDoDeepLink,
  filtrarPorAmbiente,
  fotosDoMosaico,
  indiceDaFoto,
  ordenarFotos,
  vizinhas,
} from "@/lib/galeria/consulta";
import {
  pushGalleryFilterAmbiente,
  pushGalleryOpen,
  pushGalleryPhotoView,
} from "@/lib/analytics/dataLayer";

type Props = {
  casa: string;
  fotos: Foto[];
  compacto: boolean;
  origem: string;
};

/** Larguras renderizadas de verdade, por breakpoint. Ver DECISOES.md. */
const SIZES_MOSAICO_GRANDE = "(max-width: 768px) 100vw, (max-width: 1280px) 55vw, 620px";
const SIZES_MOSAICO_PEQUENA = "(max-width: 768px) 50vw, (max-width: 1280px) 27vw, 310px";
const SIZES_FAIXA = "(max-width: 768px) 45vw, (max-width: 1280px) 22vw, 240px";
const SIZES_LIGHTBOX = "(max-width: 1280px) 92vw, 1200px";

export default function GaleriaClient({ casa, fotos, compacto, origem }: Props) {
  const todas = useMemo(() => ordenarFotos(fotos), [fotos]);
  const [ambiente, setAmbiente] = useState<Ambiente | null>(null);
  const [indice, setIndice] = useState<number | null>(null);

  const visiveis = useMemo(() => filtrarPorAmbiente(todas, ambiente), [todas, ambiente]);
  const mosaico = useMemo(() => fotosDoMosaico(todas, 5), [todas]);
  const ambientes = useMemo(() => ambientesDisponiveis(todas), [todas]);

  const aberta = indice === null ? null : (visiveis[indice] ?? null);

  // O deep-link só é lido uma vez, na montagem. Depois disso quem manda na URL
  // é a própria lightbox, e reler criaria um laço entre estado e history.
  const deepLinkLido = useRef(false);
  useEffect(() => {
    if (deepLinkLido.current) return;
    deepLinkLido.current = true;
    const id = new URLSearchParams(window.location.search).get("foto");
    const inicial = estadoInicialDoDeepLink(todas, id);
    if (!inicial) return;
    setAmbiente(inicial.ambiente);
    setIndice(inicial.indice);
    pushGalleryOpen({ casa, totalFotos: todas.length, origem: "deep-link" });
  }, [todas, casa]);

  /**
   * `replaceState`, nunca `router.push`: navegar pelo Next re-renderizaria a
   * rota inteira a cada seta da lightbox. Aqui a URL é só um marcador
   * compartilhável — o histórico do browser não deve encher de uma entrada por
   * foto, e o botão "voltar" tem que sair da galeria, não andar foto a foto.
   */
  const sincronizarUrl = useCallback((foto: Foto | null) => {
    const url = new URL(window.location.href);
    if (foto) url.searchParams.set("foto", foto.id);
    else url.searchParams.delete("foto");
    window.history.replaceState(window.history.state, "", url.toString());
  }, []);

  useEffect(() => {
    if (!deepLinkLido.current) return;
    sincronizarUrl(aberta);
  }, [aberta, sincronizarUrl]);

  // Um push por foto efetivamente exibida, inclusive as alcançadas por seta.
  useEffect(() => {
    if (!aberta || indice === null) return;
    pushGalleryPhotoView({
      casa,
      fotoId: aberta.id,
      ambiente: aberta.ambiente,
      posicao: indice + 1,
    });
  }, [aberta, indice, casa]);

  const fechar = useCallback(() => setIndice(null), []);
  const anterior = useCallback(
    () => setIndice((i) => (i === null ? null : vizinhas(visiveis.length, i).anterior)),
    [visiveis.length],
  );
  const proxima = useCallback(
    () => setIndice((i) => (i === null ? null : vizinhas(visiveis.length, i).proxima)),
    [visiveis.length],
  );

  const abrirPeloId = useCallback(
    (id: string, deOnde: string) => {
      const posicao = indiceDaFoto(visiveis, id);
      if (posicao < 0) return;
      setIndice(posicao);
      pushGalleryOpen({ casa, totalFotos: todas.length, origem: deOnde });
    },
    [visiveis, casa, todas.length],
  );

  /**
   * Trocar de filtro com a lightbox aberta mantém a foto atual se ela
   * sobreviveu ao filtro. Saltar para a primeira do novo conjunto perderia o
   * lugar de quem só quis estreitar a busca.
   */
  const trocarAmbiente = useCallback(
    (novo: Ambiente | null) => {
      const fotoAtual = aberta;
      const novasVisiveis = filtrarPorAmbiente(todas, novo);
      setAmbiente(novo);
      pushGalleryFilterAmbiente({ casa, ambiente: novo, resultados: novasVisiveis.length });
      if (fotoAtual) {
        const posicao = indiceDaFoto(novasVisiveis, fotoAtual.id);
        setIndice(posicao >= 0 ? posicao : 0);
      }
    },
    [aberta, todas, casa],
  );

  useEffect(() => {
    if (indice === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") fechar();
      if (e.key === "ArrowLeft") anterior();
      if (e.key === "ArrowRight") proxima();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [indice, fechar, anterior, proxima]);

  // Swipe. Limiar de 50px e trava no eixo vertical para não roubar o gesto de
  // rolagem de quem só está passando o dedo pela tela.
  const toque = useRef<{ x: number; y: number } | null>(null);
  const aoTocar = (e: React.TouchEvent) => {
    const t = e.touches[0];
    toque.current = { x: t.clientX, y: t.clientY };
  };
  const aoSoltar = (e: React.TouchEvent) => {
    if (!toque.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - toque.current.x;
    const dy = t.clientY - toque.current.y;
    toque.current = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) proxima();
    else anterior();
  };

  const paraPreload = useMemo(() => {
    if (indice === null || visiveis.length < 2) return [];
    const { anterior: a, proxima: p } = vizinhas(visiveis.length, indice);
    return [visiveis[a], visiveis[p]].filter((f): f is Foto => Boolean(f) && f !== aberta);
  }, [indice, visiveis, aberta]);

  const total = todas.length;

  return (
    <>
      {compacto ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {mosaico.map((foto) => (
            <button
              key={foto.id}
              type="button"
              onClick={() => abrirPeloId(foto.id, origem)}
              className="group relative aspect-square overflow-hidden bg-charcoal/5"
              aria-label={`Abrir galeria em: ${foto.alt}`}
            >
              <SmartImage
                src={foto.publicId}
                alt={foto.alt}
                sizes={SIZES_FAIXA}
                blurDataURL={foto.blurDataURL}
                className="transition-transform duration-500 group-hover:scale-[1.04]"
              />
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4 md:grid-rows-2">
            {mosaico.map((foto, i) => (
              <button
                key={foto.id}
                type="button"
                onClick={() => abrirPeloId(foto.id, origem)}
                className={cn(
                  "group relative overflow-hidden bg-charcoal/5",
                  i === 0
                    ? "col-span-2 row-span-2 aspect-[4/3] md:aspect-auto"
                    : "aspect-[4/3]",
                )}
                aria-label={`Abrir galeria em: ${foto.alt}`}
              >
                <SmartImage
                  src={foto.publicId}
                  alt={foto.alt}
                  sizes={i === 0 ? SIZES_MOSAICO_GRANDE : SIZES_MOSAICO_PEQUENA}
                  blurDataURL={foto.blurDataURL}
                  className="transition-transform duration-500 group-hover:scale-[1.03]"
                />
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => abrirPeloId(visiveis[0]?.id ?? "", "botao-ver-todas")}
            className="mt-5 inline-flex items-center gap-2 border border-charcoal/25 bg-cream px-7 py-3.5 font-sans text-xs uppercase tracking-[0.25em] text-charcoal transition-colors hover:border-copper hover:text-copper"
          >
            <Expand className="h-4 w-4" strokeWidth={1.5} />
            Ver todas as fotos ({total})
          </button>
        </>
      )}

      {aberta && indice !== null && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-charcoal/97"
          role="dialog"
          aria-modal="true"
          aria-label={`Galeria ${casa}`}
          onTouchStart={aoTocar}
          onTouchEnd={aoSoltar}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-8">
            <div className="flex flex-wrap gap-2">
              <FiltroBotao
                ativo={ambiente === null}
                onClick={() => trocarAmbiente(null)}
                rotulo={`Todas (${todas.length})`}
              />
              {ambientes.map((a) => (
                <FiltroBotao
                  key={a}
                  ativo={ambiente === a}
                  onClick={() => trocarAmbiente(a)}
                  rotulo={AMBIENTE_ROTULO[a]}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={fechar}
              aria-label="Fechar galeria"
              className="text-cream transition-colors hover:text-copper"
            >
              <X className="h-7 w-7" strokeWidth={1.5} />
            </button>
          </div>

          <div className="relative flex flex-1 items-center justify-center px-4 pb-4">
            <button
              type="button"
              onClick={anterior}
              aria-label="Foto anterior"
              className="absolute left-2 z-10 text-cream transition-colors hover:text-copper sm:left-6"
            >
              <ChevronLeft className="h-9 w-9 sm:h-11 sm:w-11" strokeWidth={1.25} />
            </button>

            <figure className="relative flex h-full w-full max-w-6xl flex-col items-center justify-center">
              <div className="relative h-full w-full">
                <SmartImage
                  key={aberta.id}
                  src={aberta.publicId}
                  alt={aberta.alt}
                  sizes={SIZES_LIGHTBOX}
                  blurDataURL={aberta.blurDataURL}
                  className="object-contain"
                />
              </div>
              <figcaption className="mt-3 max-w-2xl text-center font-sans text-sm leading-relaxed text-cream/70">
                {aberta.alt}
              </figcaption>
            </figure>

            <button
              type="button"
              onClick={proxima}
              aria-label="Próxima foto"
              className="absolute right-2 z-10 text-cream transition-colors hover:text-copper sm:right-6"
            >
              <ChevronRight className="h-9 w-9 sm:h-11 sm:w-11" strokeWidth={1.25} />
            </button>
          </div>

          <div className="pb-5 text-center font-sans text-xs uppercase tracking-[0.3em] text-cream/60">
            {indice + 1} / {visiveis.length}
            {ambiente && <span className="ml-2 normal-case tracking-normal text-cream/40">· {AMBIENTE_ROTULO[ambiente]}</span>}
          </div>

          {/*
            Preload da anterior e da próxima. Fora da árvore visível e com
            `aria-hidden`: o leitor de tela não deve anunciar duas fotos que
            ninguém está vendo, e a seta seguinte chega instantânea.
          */}
          <div className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0" aria-hidden>
            {paraPreload.map((foto) => (
              <SmartImage key={foto.id} src={foto.publicId} alt="" sizes={SIZES_LIGHTBOX} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function FiltroBotao({
  ativo,
  onClick,
  rotulo,
}: {
  ativo: boolean;
  onClick: () => void;
  rotulo: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "border px-3.5 py-1.5 font-sans text-[0.65rem] uppercase tracking-[0.2em] transition-colors",
        ativo
          ? "border-copper bg-copper text-cream"
          : "border-cream/25 text-cream/70 hover:border-cream/60 hover:text-cream",
      )}
    >
      {rotulo}
    </button>
  );
}
