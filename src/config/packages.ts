import { imageUrl } from "@/lib/cloudinary";

export type PackageExtraChoice = { label: string; price: number };
export type PackageExtra = {
  label: string;
  price: number;
  perNight?: boolean;
  choices?: PackageExtraChoice[];
  removable?: boolean; // default false — cliente pode tirar este item do pacote
};

export type PackageConfig = {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  image: string;
  properties: string[];          // slugs elegíveis
  nights: number;                // noites exatas
  weekdaysOnly: boolean;         // true = todas as noites seg-qui (checkin seg-qua p/ 3n etc.)
  stayDiscountPct: number;       // desconto sobre o total Hostaway da estadia
  extras: PackageExtra[];        // cobrados a preço fixo, somados ao total
  included: string[];            // bullets do que está incluído (copy)
};

// Feriados 2026 — noites bloqueadas para pacotes (ranges [primeira noite, última noite])
export const HOLIDAY_RANGES_2026: [string, string][] = [
  ["2026-02-14", "2026-02-17"], // Carnaval
  ["2026-04-18", "2026-04-20"], // Tiradentes
  ["2026-05-01", "2026-05-02"], // Dia do Trabalho
  ["2026-06-04", "2026-06-06"], // Corpus Christi
  ["2026-09-05", "2026-09-06"], // Independência
  ["2026-10-10", "2026-10-11"], // N. S. Aparecida
  ["2026-10-31", "2026-11-01"], // Finados
  ["2026-11-13", "2026-11-14"], // Proclamação
  ["2026-12-23", "2026-12-25"], // Natal
  ["2026-12-30", "2027-01-01"], // Réveillon
];

export const PACKAGES: PackageConfig[] = [
  {
    slug: "meio-de-semana",
    name: "Meio de Semana na Serra",
    tagline: "Três manhãs de café com vista, sem pressa e sem multidão.",
    description: "Três noites durante a semana, quando a serra está mais silenciosa, com a cesta de café da manhã do Café Café servida nas três manhãs. Você só escolhe as datas — o resto é com a gente.",
    image: imageUrl("solarium/experiencias/cesta-cafe-preparada", { width: 1200, height: 900 }),
    properties: ["solarium-1", "solarium-2"],
    nights: 3,
    weekdaysOnly: true,
    stayDiscountPct: 12,
    extras: [{ label: "Cesta de café da manhã Café Café (casal)", price: 180, perNight: true }],
    included: [
      "3 noites em casa completa e exclusiva",
      "Cesta de café da manhã Café Café nas 3 manhãs (para o casal)",
      "Concierge para personalizar a estadia",
    ],
  },
  {
    slug: "imersao-na-serra",
    name: "Imersão na Serra",
    tagline: "Quatro noites, café todas as manhãs e a serra de quadriciclo.",
    description: "Quatro noites de semana com café da manhã servido todos os dias e um passeio de quadriciclo até a Cachoeira da Gomeira. A experiência completa da Mantiqueira, organizada em uma reserva só.",
    image: imageUrl("solarium/experiencias/cachoeira", { width: 1200, height: 900 }),
    properties: ["solarium-1", "solarium-2"],
    nights: 4,
    weekdaysOnly: true,
    stayDiscountPct: 12,
    extras: [
      { label: "Cesta de café da manhã Café Café (casal)", price: 180, perNight: true },
      { label: "Passeio de quadriciclo — Cachoeira da Gomeira (~2h)", price: 300 },
    ],
    included: [
      "4 noites em casa completa e exclusiva",
      "Cesta de café da manhã nas 4 manhãs (para o casal)",
      "Passeio de quadriciclo até a Cachoeira da Gomeira",
      "Concierge para personalizar a estadia",
    ],
  },
  {
    slug: "data-especial",
    name: "Data Especial",
    tagline: "Aniversário, pedido, celebração — preparamos tudo antes de vocês chegarem.",
    description: "Duas noites com a casa preparada para a ocasião: decoração romântica na chegada, cesta de café da manhã Di.Luia e espumante gelado. Vocês chegam, e o momento já está pronto.",
    image: imageUrl("solarium/experiencias/decoracao-romantica", { width: 1200, height: 900 }),
    properties: ["solarium-1", "solarium-2"],
    nights: 2,
    weekdaysOnly: false,
    stayDiscountPct: 8,
    extras: [
      { label: "Decoração romântica (coração de pétalas, velas eletrônicas, buquê de rosas e balões de coração)", price: 350 },
      {
        label: "Cesta de café da manhã (escolha do casal)",
        price: 280,
        choices: [
          { label: "Cesta Di.Luia", price: 280 },
          { label: "Cesta Dani Queijos e Frios", price: 280 },
        ],
      },
      { label: "Espumante Chandon Reserve Brut", price: 140, removable: true },
    ],
    included: [
      "2 noites em casa completa e exclusiva",
      "Decoração romântica na chegada: coração de pétalas, velas eletrônicas, buquê de rosas e balões de coração",
      "Cesta de café da manhã à sua escolha: Di.Luia ou Dani Queijos e Frios",
      "Espumante Chandon gelado na chegada",
      "Concierge para pedidos especiais",
    ],
  },
];

