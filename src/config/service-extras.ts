export type ServiceExtra = {
  id: string;
  label: string;
  price: number;          // por unidade, para o casal
  restriction?: string;   // aviso ao cliente (ex: dias/horário de entrega)
  note?: string;          // instrução interna p/ concierge no hostNote
};

export const SERVICE_EXTRAS: ServiceExtra[] = [
  {
    id: "cafe_cafecafe",
    label: "Cesta de café da manhã — Café Café",
    price: 180,
    restriction: "Entregas de segunda a sábado, a partir das 9h (não atende domingos).",
    note: "Acionar Café Café — entrega seg-sáb a partir das 9h",
  },
  {
    id: "cafe_diluia",
    label: "Cesta de café da manhã — Di.Luia",
    price: 280,
    note: "Acionar Di.Luia (@di.luia)",
  },
  {
    id: "cafe_dani",
    label: "Cesta de café da manhã — Dani Queijos e Frios",
    price: 260,
    note: "Acionar Dani Queijos e Frios (@daniqueijosefrios)",
  },
  {
    id: "massagem",
    label: "Sessão de massagem para o casal (60min)",
    price: 150,
    note: "Acionar terapeuta parceiro — agendar horário com o hóspede",
  },
];

export const MAX_QTY_PER_EXTRA = 10;

// Ids das cestas de café — escondidas quando o pacote já inclui café (evita duplicar)
export const CAFE_EXTRA_IDS = ["cafe_cafecafe", "cafe_diluia", "cafe_dani"];

export function getServiceExtra(id: string) {
  return SERVICE_EXTRAS.find((e) => e.id === id);
}

// Quantidade é INDEPENDENTE das noites: total = price × qty (qty clampada 0..MAX).
// O concierge alinha a distribuição depois (registrado no hostNote).
export function serviceExtraTotal(id: string, qty: number): number {
  const e = getServiceExtra(id);
  if (!e || qty <= 0) return 0;
  const safeQty = Math.min(Math.max(0, Math.floor(qty)), MAX_QTY_PER_EXTRA);
  return e.price * safeQty;
}

// Enriquece os serviceExtras do draft ({id,label,qty,price}) com a note interna do config,
// para o hostNote e o email saberem qual parceiro acionar.
export function enrichServiceExtras(
  items?: { id: string; label: string; qty: number; price: number }[],
): { id: string; label: string; qty: number; price: number; note?: string }[] | undefined {
  if (!items?.length) return undefined;
  return items.map((e) => ({ ...e, note: getServiceExtra(e.id)?.note }));
}
