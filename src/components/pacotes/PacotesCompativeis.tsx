import { ArrowRight } from "lucide-react";
import { formatBRL } from "@/lib/cn";
import { pacotesVisiveis, datasElegiveis, motorDoPacote } from "@/lib/pricing/elegibilidade";
import { calcularPacoteServer } from "@/lib/pricing/pacote-server";
import { getPropertyBySlug } from "@/config/properties";
import { vistaPacote } from "@/lib/pricing/vista-pacote";
import { pacotesV2Ativo } from "@/config/flags";
import TrackPacoteSugerido, { LinkPacoteSugerido } from "./TrackPacoteSugerido";

/**
 * Pacotes para as datas que a pessoa acabou de buscar.
 *
 * Duas situações, na mesma fonte de elegibilidade e no mesmo motor de preço da
 * página do pacote:
 *
 *  - as datas fecham um pacote: mostra com o preço real;
 *  - não fecham nenhum: procura pacotes a até duas noites de distância e mostra
 *    o deslocamento em palavras. Nunca trocar a data em silêncio.
 *
 * Nada compatível e nada por perto, o bloco não aparece.
 */
export default async function PacotesCompativeis({
  checkin,
  checkout,
  guests,
  variante = "abaixo",
}: {
  checkin: string;
  checkout: string;
  guests: number;
  /** "acima" = nenhuma casa livre nestas datas; o bloco vira o conteúdo principal. */
  variante?: "abaixo" | "acima";
}) {
  if (!pacotesV2Ativo()) return null;

  const hoje = new Date().toISOString().slice(0, 10);

  const exatos = await pacotesNasDatas(checkin, checkout, guests, hoje);
  const proximos = exatos.length > 0 ? [] : await pacotesEmDatasProximas(checkin, checkout, guests, hoje);

  if (exatos.length === 0 && proximos.length === 0) return null;

  const titulo =
    exatos.length > 0
      ? variante === "acima"
        ? "As casas estão ocupadas, mas estas datas fecham um pacote"
        : "Estas datas também fecham um pacote"
      : variante === "acima"
        ? "Nestas datas as casas estão ocupadas — há pacote em datas vizinhas"
        : "Datas vizinhas fecham um pacote";

  const cards = exatos.length > 0 ? exatos : proximos;

  return (
    <section
      className={
        variante === "acima"
          ? "mb-16 border-b border-charcoal/10 pb-10"
          : "mt-16 border-t border-charcoal/10 pt-10"
      }
    >
      <TrackPacoteSugerido
        ids={cards.map((c) => c.slug)}
        deslocamentos={cards.map((c) => c.deslocamento)}
      />

      <h2 className="font-serif text-2xl text-charcoal">{titulo}</h2>
      <p className="mt-2 font-sans text-sm leading-relaxed text-charcoal/70">
        {exatos.length > 0
          ? "Mesmas noites, com os itens que a maioria dos hóspedes acaba pedindo já organizados."
          : "Datas diferentes das que você pediu — o deslocamento está dito em cada card."}
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((p) => (
          <LinkPacoteSugerido
            key={`${p.slug}-${p.checkin}`}
            pacoteId={p.slug}
            deslocamento={p.deslocamento}
            // A casa vai no link: o preço exibido é o DESTA casa, e sem o
            // parâmetro a página do pacote abriria na casa padrão — que pode
            // estar justamente ocupada nestas datas.
            href={`/pacotes/${p.slug}?checkin=${p.checkin}&checkout=${p.checkout}&casa=${p.casaSlug}&guests=${guests}`}
            className="group flex flex-col border border-charcoal/10 bg-white p-5 transition-all duration-300 hover:-translate-y-0.5"
          >
            <span className="font-sans text-[0.6rem] uppercase tracking-[0.25em] text-copper">
              {p.casa}
            </span>
            <h3 className="mt-2 font-serif text-xl text-charcoal">{p.nome}</h3>

            {p.deslocamento > 0 && (
              <p className="mt-2 font-sans text-xs leading-relaxed text-charcoal">
                {frase(p)}
              </p>
            )}
            <p className="mt-2 flex-1 font-sans text-xs leading-relaxed text-charcoal/60">
              {p.deslocamento > 0 ? `Com ${p.inclusos}.` : p.tagline}
            </p>

            <p className="mt-4 font-serif text-2xl text-charcoal">{formatBRL(p.total)}</p>
            {p.economia > 0 && (
              <p className="mt-1 font-sans text-xs text-serra">
                {formatBRL(p.economia)} a menos que contratando cada item à parte
              </p>
            )}

            <span className="mt-4 inline-flex items-center gap-1.5 font-sans text-xs uppercase tracking-[0.25em] text-copper transition-colors group-hover:text-charcoal">
              Ver pacote <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </LinkPacoteSugerido>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// BUSCA
// ---------------------------------------------------------------------------

type Sugestao = {
  slug: string;
  nome: string;
  tagline: string;
  casa: string;
  casaSlug: string;
  checkin: string;
  checkout: string;
  /** Noites de diferença entre o pedido e o oferecido. 0 = datas exatas. */
  deslocamento: number;
  diasChegada: number;
  diasSaida: number;
  inclusos: string;
  total: number;
  economia: number;
};

/** Pacotes que fecham EXATAMENTE nas datas pedidas, um por pacote. */
async function pacotesNasDatas(
  checkin: string,
  checkout: string,
  guests: number,
  hoje: string,
): Promise<Sugestao[]> {
  const achados = await Promise.all(
    pacotesVisiveis(hoje).map(async (slug) => {
      for (const casa of casasDoPacote(slug)) {
        if (!datasElegiveis(slug, casa, checkin, checkout).elegivel) continue;
        const s = await cotar(slug, casa, checkin, checkout, guests, 0, 0);
        if (s) return s;
      }
      return null;
    }),
  );
  return achados.filter((s): s is Sugestao => s !== null);
}

/** Distância máxima, em noites, entre as datas pedidas e as oferecidas. */
const DESLOCAMENTO_MAXIMO = 2;
/** Teto de cotações na busca por datas vizinhas — cada uma é ida à Hostaway. */
const MAX_COTACOES = 12;

/**
 * Pacotes a até duas noites das datas pedidas, deslocando chegada, saída ou as
 * duas. No máximo duas sugestões, da menor distância para a maior.
 */
async function pacotesEmDatasProximas(
  checkin: string,
  checkout: string,
  guests: number,
  hoje: string,
): Promise<Sugestao[]> {
  type Candidato = {
    slug: string;
    casa: string;
    checkin: string;
    checkout: string;
    dCheckin: number;
    dCheckout: number;
  };

  const candidatos: Candidato[] = [];

  for (const slug of pacotesVisiveis(hoje)) {
    for (const casa of casasDoPacote(slug)) {
      for (let dCheckin = -DESLOCAMENTO_MAXIMO; dCheckin <= DESLOCAMENTO_MAXIMO; dCheckin++) {
        for (let dCheckout = -DESLOCAMENTO_MAXIMO; dCheckout <= DESLOCAMENTO_MAXIMO; dCheckout++) {
          const distancia = Math.abs(dCheckin) + Math.abs(dCheckout);
          if (distancia === 0 || distancia > DESLOCAMENTO_MAXIMO) continue;

          const ci = somaDias(checkin, dCheckin);
          const co = somaDias(checkout, dCheckout);
          if (ci < hoje) continue;
          if (!datasElegiveis(slug, casa, ci, co).elegivel) continue;

          candidatos.push({ slug, casa, checkin: ci, checkout: co, dCheckin, dCheckout });
        }
      }
    }
  }

  // Menor deslocamento primeiro: a sugestão mais próxima do que a pessoa pediu.
  candidatos.sort(
    (a, b) =>
      Math.abs(a.dCheckin) + Math.abs(a.dCheckout) - (Math.abs(b.dCheckin) + Math.abs(b.dCheckout)),
  );

  const sugestoes: Sugestao[] = [];
  const jaVistos = new Set<string>();
  let cotacoes = 0;

  for (const c of candidatos) {
    if (sugestoes.length >= 2 || cotacoes >= MAX_COTACOES) break;
    if (jaVistos.has(c.slug)) continue;

    cotacoes++;
    const s = await cotar(c.slug, c.casa, c.checkin, c.checkout, guests, c.dCheckin, c.dCheckout);
    if (!s) continue;

    jaVistos.add(c.slug);
    sugestoes.push(s);
  }

  return sugestoes;
}

function casasDoPacote(slug: string): string[] {
  const m = motorDoPacote(slug);
  return m?.motor === "v2" ? m.pacote.properties : [];
}

/** Uma cotação real. `null` quando a casa não está livre ou o preço não sai. */
async function cotar(
  slug: string,
  casaSlug: string,
  checkin: string,
  checkout: string,
  guests: number,
  dCheckin: number,
  dCheckout: number,
): Promise<Sugestao | null> {
  const m = motorDoPacote(slug);
  if (!m || m.motor !== "v2") return null;

  const property = getPropertyBySlug(casaSlug);
  const vista = vistaPacote(slug, true);
  if (!property || !vista) return null;

  const calc = await calcularPacoteServer({
    pacote: m.pacote,
    propertySlug: casaSlug,
    propertyId: property.id,
    checkin,
    checkout,
    guests: Math.max(guests, m.pacote.hospedesMin ?? guests),
    removidos: [],
    selecao: {},
  });
  // `calc.ok` já implica casa disponível: o preço vem do calendário.
  if (!calc.ok) return null;

  return {
    slug,
    nome: vista.nome,
    tagline: vista.tagline,
    casa: property.name,
    casaSlug,
    checkin,
    checkout,
    deslocamento: Math.abs(dCheckin) + Math.abs(dCheckout),
    diasChegada: dCheckin,
    diasSaida: dCheckout,
    // Nome do item como ele é vendido, sem minusculizar: "cesta café café" não é
    // o nome de nada.
    inclusos: calc.resultado.itens
      .filter((i) => i.incluso)
      .map((i) => i.nome)
      .join(" e "),
    total: calc.resultado.total,
    economia: calc.resultado.economia,
  };
}

// ---------------------------------------------------------------------------
// COPY
// ---------------------------------------------------------------------------

/** "Chegando um dia antes, 4 a 7 de setembro, estas datas fecham o pacote." */
function frase(s: Sugestao): string {
  const partes: string[] = [];
  if (s.diasChegada !== 0) partes.push(`Chegando ${quantosDias(s.diasChegada)}`);
  if (s.diasSaida !== 0) partes.push(`${partes.length ? "saindo" : "Saindo"} ${quantosDias(s.diasSaida)}`);
  return `${partes.join(" e ")}, ${intervalo(s.checkin, s.checkout)}, estas datas fecham o ${s.nome}.`;
}

function quantosDias(d: number): string {
  const n = Math.abs(d) === 1 ? "um dia" : `${Math.abs(d)} dias`;
  return d < 0 ? `${n} antes` : `${n} depois`;
}

/** "4 a 7 de setembro" no mesmo mês; "30 de setembro a 2 de outubro" quando vira. */
function intervalo(checkin: string, checkout: string): string {
  const a = new Date(checkin + "T12:00:00");
  const b = new Date(checkout + "T12:00:00");
  const mes = (d: Date) => d.toLocaleDateString("pt-BR", { month: "long" });
  if (a.getMonth() === b.getMonth()) {
    return `${a.getDate()} a ${b.getDate()} de ${mes(b)}`;
  }
  return `${a.getDate()} de ${mes(a)} a ${b.getDate()} de ${mes(b)}`;
}

function somaDias(iso: string, dias: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
