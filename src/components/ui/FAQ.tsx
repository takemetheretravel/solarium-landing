import { Plus } from "lucide-react";

export type FAQItem = { q: string; a: string };

export const FAQ_ITEMS: FAQItem[] = [
  {
    q: "Posso levar meu pet?",
    a: "Sim, somos pet friendly. Pedimos apenas que você nos avise no momento da reserva sobre quantidade e porte. Há regras simples para o conforto de todos: pets devem permanecer dentro da área privativa da casa, com coleira em áreas comuns, e não podem ficar em sofás ou camas.",
  },
  {
    q: "Como funciona o check-in?",
    a: "Check-in a partir das 15h, check-out até as 11h. Enviamos com antecedência um manual completo da casa, vídeos de chegada e instruções de acesso. Check-in antecipado ou check-out tardio podem ser solicitados mediante disponibilidade.",
  },
  {
    q: "Posso pagar parcelado?",
    a: "Sim. Aceitamos Pix (com 3% de desconto), cartão de crédito em até 6x sem juros, e cupons promocionais. O pagamento é integral no momento da reserva para garantir o bloqueio das datas.",
  },
  {
    q: "Qual a política de cancelamento?",
    a: "Cancelamento sem custo em até 7 dias após a confirmação da reserva, desde que reste pelo menos 24h antes do check-in (conforme CDC). Reagendamentos podem ser solicitados com 15 dias de antecedência. Após esse prazo, o valor não é reembolsado.",
  },
  {
    q: "É preciso carro 4x4 ou SUV?",
    a: "Não obrigatoriamente. O acesso final tem trecho de estrada de terra com subida íngreme. Carros comuns chegam tranquilamente em condições normais; em períodos de chuva forte, recomendamos veículos com tração mais alta. Enviamos vídeo do trajeto antes do check-in.",
  },
  {
    q: "Crianças são bem-vindas?",
    a: "Absolutamente. Várias famílias se hospedaram conosco e adoraram. A área é segura, com gramado para brincar e vista incrível. Apenas avise no momento da reserva se houver crianças pequenas para que possamos preparar detalhes específicos.",
  },
  {
    q: "O que acontece se chover muito durante minha estadia?",
    a: "A casa foi pensada para ser excepcional em qualquer clima. Banheira aquecida com vista, fire pit coberto, cozinha integrada, cinema (Solarium 2). Muitos hóspedes preferem dias chuvosos pelo recolhimento. Em situações extremas climáticas, conversamos sobre reagendamento.",
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
