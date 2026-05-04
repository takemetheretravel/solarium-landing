import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { MessageCircle, AlertCircle, ArrowLeft } from "lucide-react";
import Container from "@/components/ui/Container";
import Heading from "@/components/ui/Heading";
import Kicker from "@/components/ui/Kicker";
import { getDraft } from "@/lib/reservations-store";
import { SITE } from "@/config/site";
import { formatBRLPrecise } from "@/lib/cn";

export const metadata: Metadata = {
  title: "Reserva — Pagamento",
  description: "Sua reserva está pronta. Finalize pelo WhatsApp.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function fmtBR(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR");
}

function buildWhatsappMessage(d: ReturnType<typeof getDraft> & object): string {
  const lines = [
    "Olá! Quero finalizar minha reserva no Solarium Mantiqueira.",
    "",
    `Casa: ${d.propertyName}`,
    `Check-in: ${fmtBR(d.checkin)}`,
    `Check-out: ${fmtBR(d.checkout)}`,
    `Hóspedes: ${d.guests}`,
    `Total: ${formatBRLPrecise(d.totals.total)}`,
    `Método preferido: ${d.paymentMethod === "pix" ? "Pix" : "Cartão de Crédito"}`,
  ];
  if (d.couponCode) lines.push(`Cupom: ${d.couponCode}`);
  lines.push("", "Meus dados:");
  lines.push(`Nome: ${d.guest.name}`);
  lines.push(`E-mail: ${d.guest.email}`);
  lines.push(`CPF: ${d.guest.cpf}`);
  lines.push(`Telefone: ${d.guest.phone}`);
  if (d.guest.notes) {
    lines.push("", `Observações: ${d.guest.notes}`);
  }
  lines.push("", "Aguardo retorno para confirmar!");
  return lines.join("\n");
}

export default function PagamentoPage({ params }: { params: { draftId: string } }) {
  const draft = getDraft(params.draftId);
  if (!draft) notFound();

  const wppHref = `https://wa.me/${SITE.whatsappNumber}?text=${encodeURIComponent(
    buildWhatsappMessage(draft),
  )}`;

  return (
    <main className="bg-cream pt-32 pb-20">
      <Container size="narrow">
        <Link
          href="/"
          className="inline-flex items-center gap-2 font-sans text-xs uppercase tracking-[0.25em] text-charcoal/60 hover:text-copper"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar para a home
        </Link>

        <Kicker className="mt-8 mb-4">Reserva — etapa 2 de 2</Kicker>
        <Heading level={1} className="text-4xl sm:text-5xl">
          Sua reserva está pronta.
        </Heading>
        <p className="mt-4 font-sans text-base text-charcoal/70">
          O pagamento online (Pix e cartão) entra em operação em breve. Por enquanto,
          finalize comigo pelo WhatsApp — confirmamos rapidinho.
        </p>

        <div className="mt-8 flex items-start gap-4 border border-copper/40 bg-copper/10 p-5 font-sans text-sm">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-copper" />
          <div>
            <p className="font-medium text-charcoal">
              Pagamento direto pelo site em construção
            </p>
            <p className="mt-1 text-charcoal/75">
              Toque no botão verde abaixo e a mensagem já vai pronta com todos os
              detalhes da sua reserva. Mando o link de pagamento na hora.
            </p>
          </div>
        </div>

        <div className="mt-10 border border-charcoal/10 bg-white p-8">
          <Kicker className="mb-2">Resumo</Kicker>
          <h2 className="font-serif text-3xl text-charcoal">{draft.propertyName}</h2>

          <ul className="mt-6 space-y-3 border-y border-charcoal/10 py-5 font-sans text-sm">
            <li className="flex justify-between">
              <span className="text-charcoal/60">Check-in</span>
              <span className="text-charcoal">{fmtBR(draft.checkin)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-charcoal/60">Check-out</span>
              <span className="text-charcoal">{fmtBR(draft.checkout)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-charcoal/60">Noites</span>
              <span className="text-charcoal">{draft.totals.nights}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-charcoal/60">Hóspedes</span>
              <span className="text-charcoal">{draft.guests}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-charcoal/60">Forma de pagamento</span>
              <span className="text-charcoal">{draft.paymentMethod === "pix" ? "Pix" : "Cartão"}</span>
            </li>
            {draft.couponCode && (
              <li className="flex justify-between">
                <span className="text-charcoal/60">Cupom</span>
                <span className="text-charcoal">{draft.couponCode}</span>
              </li>
            )}
          </ul>

          <div className="mt-5 space-y-2 font-sans text-sm">
            <div className="flex justify-between text-charcoal/80">
              <span>Subtotal</span>
              <span>{formatBRLPrecise(draft.totals.subtotal)}</span>
            </div>
            {draft.totals.couponDiscount > 0 && (
              <div className="flex justify-between text-serra">
                <span>Cupom {draft.couponCode}</span>
                <span>− {formatBRLPrecise(draft.totals.couponDiscount)}</span>
              </div>
            )}
            {draft.totals.pixDiscount > 0 && (
              <div className="flex justify-between text-serra">
                <span>Desconto Pix (3%)</span>
                <span>− {formatBRLPrecise(draft.totals.pixDiscount)}</span>
              </div>
            )}
            <div className="mt-3 flex items-baseline justify-between border-t border-charcoal/10 pt-3 font-serif">
              <span className="text-base uppercase tracking-widest text-charcoal/70">Total</span>
              <span className="text-3xl text-charcoal">{formatBRLPrecise(draft.totals.total)}</span>
            </div>
          </div>

          <div className="mt-8 border-t border-charcoal/10 pt-6">
            <Kicker className="mb-3">Hóspede principal</Kicker>
            <p className="font-serif text-lg text-charcoal">{draft.guest.name}</p>
            <p className="mt-1 font-sans text-sm text-charcoal/70">
              {draft.guest.email} · {draft.guest.phone}
            </p>
          </div>
        </div>

        <a
          href={wppHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-10 flex w-full items-center justify-center gap-3 bg-[#25D366] py-5 font-sans text-sm uppercase tracking-[0.3em] text-white transition-all hover:opacity-90"
        >
          <MessageCircle className="h-5 w-5" /> Finalizar pelo WhatsApp
        </a>
        <p className="mt-3 text-center font-sans text-xs text-charcoal/50">
          {SITE.whatsappDisplay} · resposta em minutos
        </p>
      </Container>
    </main>
  );
}
