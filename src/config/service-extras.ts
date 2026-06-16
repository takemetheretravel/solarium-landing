export type ServiceExtra = {
  id: string;
  label: string;
  price: number;          // por dia/sessão, para o casal
  perNight: boolean;      // true = multiplica pelas noites; false = valor único
  restriction?: string;   // aviso ao cliente (ex: dias/horário de entrega)
  note?: string;          // instrução interna p/ concierge no hostNote
};

export const SERVICE_EXTRAS: ServiceExtra[] = [
  {
    id: "cafe_cafecafe",
    label: "Cesta de café da manhã — Café Café (casal)",
    price: 180,
    perNight: true,
    restriction: "Entregas de segunda a sábado, a partir das 9h (não atende domingos).",
    note: "Acionar Café Café — entrega seg-sáb a partir das 9h",
  },
  {
    id: "cafe_diluia",
    label: "Cesta de café da manhã — Di.Luia (casal)",
    price: 280,
    perNight: true,
    note: "Acionar Di.Luia (@di.luia)",
  },
  {
    id: "cafe_dani",
    label: "Cesta de café da manhã — Dani Queijos e Frios (casal)",
    price: 260,
    perNight: true,
    note: "Acionar Dani Queijos e Frios (@daniqueijosefrios)",
  },
  {
    id: "massagem",
    label: "Sessão de massagem para o casal (60min)",
    price: 150,
    perNight: false,
    note: "Acionar terapeuta parceiro — agendar horário com o hóspede",
  },
];

// Ids das cestas de café — escondidas quando o pacote já inclui café (evita duplicar)
export const CAFE_EXTRA_IDS = ["cafe_cafecafe", "cafe_diluia", "cafe_dani"];

export function getServiceExtra(id: string) {
  return SERVICE_EXTRAS.find((e) => e.id === id);
}

export function serviceExtraTotal(id: string, nights: number): number {
  const e = getServiceExtra(id);
  if (!e) return 0;
  return e.perNight ? e.price * nights : e.price;
}

// Enriquece os serviceExtras do draft ({id,label,price}) com a note interna do config,
// para o hostNote e o email saberem qual parceiro acionar.
export function enrichServiceExtras(
  items?: { id: string; label: string; price: number }[],
): { id: string; label: string; price: number; note?: string }[] | undefined {
  if (!items?.length) return undefined;
  return items.map((e) => ({ ...e, note: getServiceExtra(e.id)?.note }));
}
