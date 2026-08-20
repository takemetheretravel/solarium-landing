import { imageUrl } from "@/lib/cloudinary";
import { JANELAS_BLOQUEADAS } from "./precos-e-extras";

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

/**
 * Janelas bloqueadas do motor antigo. A lista vive em `precos-e-extras.ts`, junto
 * com o resto da configuração de pacote — aqui é só o nome herdado.
 */
export const HOLIDAY_RANGES_2026 = JANELAS_BLOQUEADAS;

export const PACKAGES: PackageConfig[] = [
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
