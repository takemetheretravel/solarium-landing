import { Metadata } from "next";
import { ArrowRight, MessageCircle, MapPin } from "lucide-react";
import Container from "@/components/ui/Container";
import Section from "@/components/ui/Section";
import Heading from "@/components/ui/Heading";
import Kicker from "@/components/ui/Kicker";
import SmartImage from "@/components/ui/SmartImage";

export const metadata: Metadata = {
  title: "Experiências",
  description:
    "Da cesta de café com produtores locais às cachoeiras da Serra da Mantiqueira — curadoria completa de experiências no Solarium e na região.",
};

const WA = "5535984075652";

function waLink(msg: string) {
  return `https://wa.me/${WA}?text=${encodeURIComponent(msg)}`;
}

function WaButton({ msg, label }: { msg: string; label: string }) {
  return (
    <a
      href={waLink(msg)}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-8 inline-flex items-center gap-2 bg-copper px-7 py-3.5 font-sans text-xs uppercase tracking-[0.25em] text-cream hover:bg-copper/90"
    >
      <MessageCircle className="h-4 w-4" /> {label}
    </a>
  );
}

type Item = { label: string; detail?: string; distance?: string };

function ItemList({ items }: { items: Item[] }) {
  return (
    <ul className="mt-6 space-y-3">
      {items.map((item) => (
        <li key={item.label} className="flex items-start gap-3 font-sans text-sm text-charcoal/80">
          <span className="mt-2 h-px w-3 flex-shrink-0 bg-copper" />
          <span>
            <span className="font-medium text-charcoal">{item.label}</span>
            {item.distance && (
              <span className="ml-2 inline-flex items-center gap-0.5 font-sans text-[0.6rem] uppercase tracking-[0.2em] text-copper">
                <MapPin className="h-2.5 w-2.5" /> {item.distance}
              </span>
            )}
            {item.detail && (
              <span className="block text-charcoal/60 text-xs mt-0.5">{item.detail}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function ExperienciasPage() {
  return (
    <main>
      {/* ── SEÇÃO 1: Hero ──────────────────────────────────────────── */}
      <section className="relative h-[60vh] min-h-[440px] w-full overflow-hidden">
        <SmartImage
          src="/images/experiencias/decoracao-romantica.jpg"
          alt="Decoração romântica no Solarium Mantiqueira"
          priority
          fill
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-charcoal/30 via-charcoal/20 to-charcoal/75" />
        <div className="relative z-10 flex h-full flex-col items-center justify-end px-6 pb-20 text-center text-cream">
          <Kicker tone="cream" className="mb-4 opacity-90">Serra da Mantiqueira</Kicker>
          <Heading level={1} className="text-cream">
            Sua estadia é só o começo.
          </Heading>
          <p className="mx-auto mt-5 max-w-xl font-sans text-base leading-relaxed text-cream/85">
            Dentro do Solarium ou pela Serra da Mantiqueira, organizamos cada detalhe para que
            você só precise aproveitar.
          </p>
        </div>
      </section>

      {/* ── SEÇÃO 2: No Solarium — 3 cards ────────────────────────── */}
      <Section className="border-t border-charcoal/10">
        <Container>
          <div className="mb-14 max-w-2xl">
            <Kicker className="mb-4">No Solarium</Kicker>
            <Heading level={2}>Experiências na sua casa.</Heading>
          </div>
          <div className="grid gap-0 border border-charcoal/10 md:grid-cols-3">
            {[
              {
                src: "/images/experiencias/cesta-cafe-preparada.jpg",
                alt: "Cesta de café da manhã preparada com produtos locais",
                title: "Café da manhã na varanda",
                text: "Cesta preparada com produtos de produtores locais, entregue no horário que você escolher. Uma das experiências favoritas dos nossos hóspedes.",
                msg: "Olá! Gostaria de incluir a cesta de café da manhã na minha estadia no Solarium Mantiqueira. Pode me ajudar?",
              },
              {
                src: "/images/experiencias/massagem.jpg",
                alt: "Sessão de massagem privativa no Solarium",
                title: "Sessões de massagem",
                text: "Profissional parceiro, sessão privativa no conforto da sua casa. Antecedência mínima de 24h para agendamento.",
                msg: "Olá! Gostaria de agendar uma sessão de massagem durante minha estadia no Solarium Mantiqueira. Pode me ajudar?",
              },
              {
                src: "/images/experiencias/decoracao-romantica.jpg",
                alt: "Decoração especial para momentos românticos",
                title: "Decoração para momentos especiais",
                text: "Aniversários, pedidos, lua de mel. Preparamos o ambiente antes da sua chegada para tornar o momento inesquecível.",
                msg: "Olá! Gostaria de solicitar uma decoração especial para minha estadia no Solarium Mantiqueira. Pode me ajudar?",
              },
            ].map((card) => (
              <div key={card.title} className="flex flex-col border-r border-charcoal/10 last:border-r-0">
                <div className="relative aspect-[4/3] overflow-hidden bg-charcoal/5">
                  <SmartImage src={card.src} alt={card.alt} fill sizes="(max-width: 768px) 100vw, 33vw" />
                </div>
                <div className="flex flex-1 flex-col p-8">
                  <h3 className="font-serif text-xl text-charcoal">{card.title}</h3>
                  <p className="mt-3 flex-1 font-sans text-sm leading-relaxed text-charcoal/70">{card.text}</p>
                  <a
                    href={waLink(card.msg)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-6 inline-flex items-center gap-1 self-start font-sans text-xs uppercase tracking-[0.2em] text-copper hover:text-charcoal"
                  >
                    Solicitar <ArrowRight className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      {/* ── SEÇÃO 3: Aventura — foto + texto ─────────────────────── */}
      <Section className="border-t border-charcoal/10 bg-cream">
        <Container size="wide">
          <div className="grid grid-cols-1 items-stretch lg:grid-cols-2">
            <div className="relative aspect-[4/3] overflow-hidden lg:aspect-auto">
              <SmartImage
                src="/images/experiencias/bike.jpg"
                alt="Trilhas de bike e aventura na Serra da Mantiqueira"
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
            </div>
            <div className="flex flex-col justify-center bg-white p-10 md:p-14">
              <Kicker className="mb-3 text-copper">Aventura na Serra</Kicker>
              <Heading level={2}>Pra quem não fica parado.</Heading>
              <p className="mt-5 font-sans text-base leading-relaxed text-charcoal/70">
                A Serra da Mantiqueira é um playground natural. Trilhas de bike adaptadas ao seu
                nível, cavalgadas pelo campo, quadriciclo pelos arredores — nosso concierge monta
                o roteiro certo para o seu ritmo.
              </p>
              <ItemList
                items={[
                  { label: "Cavalgadas no Rancho Estância Casa Nova", distance: "5 min" },
                  { label: "Quadriciclo com guia · Rancho Estância Casa Nova", distance: "5 min" },
                  { label: "Trilhas de bike", detail: "roteiros personalizados por nível" },
                  { label: "Quadriciclo · Toca do Lobo Adventure", distance: "40 min" },
                ]}
              />
              <WaButton
                msg="Olá! Tenho interesse em atividades de aventura durante minha estadia no Solarium Mantiqueira. Pode me ajudar a montar um roteiro?"
                label="Montar meu roteiro de aventura"
              />
            </div>
          </div>
        </Container>
      </Section>

      {/* ── SEÇÃO 4: Cachoeiras — foto full-width overlay ─────────── */}
      <div className="relative h-[55vh] min-h-[380px] w-full overflow-hidden">
        <SmartImage
          src="/images/experiencias/cachoeira.jpg"
          alt="Cachoeira na Serra da Mantiqueira"
          fill
          sizes="100vw"
          priority
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-charcoal/55 px-4 text-center">
          <Kicker tone="cream" className="mb-4 opacity-90">Natureza e Cachoeiras</Kicker>
          <Heading level={2} className="text-cream max-w-2xl">
            Água gelada e trilhas que valem o esforço
          </Heading>
        </div>
      </div>
      <Section spacing="tight" className="bg-cream">
        <Container>
          <p className="max-w-2xl font-sans text-base leading-relaxed text-charcoal/70">
            A região tem algumas das cachoeiras mais bonitas de Minas. Do poço para nadar à trilha
            com vista de cortar o fôlego.
          </p>
          <div className="mt-8 grid gap-x-12 gap-y-3 sm:grid-cols-2">
            {[
              { label: "Ivos Hostel", distance: "25 min" },
              { label: "Poço Paraíso", distance: "35 min" },
              { label: "Poço da Encruza", distance: "45 min", detail: "almoço no Rancho do Zé" },
              { label: "Cachoeira do Andorinhão", distance: "45 min" },
              { label: "Cachoeira da Gomeira", distance: "60 min" },
              { label: "Laurinho Restaurante e Balneário", distance: "15 min" },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-3 font-sans text-sm text-charcoal/80">
                <span className="mt-2 h-px w-3 flex-shrink-0 bg-copper" />
                <span>
                  <span className="font-medium text-charcoal">{item.label}</span>
                  <span className="ml-2 inline-flex items-center gap-0.5 font-sans text-[0.6rem] uppercase tracking-[0.2em] text-copper">
                    <MapPin className="h-2.5 w-2.5" /> {item.distance}
                  </span>
                  {item.detail && (
                    <span className="block text-charcoal/55 text-xs mt-0.5">{item.detail}</span>
                  )}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-8 aspect-video w-full overflow-hidden">
            <iframe
              src="https://www.youtube.com/embed/O_i9ApmuaZo"
              title="Rota das Cachoeiras"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="h-full w-full"
            />
          </div>

          <WaButton
            msg="Olá! Tenho interesse em conhecer as cachoeiras da região durante minha estadia no Solarium Mantiqueira. Pode me ajudar a organizar?"
            label="Planejar meu passeio às cachoeiras"
          />
        </Container>
      </Section>

      {/* ── SEÇÃO 5: Trilhas e Mirantes — texto + foto ────────────── */}
      <Section className="border-t border-charcoal/10">
        <Container size="wide">
          <div className="grid grid-cols-1 items-stretch lg:grid-cols-2">
            <div className="flex flex-col justify-center bg-white p-10 md:p-14 lg:order-1">
              <Kicker className="mb-3 text-copper">Trilhas e Mirantes</Kicker>
              <Heading level={2}>Passeios panorâmicos aos picos da Serra.</Heading>
              <p className="mt-5 font-sans text-base leading-relaxed text-charcoal/70">
                A região fica no entorno do Parque Nacional do Itatiaia, com algumas das montanhas
                mais altas do Brasil. Para caminhadas de altitude e vistas que não se esquecem.
              </p>
              <ItemList
                items={[
                  { label: "Parque Nacional do Itatiaia", distance: "60 min", detail: "caminhadas de altitude" },
                  { label: "Capim Amarelo", distance: "1h30", detail: "início da travessia da Serra Fina" },
                  { label: "Instituto Alta Montanha", distance: "20 min", detail: "day use com cachoeira" },
                ]}
              />
              <WaButton
                msg="Olá! Tenho interesse em trilhas e mirantes durante minha estadia no Solarium Mantiqueira. Pode me ajudar?"
                label="Planejar trilha"
              />
            </div>
            <div className="relative aspect-[4/3] overflow-hidden lg:order-2 lg:aspect-auto">
              <SmartImage
                src="/images/experiencias/montanha.jpg"
                alt="Vista aérea da Serra da Mantiqueira"
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
            </div>
          </div>
        </Container>
      </Section>

      {/* ── SEÇÃO 6: Rota do Queijo — foto full-width + lista ──────── */}
      <div className="relative h-[45vh] min-h-[320px] w-full overflow-hidden">
        <SmartImage
          src="/images/experiencias/queijaria.jpg"
          alt="Rota do queijo artesanal na Serra da Mantiqueira"
          fill
          sizes="100vw"
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-charcoal/50 px-4 text-center">
          <Kicker tone="cream" className="mb-4 opacity-90">Rota do Queijo</Kicker>
          <Heading level={2} className="text-cream max-w-2xl">
            Produtores que valem a visita.
          </Heading>
        </div>
      </div>
      <Section spacing="tight" className="bg-cream">
        <Container>
          <p className="max-w-2xl font-sans text-base leading-relaxed text-charcoal/70">
            A Serra da Mantiqueira tem uma das rotas de queijo mais ricas do Brasil. Maturados
            artesanais, visitas a rebanhos de búfalas e cabras, e saborear direto da fábrica.
          </p>
          <div className="mt-8 grid gap-x-12 gap-y-3 sm:grid-cols-2">
            {[
              { label: "Pérola da Serra", distance: "5 min", detail: "búfala" },
              { label: "Di Capre", distance: "25 min", detail: "cabra" },
              { label: "Queijaria 50", distance: "30 min", detail: "agendamento" },
              { label: "Almeida Guimarães", distance: "20 min", detail: "vaca" },
              { label: "Laticínios Ecila", distance: "20 min", detail: "tradicional" },
              { label: "Terra dos Queijos Alagoa", distance: "2h", detail: "parmesão" },
              { label: "Queijaria Garrafão", distance: "2h", detail: "artesanal" },
              { label: "Queijaria Santo Antônio", distance: "60 min", detail: "especial" },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-3 font-sans text-sm text-charcoal/80">
                <span className="mt-2 h-px w-3 flex-shrink-0 bg-copper" />
                <span>
                  <span className="font-medium text-charcoal">{item.label}</span>
                  <span className="ml-2 inline-flex items-center gap-0.5 font-sans text-[0.6rem] uppercase tracking-[0.2em] text-copper">
                    <MapPin className="h-2.5 w-2.5" /> {item.distance}
                  </span>
                  <span className="ml-1 text-charcoal/50 text-xs">· {item.detail}</span>
                </span>
              </div>
            ))}
          </div>
          <WaButton
            msg="Olá! Tenho interesse na rota do queijo durante minha estadia no Solarium Mantiqueira. Pode me ajudar a organizar?"
            label="Organizar rota do queijo"
          />
        </Container>
      </Section>

      {/* ── SEÇÃO 7: Maria Fumaça — foto centrada ──────────────────── */}
      <Section className="border-t border-charcoal/10">
        <Container>
          <div className="mx-auto max-w-3xl text-center">
            <Kicker className="mb-4 text-copper">Cultura e História</Kicker>
            <Heading level={2}>A estrada real de trem a vapor.</Heading>
            <p className="mx-auto mt-5 max-w-xl font-sans text-base leading-relaxed text-charcoal/70">
              A Maria Fumaça de Passa Quatro percorre um dos trechos mais bonitos da Estrada Real,
              passando pelo histórico Túnel da Mantiqueira com vistas de tirar o fôlego. Uma viagem
              no tempo a 40 minutos do Solarium.
            </p>
          </div>
          <div className="relative mx-auto mt-10 aspect-[16/9] max-w-3xl overflow-hidden">
            <SmartImage
              src="/images/experiencias/maria-fumaca.jpg"
              alt="Maria Fumaça na Estrada Real em Passa Quatro"
              fill
              sizes="(max-width: 768px) 100vw, 800px"
            />
          </div>
          <div className="mt-8 text-center">
            <WaButton
              msg="Olá! Tenho interesse no passeio de Maria Fumaça durante minha estadia no Solarium Mantiqueira. Pode me ajudar?"
              label="Saber mais"
            />
          </div>
        </Container>
      </Section>

      {/* ── SEÇÃO 8: CTA Final ─────────────────────────────────────── */}
      <Section className="border-t border-charcoal/10 bg-charcoal text-cream" spacing="tight">
        <Container size="narrow">
          <div className="text-center">
            <Kicker tone="copper" className="mb-4">Concierge Solarium</Kicker>
            <Heading level={2} className="text-cream">
              Sua experiência, nossa curadoria.
            </Heading>
            <p className="mx-auto mt-5 max-w-md font-sans text-base leading-relaxed text-cream/75">
              Conte o que você gosta e organizamos o roteiro ideal da sua estadia.
            </p>
            <a
              href="https://wa.me/5535984075652?text=Ol%C3%A1!%20Gostaria%20de%20planejar%20minha%20experi%C3%AAncia%20no%20Solarium%20Mantiqueira."
              target="_blank"
              rel="noopener noreferrer"
              className="mt-10 inline-flex items-center gap-2 bg-[#25D366] px-9 py-4 font-sans text-xs uppercase tracking-[0.3em] text-white hover:bg-[#20BA5C]"
            >
              <MessageCircle className="h-4 w-4" /> Falar com o concierge
            </a>
          </div>
        </Container>
      </Section>
    </main>
  );
}
