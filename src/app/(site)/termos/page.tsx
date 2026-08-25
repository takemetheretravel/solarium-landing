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

export const revalidate = 86400;

export default function TermosPage() {
  return (
    <main className="pt-32 pb-20">
      <Container size="narrow">
        <Kicker className="mb-4">Documento legal</Kicker>
        <Heading level={1} className="text-4xl sm:text-5xl">Termos e Condições</Heading>
        <p className="mt-4 font-sans text-xs uppercase tracking-[0.25em] text-charcoal/60">
          Última atualização: 04 de maio de 2026
        </p>

        <Section spacing="tight" className="prose-editorial">
          <p>
            Bem-vindo ao Solarium Mantiqueira. Estes Termos e Condições regem a relação entre você (Hóspede) e <strong>{SITE.name}</strong>, operado por <strong>{SITE.legalName}</strong>, CNPJ {SITE.cnpj}, doravante denominado &ldquo;Anfitrião&rdquo;. Ao realizar uma reserva, você declara ter lido, compreendido e aceito integralmente estes Termos.
          </p>

          <h2>1. Reserva e confirmação</h2>
          <p>
            A reserva é considerada confirmada após o recebimento integral do pagamento e o envio da confirmação pelo Anfitrião. Antes desse evento, as datas selecionadas podem ser liberadas sem aviso prévio.
          </p>

          <h2>2. Check-in e check-out</h2>
          <ul>
            <li><strong>Check-in:</strong> a partir das 15h00.</li>
            <li><strong>Check-out:</strong> até às 11h00.</li>
            <li>Horários alternativos podem ser combinados previamente, sujeito à disponibilidade operacional.</li>
            <li>Late check-out sem combinação prévia será cobrado como diária adicional.</li>
          </ul>
          <p id="ocupacao">
            <strong>2.3 Excedente de ocupação.</strong> A capacidade máxima de cada propriedade é definida e comunicada no momento da reserva. A presença de hóspedes adicionais além do número contratado configura violação contratual e sujeita o Hóspede à cobrança de <strong>R$ 200,00 por pessoa por dia</strong> para visitantes que não pernoitem e de <strong>R$ 600,00 por pessoa por pernoite</strong> para aqueles que pernoitem, sem prejuízo do direito de o Anfitrião encerrar a hospedagem imediatamente.
          </p>

          <h2>3. Pagamento</h2>
          <p id="pagamento">
            Aceitamos cartão de crédito em até 6x sem juros e Pix. Pagamentos via Pix recebem desconto automático de {SITE.pixDiscountPercent}%.
          </p>
          <p>
            <strong>13.1 Pagamento integral antecipado.</strong> O pagamento é realizado integralmente no ato da confirmação da reserva. Não há parcelamento com vencimento após o início da hospedagem. Reservas não são garantidas sem a quitação completa do valor.
          </p>

          <h2 id="cancelamento">4. Política de cancelamento</h2>
          <p>
            <strong>4.2</strong> Cancelamentos realizados em até <strong>7 dias corridos após a data de confirmação da reserva</strong>, desde que haja pelo menos 24 horas de antecedência em relação ao check-in, são isentos de qualquer custo — independentemente da antecedência do check-in. Após esse prazo de 7 dias, <strong>não haverá reembolso de qualquer valor</strong>, salvo casos de força maior documentada (fechamento de estradas por eventos climáticos extremos, doença grave com laudo médico).
          </p>
          <ul>
            <li>Reagendamentos podem ser solicitados com no mínimo 15 dias de antecedência em relação ao check-in e estão sujeitos à disponibilidade.</li>
            <li>Em caso de no-show (não comparecimento sem contato prévio), não haverá reembolso.</li>
          </ul>

          <h2>5. Cuidado com a propriedade</h2>
          <p>
            O Hóspede compromete-se a tratar a propriedade com zelo. Quaisquer danos causados durante a estadia serão avaliados e cobrados conforme orçamento real de reposição ou reparo. Recomendamos a leitura do manual da casa, disponível na entrada.
          </p>

          <h2>6. Visitantes externos e invasão de áreas privativas</h2>
          <p>
            Não é permitida a entrada de visitantes externos sem autorização prévia por escrito do Anfitrião.
          </p>
          <p>
            <strong>7.2b</strong> A invasão ou utilização não autorizada de áreas privativas de outra unidade (no caso do Solarium Completo, o acesso à unidade vizinha sem contratação) sujeita o Hóspede a uma multa de <strong>até R$ 1.500,00 por ocorrência</strong>, além de eventual responsabilidade civil por danos causados.
          </p>

          <h2>7. Animais de estimação</h2>
          <p>
            <strong>8.1</strong> Aceitamos animais de estimação de <strong>qualquer porte</strong>, mediante aviso prévio obrigatório no momento da reserva (quantidade e porte). Os animais devem permanecer em áreas autorizadas, não subir em sofás ou camas, e seus tutores são integralmente responsáveis por qualquer dano causado. Enxovais ou estofados danificados serão cobrados conforme custo de reposição.
          </p>

          <h2>8. Tabaco, substâncias e silêncio noturno</h2>
          <p>
            <strong>9.1b</strong> É <strong>terminantemente proibido fumar dentro das casas</strong>. O descumprimento desta cláusula implica multa de <strong>R$ 2.000,00</strong>, descontada do cartão do hóspede ou exigida via Pix antes do check-out, sem prejuízo das despesas de limpeza especializada.
          </p>
          <p>
            O uso de substâncias ilícitas é proibido em toda a propriedade. Festas e eventos barulhentos após as 22h não são permitidos — a propriedade é um espaço de descanso e contemplação.
          </p>

          <h2>9. Cupons e descontos</h2>
          <p>
            Cupons promocionais são válidos conforme regras específicas (mínimo de noites, datas de validade) e não são cumulativos entre si. O desconto Pix é cumulativo com cupons de estadia. Cupons aplicados em reservas canceladas dentro do prazo de reembolso integral são liberados para uso futuro.
          </p>

          <h2>10. Limitação de responsabilidade</h2>
          <p>
            O Anfitrião não se responsabiliza por objetos pessoais esquecidos ou extraviados, por interrupções em serviços externos (energia elétrica, internet, sinal de celular) decorrentes de causas alheias à sua operação, nem por acidentes causados por uso indevido de equipamentos e estruturas da propriedade.
          </p>

          <h2>11. Privacidade</h2>
          <p>
            O tratamento de dados pessoais é regido pela nossa <a href="/privacidade">Política de Privacidade</a>, em conformidade com a Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018).
          </p>

          <h2>12. Atualizações</h2>
          <p>
            Estes Termos podem ser atualizados a qualquer momento. A versão aplicável à sua reserva é aquela vigente na data de confirmação. Reservas confirmadas antes de uma atualização permanecem regidas pela versão anterior salvo disposição legal em contrário.
          </p>

          <h2>13. Foro e legislação aplicável</h2>
          <p>
            Estes Termos são regidos pela legislação brasileira. Fica eleito o foro da comarca de <strong>Itanhandu/MG</strong> para dirimir quaisquer controvérsias, com renúncia a qualquer outro por mais privilegiado que seja.
          </p>

          <h2>14. Contato</h2>
          <p>
            Em caso de dúvidas, entre em contato pelo WhatsApp <strong>(35) 98407-5652</strong>.
          </p>
        </Section>
      </Container>
    </main>
  );
}
