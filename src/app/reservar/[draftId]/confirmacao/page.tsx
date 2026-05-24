import { redirect } from "next/navigation";
import { Check } from "lucide-react";
import Container from "@/components/ui/Container";
import Heading from "@/components/ui/Heading";
import Kicker from "@/components/ui/Kicker";
import { getDraft } from "@/lib/kv-store";
import { formatBRLPrecise } from "@/lib/cn";
import { TrackPurchase } from "@/components/booking/TrackPurchase";

export const dynamic = "force-dynamic";

function formatBR(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export default async function ConfirmacaoPage({ params }: { params: { draftId: string } }) {
  const draft = await getDraft(params.draftId);
  if (!draft || draft.status !== "paid") redirect("/");

  const whatsappMsg = encodeURIComponent(
    `Olá! Acabei de confirmar minha reserva no ${draft.propertyName} de ${formatBR(draft.checkin)} a ${formatBR(draft.checkout)}. ID: ${params.draftId.slice(0, 8).toUpperCase()}`,
  );

  return (
    <main className="bg-cream pt-32 pb-20">
      <TrackPurchase total={draft.finalTotal} draftId={params.draftId} />
      <Container>
        <div className="mx-auto max-w-2xl">
          <div className="mx-auto mb-8 flex h-16 w-16 items-center justify-center rounded-full bg-serra/10">
            <Check className="h-8 w-8 text-serra" />
          </div>

          <div className="mb-12 text-center">
            <Kicker className="mb-4">Reserva confirmada</Kicker>
            <Heading level={1} className="text-4xl">Sua reserva está feita!</Heading>
            <p className="mx-auto mt-4 max-w-md font-sans text-charcoal/70">
              Em breve você receberá um e-mail de confirmação com todos os detalhes da sua estadia no Solarium Mantiqueira.
            </p>
          </div>

          <div className="mb-8 border border-charcoal/10 bg-white p-8">
            <h2 className="mb-6 font-serif text-2xl text-charcoal">{draft.propertyName}</h2>
            <ul className="space-y-3 font-sans text-sm">
              <li className="flex justify-between">
                <span className="text-charcoal/60">Check-in</span>
                <span className="text-charcoal">{formatBR(draft.checkin)} às 15h</span>
              </li>
              <li className="flex justify-between">
                <span className="text-charcoal/60">Check-out</span>
                <span className="text-charcoal">{formatBR(draft.checkout)} às 11h</span>
              </li>
              <li className="flex justify-between">
                <span className="text-charcoal/60">Hóspedes</span>
                <span className="text-charcoal">{draft.guests}</span>
              </li>
              <li className="flex justify-between border-t border-charcoal/10 pt-4 font-serif text-xl">
                <span className="text-charcoal">Total pago</span>
                <span className="text-charcoal">{formatBRLPrecise(draft.finalTotal)}</span>
              </li>
            </ul>
          </div>

          <div className="mb-10">
            <h3 className="mb-4 font-serif text-xl text-charcoal">O que acontece agora</h3>
            <ul className="space-y-3 font-sans text-sm text-charcoal/70">
              <li className="flex items-start gap-3">
                <span className="mt-0.5 text-copper">→</span>
                <span>Você receberá um e-mail de confirmação com os detalhes completos</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 text-copper">→</span>
                <span>Enviaremos um guia completo da casa e instruções de acesso antes do check-in</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 text-copper">→</span>
                <span>Nosso concierge entrará em contato pelo WhatsApp para personalizar sua experiência</span>
              </li>
            </ul>
          </div>

          <div className="text-center">
            <a
              href={`https://wa.me/5535984075652?text=${whatsappMsg}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-[#25D366] px-8 py-4 font-sans text-sm uppercase tracking-widest text-white transition-colors hover:bg-[#20BA5C]"
            >
              Falar com o concierge
            </a>
            <p className="mt-4 font-sans text-xs text-charcoal/40">
              ID da reserva: {params.draftId.slice(0, 8).toUpperCase()}
            </p>
          </div>
        </div>
      </Container>
    </main>
  );
}
