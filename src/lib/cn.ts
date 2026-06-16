export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function formatBRLPrecise(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Preço de extra: sem símbolo de moeda, sem centavos. Ex: 180 → "180", 1280 → "1.280"
export function formatExtraPrice(value: number): string {
  return Math.round(value).toLocaleString("pt-BR");
}
