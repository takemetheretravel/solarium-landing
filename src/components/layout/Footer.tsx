import Link from "next/link";
import { AtSign } from "lucide-react";
import Container from "@/components/ui/Container";
import Kicker from "@/components/ui/Kicker";
import { SITE, instagramLink, whatsappLink } from "@/config/site";

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer id="contato" className="border-t border-charcoal/10 bg-cream pt-20 pb-10">
      <Container>
        <div className="grid gap-12 md:grid-cols-4">
          <div className="md:col-span-1">
            <span className="font-serif text-xl tracking-[0.3em] text-charcoal">SOLARIUM</span>
            <p className="mt-4 font-sans text-sm leading-relaxed text-charcoal/70">
              Refúgio de design e experiência na Serra da Mantiqueira.
            </p>
            <a
              href={instagramLink(SITE.instagram)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex items-center gap-2 text-charcoal/70 transition-colors hover:text-copper"
              aria-label="Instagram"
            >
              <AtSign className="h-4 w-4" />
              <span className="font-sans text-xs uppercase tracking-[0.2em]">@{SITE.instagram}</span>
            </a>
          </div>

          <div>
            <Kicker tone="charcoal">Casas</Kicker>
            <ul className="mt-5 space-y-3 font-sans text-sm">
              <li><Link href="/solarium-1" className="text-charcoal/80 hover:text-copper">Solarium 1</Link></li>
              <li><Link href="/solarium-2" className="text-charcoal/80 hover:text-copper">Solarium 2</Link></li>
              <li><Link href="/solarium-completo" className="text-charcoal/80 hover:text-copper">Solarium Completo</Link></li>
              <li><Link href="/experiencias" className="text-charcoal/80 hover:text-copper">Experiências</Link></li>
              <li><Link href="/parceiros" className="text-charcoal/80 hover:text-copper">Parceiros</Link></li>
            </ul>
          </div>

          <div>
            <Kicker tone="charcoal">Políticas</Kicker>
            <ul className="mt-5 space-y-3 font-sans text-sm">
              <li><Link href="/termos" className="text-charcoal/80 hover:text-copper">Termos e Condições</Link></li>
              <li><Link href="/privacidade" className="text-charcoal/80 hover:text-copper">Política de Privacidade</Link></li>
              <li><Link href="/termos#cancelamento" className="text-charcoal/80 hover:text-copper">Política de Cancelamento</Link></li>
            </ul>
          </div>

          <div>
            <Kicker tone="charcoal">Contato</Kicker>
            <ul className="mt-5 space-y-3 font-sans text-sm">
              <li>
                <a
                  href={whatsappLink("Olá! Gostaria de saber mais sobre o Solarium Mantiqueira.")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-charcoal/80 hover:text-copper"
                >
                  WhatsApp {SITE.whatsappDisplay}
                </a>
              </li>
              <li className="pt-2 text-charcoal/60">{SITE.region}</li>
            </ul>
          </div>
        </div>

        <div className="mt-16 border-t border-charcoal/10 pt-6 text-center font-sans text-xs text-charcoal/60">
          © {year} {SITE.name} · CNPJ {SITE.cnpj} · {SITE.legalName}
        </div>
      </Container>
    </footer>
  );
}