export function getPackageBySlug(slug: string) {
  return PACKAGES.find((p) => p.slug === slug);
}

export function extrasTotal(pkg: PackageConfig): number {
  return pkg.extras.reduce((sum, e) => sum + e.price * (e.perNight ? pkg.nights : 1), 0);
}

// Valida datas: noites exatas, weekdaysOnly (todas as noites seg-qui), sem feriados
export function validatePackageDates(pkg: PackageConfig, checkin: string, checkout: string):
  { valid: true } | { valid: false; reason: string } {
  const nights: string[] = [];
  const d = new Date(checkin + "T12:00:00");
  const end = new Date(checkout + "T12:00:00");
  while (d < end) {
    nights.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  if (nights.length !== pkg.nights) {
    return { valid: false, reason: `Este pacote é de exatamente ${pkg.nights} noites.` };
  }
  if (pkg.weekdaysOnly) {
    const hasWeekend = nights.some((n) => {
      const day = new Date(n + "T12:00:00").getDay();
      return day === 5 || day === 6; // sex ou sáb
    });
    if (hasWeekend) return { valid: false, reason: "Este pacote é válido para noites de segunda a quinta." };
  }
  const inHoliday = nights.some((n) =>
    HOLIDAY_RANGES_2026.some(([start, endH]) => n >= start && n <= endH)
  );
  if (inHoliday) return { valid: false, reason: "Este pacote não está disponível em feriados. Fale com o concierge para datas de feriado." };
  return { valid: true };
}

// Arredonda para a dezena abaixo (ex.: 3.487 → 3.480)
export function round10down(v: number): number {
  return Math.floor(v / 10) * 10;
}

// Total do pacote para um preço de estadia Hostaway já conhecido
export function packageTotal(pkg: PackageConfig, hostawayTotal: number): number {
  const stay = round10down(hostawayTotal * (1 - pkg.stayDiscountPct / 100));
  return stay + extrasTotal(pkg);
}

// Extra ativo: fixos (sem removable) sempre contam; removíveis só se constam em activeLabels.
// activeLabels === null → nenhuma remoção informada, mantém tudo.
export function isExtraActive(extra: PackageExtra, activeLabels: string[] | null): boolean {
  if (!extra.removable) return true;
  if (!activeLabels) return true;
  return activeLabels.includes(extra.label);
}

export function extrasTotalActive(pkg: PackageConfig, activeLabels: string[] | null): number {
  return pkg.extras
    .filter((e) => isExtraActive(e, activeLabels))
    .reduce((sum, e) => sum + e.price * (e.perNight ? pkg.nights : 1), 0);
}

// Total com a base de extras ativos (removíveis omitidos saem dos dois lados do cálculo)
export function packageTotalActive(
  pkg: PackageConfig,
  hostawayTotal: number,
  activeLabels: string[] | null,
): number {
  const stay = round10down(hostawayTotal * (1 - pkg.stayDiscountPct / 100));
  return stay + extrasTotalActive(pkg, activeLabels);
}
