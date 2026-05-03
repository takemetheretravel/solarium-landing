import { Metadata } from "next";
import Container from "@/components/ui/Container";
import Section from "@/components/ui/Section";
import Heading from "@/components/ui/Heading";
import Kicker from "@/components/ui/Kicker";
import { SITE } from "@/config/site";

export const metadata: Metadata = {
  title: "Termos e Condições",
  description: "Termos e condições de hospedagem do Solarium Mantiqueira.",
  robots: { index: true, follow: true },
};

export default function TermosPage() {
  return (
    <main className="pt-32 pb-20">
      <Container size="narrow">
        <Kicker className="mb-4">Documento legal</Kicker>
        <Heading level={1} className="text-4xl sm:text-5xl">Termos e Condições</Heading>
        <p className="mt-4 font-sans text-xs uppercase tracking-[0.25em] text-charcoal/60">
          Última atualização: 03 de maio de 2026
        </p>

        <Section spacing="tight" className="prose-editorial">
          <p>
            Bem-vindo ao Solarium Mantiqueira. Estes Termos e Condições regem a relação entre você (Hóspede) e <strong>{SITE.name}</strong>, operado por <strong>{SITE.legalName}</strong>, CNPJ {SITE.cnpj}, doravante denominado &ldquo;Anfitrião&rdquo;. Ao realizar uma reserva, você declara ter lido, compreendido e aceito integralmente estes Termos.
          </p>

          <h2>1. Reserva e confirmação</h2>
          <p>
            A reserva é considerada confirmada após o recebimento integral do pagamento (ou primeira parcela, conforme acordado) e o envio do e-mail de confirmação pelo Anfitrião. Antes desse evento, datas reservadas podem ser liberadas sem aviso prévio.
          </p>

          <h2>2. Check-in e check-out</h2>
          <ul>
            <li><strong>Check-in:</strong> a partir das 15h00.</li>
            <li><strong>Check-out:</strong> até às 11h00.</li>
            <li>Horários alternativos podem ser combinados previamente, sujeito à disponibilidade operacional.</li>
            <li>Late check-out sem combinação prévia será cobrado como diária adicional.</li>
          </ul>

          <h2>3. Pagamento</h2>
          <p>
            Aceitamos cartão de crédito (à vista ou parcelado) e Pix. Pagamentos via Pix recebem desconto automático de 3% ({SITE.pixDiscountPercent}%). Reservas com mais de 30 dias de antecedência podem ser pagas em duas parcelas: 50% na confirmação e 50% até 14 dias antes do check-in.
          </p>

          <h2 id="cancelamento">4. Política de cancelamento</h2>
          <ul>
            <li><strong>Cancelamento com mais de 14 dias do check-in:</strong> reembolso integral, descontadas eventuais taxas de processamento de pagamento.</li>
            <li><strong>Cancelamento entre 14 e 7 dias antes do check-in:</strong> reembolso de 50% do valor pago.</li>
            <li><strong>Cancelamento com menos de 7 dias:</strong> sem reembolso, salvo casos de força maior comprovada (ex.: fechamento de estrada, evento climático severo, doença grave com atestado).</li>
            <li>Em caso de no-show (não comparecimento), não haverá reembolso.</li>
            <li>Reagendamentos podem ser oferecidos no lugar do reembolso a critério do Anfitrião e sujeitos à disponibilidade.</li>
          </ul>

          <h2>5. Capacidade e visitantes</h2>
          <p>
            A capacidade máxima de cada casa deve ser respeitada e foi definida pensando no conforto e na segurança. Não é permitida a entrada de visitantes externos sem autorização prévia e por escrito do Anfitrião. Festas e eventos não são permitidos sem contratação específica do produto &ldquo;Solarium Completo + Evento&rdquo;.
          </p>

          <h2>6. Cuidado com a propriedade</h2>
          <p>
            O Hóspede compromete-se a tratar a propriedade com zelo. Quaisquer danos causados durante a estadia serão avaliados e cobrados conforme orçamento real de reposição/reparo. Recomendamos a leitura do manual da casa, disponível na entrada.
          </p>

          <h2>7. Animais de estimação</h2>
          <p>
            Aceitamos animais de pequeno e médio porte (até 20kg) mediante aviso prévio na reserva e taxa adicional. Os animais devem permanecer em áreas autorizadas, não subir em camas ou sofás, e seus tutores são responsáveis por qualquer dano causado.
          </p>

          <h2>8. Tabaco e substâncias</h2>
          <p>
            É proibido fumar dentro das casas. Áreas externas ao ar livre são permitidas, desde que com descarte responsável das bitucas. O uso de substâncias ilícitas é estritamente proibido em toda a propriedade.
          </p>

          <h2>9. Cupons e descontos</h2>
          <p>
            Cupons promocionais são válidos conforme regras específicas (mínimo de noites, datas de validade) e não são cumulativos entre si. O desconto Pix é cumulativo com cupons de estadia. Cupons aplicados em reservas posteriormente canceladas são liberados conforme política de cancelamento.
          </p>

          <h2>10. Limitação de responsabilidade</h2>
          <p>
            O Anfitrião não se responsabiliza por objetos pessoais do Hóspede esquecidos ou extraviados durante a estadia, por falhas em serviços externos (energia, internet, sinal de celular) decorrentes de causas alheias à sua operação, nem por acidentes causados por uso indevido de equipamentos e estruturas da casa.
          </p>

          <h2>11. Foro e legislação aplicável</h2>
          <p>
            Estes Termos são regidos pela legislação brasileira. Fica eleito o foro da comarca de Itanhandu/MG para dirimir quaisquer controvérsias.
          </p>

          <h2>12. Privacidade</h2>
          <p>
            O tratamento de dados pessoais é regido pela nossa <a href="/privacidade">Política de Privacidade</a>, em conformidade com a Lei Geral de Proteção de Dados (LGPD - Lei nº 13.709/2018).
          </p>

          <h2>13. Atualizações</h2>
          <p>
            Estes Termos podem ser atualizados a qualquer momento. A versão aplicável à sua reserva é aquela vigente na data de confirmação. Reservas confirmadas antes de uma atualização permanecem regidas pela versão anterior.
          </p>

          <h2>14. Contato</h2>
          <p>
            Em caso de dúvidas, entre em contato pelo WhatsApp <strong>{SITE.whatsappDisplay}</strong> ou por e-mail em <a href={`mailto:${SITE.email}`}>{SITE.email}</a>.
          </p>
        </Section>
      </Container>
    </main>
  );
}
