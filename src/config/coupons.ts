export type Coupon = {
  code: string;
  discount: number;
  type: "percentage" | "fixed";
  minNights: number;
  maxNights?: number;
  validFrom?: string;
  validUntil?: string;
  paymentMethods?: ("pix" | "card")[];
  properties?: string[];
  /** Limite máximo absoluto de parcelas (1..12). Acima disso, validateCoupon rejeita. */
  maxInstallments?: number;
  /** Até quantas parcelas SEM juros (apenas visual, não bloqueia). Default: 6. */
  installmentsWithoutInterest?: number;
  isPublic: boolean;
  description: string;
};

export const COUPONS: Coupon[] = [
  {
    code: "DUASNOITES",
    discount: 8,
    type: "percentage",
    minNights: 2,
    maxInstallments: 12,
    installmentsWithoutInterest: 6,
    isPublic: true,
    description: "8% de desconto em estadias de 2+ noites",
  },
  {
    code: "EXPERIENCIACOMPLETA",
    discount: 12,
    type: "percentage",
    minNights: 3,
    maxInstallments: 12,
    installmentsWithoutInterest: 6,
    isPublic: true,
    description: "12% de desconto em estadias de 3+ noites",
  },
  {
    code: "COMEMORACAO",
    discount: 17,
    type: "percentage",
    minNights: 5,
    maxInstallments: 12,
    installmentsWithoutInterest: 6,
    validFrom: "2026-01-01",
    validUntil: "2027-12-31",
    isPublic: true,
    description: "17% de desconto em estadias de 5+ noites",
  },
  {
    code: "PAULA15",
    discount: 15,
    type: "percentage",
    minNights: 1,
    maxInstallments: 12,
    installmentsWithoutInterest: 1,
    validFrom: "2026-01-01",
    validUntil: "2027-12-31",
    isPublic: false,
    description: "15% de desconto exclusivo",
  },
];

export type CouponValidation =
  | { valid: true; coupon: Coupon; discountAmount: number }
  | { valid: false; reason: string };

export type ValidateCouponContext = {
  nights: number;
  subtotal: number;
  paymentMethod?: "pix" | "card";
  propertySlug?: string;
  checkin?: string;
  installments?: number;
};

export function validateCoupon(code: string, context: ValidateCouponContext): CouponValidation {
  const normalized = code.trim().toUpperCase();
  const coupon = COUPONS.find((c) => c.code === normalized);
  if (!coupon) return { valid: false, reason: "Cupom não encontrado." };

  if (context.nights < coupon.minNights) {
    return {
      valid: false,
      reason: `Este cupom é válido para estadias de ${coupon.minNights}+ noites.`,
    };
  }
  if (coupon.maxNights && context.nights > coupon.maxNights) {
    return {
      valid: false,
      reason: `Este cupom é válido para estadias de até ${coupon.maxNights} noites.`,
    };
  }
  if (
    coupon.paymentMethods &&
    context.paymentMethod &&
    !coupon.paymentMethods.includes(context.paymentMethod)
  ) {
    const names = coupon.paymentMethods.map((m) => (m === "pix" ? "Pix" : "cartão")).join(" ou ");
    return { valid: false, reason: `Este cupom é válido apenas para pagamento via ${names}.` };
  }
  if (coupon.properties && context.propertySlug && !coupon.properties.includes(context.propertySlug)) {
    return { valid: false, reason: "Este cupom não é válido para esta propriedade." };
  }
  if (coupon.validFrom && context.checkin && context.checkin < coupon.validFrom) {
    return { valid: false, reason: "Este cupom ainda não está ativo." };
  }
  if (coupon.validUntil && context.checkin && context.checkin > coupon.validUntil) {
    return { valid: false, reason: "Este cupom expirou." };
  }
  if (
    coupon.maxInstallments !== undefined &&
    context.installments !== undefined &&
    context.paymentMethod === "card" &&
    context.installments > coupon.maxInstallments
  ) {
    return {
      valid: false,
      reason: `Este cupom permite parcelamento em até ${coupon.maxInstallments}x${coupon.maxInstallments === 1 ? " (à vista)" : ""}.`,
    };
  }

  const discountAmount =
    coupon.type === "percentage"
      ? context.subtotal * (coupon.discount / 100)
      : Math.min(coupon.discount, context.subtotal);
  return { valid: true, coupon, discountAmount };
}
