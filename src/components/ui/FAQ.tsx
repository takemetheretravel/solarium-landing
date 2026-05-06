import { Plus } from "lucide-react";

export type FAQItem = { q: string; a: string };

export const FAQ_ITEMS: FAQItem[] = [
  {
    q: "Posso levar meu pet?",
    a: "Pode sim e ficamos felizes com isso! Os pets que se hospedam aqui costumam aproveitar muito — área aberta, ar puro, e total liberdade dentro da propriedade. Pedimos apenas que você nos avise no momento da reserva (quantidade e porte) e siga regras simples de convivência: pets fora dos sofás e camas, e supervisão em áreas comuns. Lembrete importante: enxoval manchado ou estofados danificados podem gerar taxa adicional, então uma toalha ou capa extra para o seu pet pode ser uma boa ideia.",
  },
  {
    q: "Como funciona o check-in?",
    a: "Check-in a partir das 15h, check-out até as 11h. Enviamos com antecedência um manual completo da casa, vídeos de chegada e instruções de acesso. Check-in antecipado ou check-out tardio podem ser solicitados mediante disponibilidade.",
  },
  {
    q: "Posso pagar parcelado?",
    a: "Sim. Aceitamos cartão de crédito em até 6x sem juros. Se preferir pagar à vista, oferecemos Pix com 3% de desconto. Cupons promocionais também são aceitos. O pagamento é integral no momento da reserva para garantir o bloqueio das datas.",
  },
  {
    q: "Qual a política de cancelamento?",
    a: "Cancelamento sem custo em até 7 dias após a confirmação da reserva, desde que reste pelo menos 24h antes do check-in. Reagendamentos podem ser solicitados com 15 dias de antecedência. Após esse prazo, o valor não é reembolsado.",
  },
  {
    q: "É preciso carro 4x4 ou SUV?",
    a: "Não são necessários. O acesso final tem no máximo 3,5km de estrada municipal de terra bem mantida que qualquer carro acessa bem em quaisquer condições, e a subida mais íngreme — já dentro da propriedade — é calçada.",
  },
  {
    q: "Crianças são bem-vindas?",
    a: "Absolutamente. Várias famílias se hospedaram conosco e adoraram. A área é segura, com gramado para brincar e vista incrível. Apenas avise no momento da reserva se houver crianças pequenas para que possamos preparar detalhes específicos.",
  },
  {
    q: "O que acontece se chover muito durante minha estadia?",
    a: "A casa foi pensada para ser excepcional em qualquer clima. Banheira e SPA aquecidos com vista, cozinha integrada para refeições demoradas, e (no Solarium 2) cinema com home theater para tardes inteiras. Muitos hóspedes preferem dias chuvosos pelo recolhimento e pela atmosfera da serra na neblina. Em situações climáticas extremas, conversamos sobre reagendamento.",
  },
  {
    q: "Posso fazer eventos ou comemorações na propriedade?",
    a: "Comemorações íntimas (aniversários, lua de mel, encontros especiais) são bem-vindas. Para eventos com mais convidados que a capacidade contratada, é necessário consulta prévia e contrato adicional. Festas barulhentas após 22h não são permitidas — somos um lugar de descanso.",
  },
];

export default function FAQ({ items = FAQ_ITEMS }: { items?: FAQItem[] }) {
  return (
    <div className="divide-y divide-charcoal/10 border-y border-charcoal/10">
      {items.map((item, i) => (
        <details key={i} className="group py-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-6">
            <h3 className="font-serif text-xl text-charcoal sm:text-2xl">{item.q}</h3>
            <Plus className="h-5 w-5 flex-shrink-0 text-copper transition-transform group-open:rotate-45" />
          </summary>
          <p className="mt-4 max-w-3xl font-sans text-base leading-relaxed text-charcoal/75">
            {item.a}
          </p>
        </details>
      ))}
    </div>
  );
}
