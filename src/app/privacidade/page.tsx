import { Metadata } from "next";
import Container from "@/components/ui/Container";
import Section from "@/components/ui/Section";
import Heading from "@/components/ui/Heading";
import Kicker from "@/components/ui/Kicker";
import { SITE } from "@/config/site";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description:
    "Como o Solarium Mantiqueira coleta, armazena, usa e compartilha seus dados pessoais — em conformidade com a LGPD.",
};

export default function PrivacidadePage() {
  return (
    <main className="pt-32 pb-20">
      <Container size="narrow">
        <Kicker className="mb-4">LGPD</Kicker>
        <Heading level={1} className="text-4xl sm:text-5xl">Política de Privacidade</Heading>
        <p className="mt-4 font-sans text-xs uppercase tracking-[0.25em] text-charcoal/60">
          Última atualização: 03 de maio de 2026
        </p>

        <Section spacing="tight" className="prose-editorial">
          <p>
            Esta Política de Privacidade descreve como <strong>{SITE.name}</strong>, operado por <strong>{SITE.legalName}</strong> (CNPJ {SITE.cnpj}), trata os dados pessoais coletados em nosso site, em comunicações e durante a operação de hospedagem. Atuamos em conformidade com a Lei Geral de Proteção de Dados (LGPD - Lei nº 13.709/2018).
          </p>

          <h2>1. Dados coletados</h2>
          <h3>1.1 Dados de cadastro e reserva</h3>
          <ul>
            <li>Nome completo, CPF, RG ou documento equivalente</li>
            <li>Data de nascimento</li>
            <li>Endereço residencial completo</li>
            <li>E-mail e telefone celular</li>
            <li>Dados dos hóspedes acompanhantes (nome e documento, conforme exigência legal de hospedagem)</li>
          </ul>

          <h3>1.2 Dados de pagamento</h3>
          <p>
            Dados financeiros (cartão de crédito, chave Pix) são processados diretamente pelos provedores de pagamento (ex.: Cielo) e <strong>não são armazenados em nossos servidores</strong>. Recebemos apenas o status e o identificador da transação.
          </p>

          <h3>1.3 Dados de navegação</h3>
          <ul>
            <li>Endereço IP, tipo de navegador e dispositivo</li>
            <li>Páginas visitadas, tempo de sessão e ações no site</li>
            <li>Cookies essenciais e de análise (ver seção 6)</li>
          </ul>

          <h2>2. Base legal e finalidade</h2>
          <ul>
            <li><strong>Execução de contrato</strong> (art. 7º, V): processar reservas, confirmar hospedagem, emitir comprovantes e cumprir obrigações fiscais.</li>
            <li><strong>Cumprimento de obrigação legal</strong> (art. 7º, II): manter cadastro de hóspedes conforme legislação de hospedagem (FNRH/CADASTUR).</li>
            <li><strong>Consentimento</strong> (art. 7º, I): envio de comunicações de marketing e atualizações da propriedade.</li>
            <li><strong>Legítimo interesse</strong> (art. 7º, IX): análise estatística de uso do site, prevenção a fraudes e melhoria de serviços, sempre balanceado com seus direitos.</li>
          </ul>

          <h2>3. Compartilhamento</h2>
          <p>
            Compartilhamos dados estritamente necessários com:
          </p>
          <ul>
            <li><strong>Operadores de pagamento</strong> (Cielo e similares) para processar transações.</li>
            <li><strong>Hostaway</strong>, sistema de gestão de propriedades, para sincronização de calendário e comunicações operacionais.</li>
            <li><strong>Provedores de hospedagem em nuvem</strong> (Vercel, Google Cloud, AWS) que armazenam dados em infraestrutura segura.</li>
            <li><strong>Provedores de e-mail transacional</strong> para envio de confirmações e comunicações da reserva.</li>
            <li><strong>Provedores de análise</strong> (Google Analytics, no futuro), com IP anonimizado quando aplicável.</li>
            <li><strong>Autoridades públicas</strong>, quando exigido por lei ou ordem judicial.</li>
          </ul>
          <p>Não vendemos seus dados pessoais a terceiros para fins comerciais.</p>

          <h2>4. Direitos do titular</h2>
          <p>Conforme art. 18 da LGPD, você pode, a qualquer momento, requisitar:</p>
          <ul>
            <li>Confirmação da existência de tratamento</li>
            <li>Acesso aos dados que mantemos sobre você</li>
            <li>Correção de dados incompletos, inexatos ou desatualizados</li>
            <li>Anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade</li>
            <li>Portabilidade dos dados</li>
            <li>Eliminação dos dados tratados com seu consentimento</li>
            <li>Informação sobre entidades com as quais compartilhamos dados</li>
            <li>Revogação do consentimento, sem prejuízo dos tratamentos baseados em outras bases legais</li>
          </ul>
          <p>
            Para exercer qualquer um desses direitos, entre em contato pelo e-mail <a href={`mailto:${SITE.email}`}>{SITE.email}</a> ou WhatsApp <strong>{SITE.whatsappDisplay}</strong>. Responderemos em até 15 dias úteis.
          </p>

          <h2>5. Retenção e segurança</h2>
          <p>
            Os dados pessoais são retidos pelo tempo necessário para cumprir as finalidades aqui descritas e para atender obrigações legais (ex.: dados fiscais por 5 anos). Aplicamos medidas técnicas e administrativas para proteger seus dados, incluindo criptografia em trânsito (HTTPS), controle de acesso restrito e auditoria de logs.
          </p>

          <h2>6. Cookies</h2>
          <p>
            Utilizamos cookies essenciais (necessários para o funcionamento do site) e, futuramente, cookies de análise para entendermos o uso do site e melhorá-lo. Você pode desativar cookies nas configurações do seu navegador, embora isso possa afetar funcionalidades do site.
          </p>

          <h2>7. Crianças e adolescentes</h2>
          <p>
            Nosso site e nossos serviços não são direcionados a menores de 18 anos. Caso identifiquemos dados coletados de menores sem o consentimento de seus responsáveis, tomaremos medidas para sua exclusão.
          </p>

          <h2>8. Encarregado e contato</h2>
          <p>
            <strong>Controlador:</strong> {SITE.legalName} (CNPJ {SITE.cnpj}).<br />
            <strong>Encarregado de Dados (DPO):</strong> contato pelo e-mail <a href={`mailto:${SITE.email}`}>{SITE.email}</a> ou WhatsApp <strong>{SITE.whatsappDisplay}</strong>.
          </p>

          <h2>9. Atualizações desta política</h2>
          <p>
            Esta política pode ser atualizada periodicamente. A versão vigente será sempre disponibilizada em /privacidade, com a data da última atualização indicada no topo do documento.
          </p>
        </Section>
      </Container>
    </main>
  );
}
