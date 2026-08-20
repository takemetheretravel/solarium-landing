import { ArrowRight } from "lucide-react";
import { formatBRL } from "@/lib/cn";
import { pacotesVisiveis, datasElegiveis, motorDoPacote } from "@/lib/pricing/elegibilidade";
import { calcularPacoteServer } from "@/lib/pricing/pacote-server";
import { getPropertyBySlug } from "@/config/properties";
import { vistaPacote } from "@/lib/pricing/vista-pacote";
import { pacotesV2Ativo } from "@/config/flags";
import TrackPacoteSugerido, { LinkPacoteSugerido } from "./TrackPacoteSugerido";

/**
 * Pacotes que fecham EXATAMENTE nas datas que a pessoa acabou de buscar.
 *
 * Mesma função de elegibilidade e mesmo motor de preço da página do pacote —
 * nenhum caminho novo de cálculo. Como as datas são conhecidas, exibe o preço
 * real, não "a partir de".
 *
 * Subordinado aos cards de casa: bloco abaixo, título curto, sem virar um quarto
 * card. Nenhum pacote compatível, o bloco não aparece.
 */
export default async function PacotesCompativeis({
  checkin,
  checkout,
  guests,
}: {
  checkin: string;
  checkout: string;
  guests: number;
}) {
  if (!pacotesV2Ativo()) return null;

  const hoje = new Date().toISOString().slice(0, 10);

  const candidatos = await Promise.all(
    pacotesVisiveis(hoje).map(async (slug) => {
      const m = motorDoPacote(slug);
      // O motor legado não expõe linhas nem economia; fora deste bloco.
      if (!m || m.motor !== "v2") return null;

      for (const casaSlug of m.pacote.properties) {
        if (!datasElegiveis(slug, casaSlug, checkin, checkout).elegivel) continue;

        const property = getPropertyBySlug(casaSlug);
        if (!property) continue;

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
        if (!calc.ok) continue;

        const vista = vistaPacote(slug, true);
        if (!vista) continue;

        return {
          slug,
          nome: vista.nome,
          tagline: vista.tagline,
          casa: property.name,
          casaSlug: property.slug,
          total: calc.resultado.total,
          economia: calc.resultado.economia,
        };
      }
      return null;
    }),
  );

  const compativeis = candidatos.filter((c): c is NonNullable<typeof c> => c !== null);
  if (compativeis.length === 0) return null;

  return (
    <section className="mt-16 border-t border-charcoal/10 pt-10">
      <TrackPacoteSugerido ids={compativeis.map((c) => c.slug)} />

      <h2 className="font-serif text-2xl text-charcoal">Estas datas também fecham um pacote</h2>
      <p className="mt-2 font-sans text-sm leading-relaxed text-charcoal/70">
        Mesmas noites, com os itens que a maioria dos hóspedes acaba pedindo já organizados.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {compativeis.map((p) => (
          <LinkPacoteSugerido
            key={p.slug}
            pacoteId={p.slug}
            // A casa vai no link: o preço exibido é o DESTA casa, e sem o
            // parâmetro a página do pacote abriria na casa padrão — que pode
            // estar justamente ocupada nestas datas.
            href={`/pacotes/${p.slug}?checkin=${checkin}&checkout=${checkout}&casa=${p.casaSlug}&guests=${guests}`}
            className="group flex flex-col border border-charcoal/10 bg-white p-5 transition-all duration-300 hover:-translate-y-0.5"
          >
            <span className="font-sans text-[0.6rem] uppercase tracking-[0.25em] text-copper">
              {p.casa}
            </span>
            <h3 className="mt-2 font-serif text-xl text-charcoal">{p.nome}</h3>
            <p className="mt-2 flex-1 font-sans text-xs leading-relaxed text-charcoal/60">
              {p.tagline}
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
