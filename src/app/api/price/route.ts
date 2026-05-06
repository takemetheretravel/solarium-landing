import { NextRequest, NextResponse } from "next/server";
import { calculatePriceDetailed } from "@/lib/hostaway";
import { getPropertyBySlug, getPropertyById } from "@/config/properties";
import { validateCoupon } from "@/config/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const propertyParam = searchParams.get("property");
  const checkin = searchParams.get("checkin");
  const checkout = searchParams.get("checkout");
  const guests = Number(searchParams.get("guests") || 2);
  const couponCode = searchParams.get("coupon") || "";
  const paymentMethod = searchParams.get("payment") || "card";

  if (!propertyParam || !checkin || !checkout) {
    return NextResponse.json({ ok: false, error: "Missing parameters" }, { status: 400 });
  }

  const idNum = Number(propertyParam);
  const property = Number.isFinite(idNum)
    ? getPropertyById(idNum)
    : getPropertyBySlug(propertyParam);
  if (!property) {
    return NextResponse.json({ ok: false, error: "Property not found" }, { status: 404 });
  }

  const result = await calculatePriceDetailed(property.id, checkin, checkout, guests);
  if ("failure" in result) {
    return NextResponse.json(
      {
        ok: false,
        failure: result.failure,
        propertySlug: property.slug,
      },
      { status: result.failure.reason === "api-error" ? 502 : 200 },
    );
  }

  const quote = result.quote;

  let couponApplied: { code: string; description: string; discount: number } | null = null;
  let couponError: string | null = null;
  let runningTotal = quote.totalPrice;

  if (couponCode) {
    const v = validateCoupon(couponCode, quote.nights, quote.totalPrice);
    if (v.valid) {
      couponApplied = {
        code: v.coupon.code,
        description: v.coupon.description,
        discount: v.discountAmount,
      };
      runningTotal = Math.max(0, runningTotal - v.discountAmount);
    } else {
      couponError = v.reason;
    }
  }

  let pixDiscount = 0;
  if (paymentMethod === "pix") {
    pixDiscount = runningTotal * 0.03;
    runningTotal = runningTotal - pixDiscount;
  }

  return NextResponse.json({
    ok: true,
    propertySlug: property.slug,
    propertyId: property.id,
    propertyName: property.name,
    nights: quote.nights,
    averageNightly: quote.averageNightly,
    cleaningFee: quote.cleaningFee,
    extraGuestFee: quote.extraGuestFee,
    discount: quote.discount,
    baseTotal: quote.baseTotal,
    hostawayTotal: quote.totalPrice,
    coupon: couponApplied,
    couponError,
    paymentMethod,
    pixDiscount,
    finalTotal: runningTotal,
    currency: quote.currency,
  });
}
