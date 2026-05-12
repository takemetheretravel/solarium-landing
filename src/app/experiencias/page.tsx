import { Metadata } from "next";
import { ArrowRight, MessageCircle, MapPin, Mountain, Compass, Coffee } from "lucide-react";
import Container from "@/components/ui/Container";
import Section from "@/components/ui/Section";
import Heading from "@/components/ui/Heading";
import Kicker from "@/components/ui/Kicker";
import SmartImage from "@/components/ui/SmartImage";
import { whatsappLink } from "@/config/site";

export const metadata: Metadata = {
  title: "Experiências",
  description:
    "Da cesta de café com produtores locais às cachoeiras da Serra da Mantiqueira — curadoria completa de experiências no Solarium e na região.",
};

type ExperienceCard = { title: string; distance?: string; description: string };

const ADVENTURE: ExperienceCard[] = [
  { title: "Quadriciclo no Rancho Estância Casa Nova", distance: "5 min", description: "Trilhas, cachoeiras e pontos turísticos de 4x4 pelos arredores." },
  { title: "Cavalgadas no Rancho Estância Casa Nova", distance: "5 min", description: "Cavalos bem tratados, guia experiente, paisagens únicas." },
  { title: "Toca do Lobo Adventure", distance: "40 min", description: "Rotas alternativas e trilhas mais técnicas a partir de Passa Quatro." },
  { title: "Passeios de Bike", description: "Roteiros adaptados ao seu nível físico — do bate-volta ao trail." },
];

const NATURE: ExperienceCard[] = [
  { title: "Ivos Hostel", distance: "25 min", description: "Trilhas e cachoeiras de águas cristalinas num vale preservado." },
  { title: "Poço Paraíso", distance: "35 min", description: "Águas cristalinas — trilha íngreme, recompensa incomparável." },
  { title: "Poço da Encruza", distance: "45 min", description: "Banho refrescante e almoço no Rancho do Zé logo após." },
  { title: "Cachoeira do Andorinhão", distance: "45 min", description: "Poço largo para nadar, água gelada o ano inteiro." },
  { title: "Laurinho — Restaurante e Balneário", distance: "15 min", description: "Fácil acesso, ótimo restaurante, poço sombreado." },
  { title: "Instituto Alta Montanha", distance: "20 min", description: "Day use, cachoeira e contemplação em ambiente cuidado." },
];

const TRAILS: ExperienceCard[] = [
  { title: "Volta dos 80", description: "Passeio panorâmico de carro pela estrada de terra — imperdível ao pôr do sol." },
  { title: "Parque Nacional do Itatiaia", distance: "60 min", description: "Caminhadas de altitude e mirantes com vista para o pico mais alto do Brasil." },
  { title: "Cachoeira da Gomeira", distance: "60 min", description: "Visual impressionante, trilha curta — ótima opção para a tarde." },
  { title: "Capim Amarelo", distance: "1h30", description: "Ponto de início da travessia da Serra Fina — para quem busca o extremo." },
];

const GASTRONOMY: ExperienceCard[] = [
  { title: "Pérola da Serra", distance: "5 min", description: "Produção 100% de búfala com visitação — fica literalmente ao lado." },
  { title: "Di Capre", distance: "25 min", description: "Queijos de cabra e visita ao rebanho. Experiência inesquecível." },
  { title: "Queijaria 50", distance: "30 min", description: "Visitação com agendamento, produção artesanal premiada." },
  { title: "Almeida Guimarães", distance: "20 min", description: "Queijos de vaca e café à frente da rodovia — parada obrigatória." },
  { title: "Laticínios Ecila", distance: "20 min", description: "Laticínio tradicional com ampla variedade de produtos frescos." },
  { title: "Queijaria Santo Antônio", distance: "60 min", description: "Queijos de vaca diferentes do convencional, produção familiar." },
  { title: "Restaurante Encantamonte", distance: "50 min", description: "Excelente opção de almoço com vista para a Serra." },
];

export default function ExperienciasPage() {
  return (
    <main>
      {/* HERO */}
      <section className="relative h-[75vh] min-h-[520px] w-full overflow-hidden">
        <SmartImage
          src="/images/solarium-1/03-cafe-na-rede.jpg"
          alt="Café da manhã na rede com vista para a Serra da Mantiqueira"
          priority
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-charcoal/20 via-transparent to-charcoal/80" />
        <div className="relative z-10 flex h-full flex-col items-center justify-end px-6 pb-24 text-center text-cream">
          <Kicker tone="cream" className="mb-4 opacity-90">
            Serra da Mantiqueira
          </Kicker>
          <Heading level={1} className="text-cream">
            Sua experiência,
            <br />
            <em className="not-italic font-serif italic">nossa curadoria.</em>
          </Heading>
        </div>
      </section>

      {/* INTRO */}
      <Section spacing="tight" className="bg-charcoal text-cream">
        <Container size="narrow">
          <p className="text-center font-serif text-xl leading-relaxed text-cream/85 sm:text-2xl">
            Do amanhecer com café local na rede ao mergulho em cachoeiras de água gelada —
            organizamos cada momento para que você só precise estar presente.
          </p>
        </Container>
      </Section>

      {/* NO SOLARIUM — experiências in-house */}
      <Section className="border-t border-charcoal/10">
        <Container>
          <div className="grid gap-16 lg:grid-cols-2 lg:gap-20">
            <div className="relative aspect-[4/5] overflow-hidden">
              <SmartImage
                src="/images/solarium-1/01-piscina-infinita-externa.jpg"
                alt="Piscina infinita aquecida ao entardecer"
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
            </div>
            <div className="flex flex-col justify-center">
              <Kicker className="mb-4">No Solarium</Kicker>
              <Heading level={2}>A experiência começa na sua casa.</Heading>
              <p className="mt-6 font-sans text-base leading-relaxed text-charcoal/70">
                Antes de explorar a região, há muito a viver dentro do Solarium — e cuidamos de tudo
                com antecedência para que nada precise ser improvisado.
              </p>
              <div className="mt-10 space-y-8">
                {[
                  {
                    icon: Coffee,
                    title: "Cesta de Café da Manhã",
                    description:
                      "Curadoria de produtores locais — pão artesanal, queijos, geleias, frutas da estação. Entregue no seu deck no horário que você preferir.",
                  },
                  {
                    icon: Mountain,
                    title: "Sessões de Massagem",
                    description:
                      "Profissional parceiro certificado, sessão privativa no conforto da sua estadia. Agendamento prévio com o concierge.",
                  },
                  {
                    icon: Compass,
                    title: "Decoração Especial",
                    description:
                      "Aniversários, lua de mel, pedidos. Preparamos o ambiente com flores, velas e detalhes pensados para o seu momento.",
                  },
                ].map((item) => (
                  <div key={item.title} className="flex gap-5">
                    <item.icon className="mt-1 h-5 w-5 flex-shrink-0 text-copper" strokeWidth={1.5} />
                    <div>
                      <h3 className="font-serif text-xl text-charcoal">{item.title}</h3>
                      <p className="mt-2 font-sans text-sm leading-relaxed text-charcoal/70">
                        {item.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <a
                href={whatsappLink("Olá! Gostaria de solicitar uma experiência para minha estadia no Solarium.")}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-10 inline-flex items-center gap-2 self-start font-sans text-xs uppercase tracking-[0.25em] text-copper hover:text-charcoal"
              >
                Solicitar ao concierge <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </div>
        </Container>
      </Section>

      {/* AVENTURA */}
      <Section className="border-t border-charcoal/10 bg-charcoal/3">
        <Container>
          <div className="mb-14 max-w-2xl">
            <Kicker className="mb-4">Aventura</Kicker>
            <Heading level={2}>Para quem não fica parado.</Heading>
            <p className="mt-4 font-sans text-base leading-relaxed text-charcoal/70">
              Quadriciclo, cavalgada, bike e trilhas técnicas — escolha a intensidade.
            </p>
          </div>
          <div className="grid gap-0 border-l border-charcoal/10 md:grid-cols-2">
            {ADVENTURE.map((item, i) => (
              <article
                key={item.title}
                className={`border-b border-r border-charcoal/10 p-8 ${i % 2 === 0 ? "" : ""}`}
              >
                <h3 className="font-serif text-xl text-charcoal">{item.title}</h3>
                {item.distance && (
                  <p className="mt-2 inline-flex items-center gap-1 font-sans text-[0.65rem] uppercase tracking-[0.2em] text-copper">
                    <MapPin className="h-3 w-3" /> {item.distance}
                  </p>
                )}
                <p className="mt-3 font-sans text-sm leading-relaxed text-charcoal/70">
                  {item.description}
                </p>
              </article>
            ))}
          </div>
        </Container>
      </Section>

      {/* NATUREZA & CACHOEIRAS */}
      <Section className="border-t border-charcoal/10">
        <Container>
          <div className="grid gap-16 lg:grid-cols-[1fr_1.3fr] lg:gap-20">
            <div className="flex flex-col justify-center">
              <Kicker className="mb-4">Natureza & Cachoeiras</Kicker>
              <Heading level={2}>Água gelada e trilhas que valem o esforço.</Heading>
              <p className="mt-6 font-sans text-base leading-relaxed text-charcoal/70">
                A região abriga algumas das cachoeiras mais bonitas de Minas Gerais — a maioria a
                menos de uma hora do Solarium.
              </p>
              <div className="mt-10 space-y-6">
                {NATURE.map((item) => (
                  <div key={item.title} className="border-l-2 border-copper/30 pl-5 hover:border-copper transition-colors">
                    <div className="flex items-baseline gap-3">
                      <h3 className="font-serif text-lg text-charcoal">{item.title}</h3>
                      {item.distance && (
                        <span className="font-sans text-[0.6rem] uppercase tracking-[0.2em] text-copper">
                          {item.distance}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 font-sans text-sm leading-relaxed text-charcoal/65">
                      {item.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative aspect-[4/5] overflow-hidden">
              <SmartImage
                src="/images/solarium-2/01-sala-vista-serra.jpg"
                alt="Vista panorâmica da Serra da Mantiqueira"
                sizes="(max-width: 1024px) 100vw, 55vw"
              />
            </div>
          </div>
        </Container>
      </Section>

      {/* TRILHAS & ALTITUDE */}
      <Section className="border-t border-charcoal/10 bg-serra/5">
        <Container>
          <div className="mb-14 max-w-2xl">
            <Kicker className="mb-4">Trilhas & Altitude</Kicker>
            <Heading level={2}>De passeios panorâmicos ao pico mais alto do Brasil.</Heading>
            <p className="mt-4 font-sans text-base leading-relaxed text-charcoal/70">
              A Serra Fina e o Parque Nacional do Itatiaia ficam a menos de uma hora e meia — um
              universo de caminhadas para todos os níveis.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {TRAILS.map((item) => (
              <article key={item.title} className="bg-cream p-8">
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="font-serif text-xl text-charcoal">{item.title}</h3>
                  {item.distance && (
                    <span className="flex-shrink-0 font-sans text-[0.65rem] uppercase tracking-[0.2em] text-copper">
                      {item.distance}
                    </span>
                  )}
                </div>
                <p className="mt-3 font-sans text-sm leading-relaxed text-charcoal/70">
                  {item.description}
                </p>
              </article>
            ))}
          </div>
        </Container>
      </Section>

      {/* ROTA DO QUEIJO & GASTRONOMIA */}
      <Section className="border-t border-charcoal/10">
        <Container>
          <div className="grid gap-16 lg:grid-cols-2 lg:gap-20">
            <div className="relative order-2 aspect-[4/5] overflow-hidden lg:order-1">
              <SmartImage
                src="/images/solarium-1/05-varanda-mesa.jpg"
                alt="Varanda com mesa e vista para a serra"
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
            </div>
            <div className="order-1 flex flex-col justify-center lg:order-2">
              <Kicker className="mb-4">Rota do Queijo & Gastronomia</Kicker>
              <Heading level={2}>Produtores que valem a visita.</Heading>
              <p className="mt-6 font-sans text-base leading-relaxed text-charcoal/70">
                A região do Sul de Minas é um dos epicentros da produção artesanal de queijos do
                Brasil. Alguns produtores ficam a 5 minutos do Solarium.
              </p>
              <div className="mt-10 space-y-5">
                {GASTRONOMY.map((item) => (
                  <div key={item.title} className="flex items-start gap-4">
                    <span className="mt-1 h-px w-4 flex-shrink-0 bg-copper" />
                    <div>
                      <div className="flex items-baseline gap-2">
                        <h3 className="font-serif text-base text-charcoal">{item.title}</h3>
                        {item.distance && (
                          <span className="font-sans text-[0.6rem] uppercase tracking-[0.2em] text-copper">
                            {item.distance}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 font-sans text-xs leading-relaxed text-charcoal/65">
                        {item.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Container>
      </Section>

      {/* CULTURA */}
      <Section className="border-t border-charcoal/10 bg-charcoal/3">
        <Container>
          <div className="mb-12 max-w-2xl">
            <Kicker className="mb-4">Histórico & Cultural</Kicker>
            <Heading level={2}>A Estrada Real de trem a vapor.</Heading>
          </div>
          <div className="max-w-xl border-l-2 border-copper/40 pl-8">
            <h3 className="font-serif text-2xl text-charcoal">Maria Fumaça em Passa Quatro</h3>
            <p className="mt-2 inline-flex items-center gap-1 font-sans text-[0.65rem] uppercase tracking-[0.2em] text-copper">
              <MapPin className="h-3 w-3" /> 40 min
            </p>
            <p className="mt-4 font-sans text-base leading-relaxed text-charcoal/70">
              Uma viagem pela história pela Estrada Real, passando pelo icônico Túnel da Mantiqueira.
              O passeio de Maria Fumaça em Passa Quatro é uma das poucas experiências desse tipo
              ainda disponíveis no Brasil — imperdível, especialmente nos fins de semana.
            </p>
          </div>
        </Container>
      </Section>

      {/* CONCIERGE CTA */}
      <Section className="border-t border-charcoal/10 bg-serra text-cream" spacing="tight">
        <Container size="narrow">
          <div className="text-center">
            <Kicker tone="copper" className="mb-4">Concierge personalizado</Kicker>
            <Heading level={2} className="text-cream">
              Vamos planejar a sua experiência juntos.
            </Heading>
            <p className="mx-auto mt-6 max-w-xl font-sans text-base leading-relaxed text-cream/80">
              Conte um pouco do que você imagina — aventura, gastronomia, descanso total — e nós
              combinamos os detalhes: reservas, transporte, agenda personalizada.
            </p>
            <a
              href={whatsappLink("Olá! Gostaria de planejar minha experiência no Solarium Mantiqueira.")}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-10 inline-flex items-center gap-2 bg-copper px-9 py-4 font-sans text-xs uppercase tracking-[0.3em] text-cream hover:bg-cream hover:text-charcoal"
            >
              <MessageCircle className="h-4 w-4" /> Falar no WhatsApp <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </Container>
      </Section>
    </main>
  );
}
