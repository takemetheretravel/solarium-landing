import { NextRequest, NextResponse } from "next/server";
import { getCalendar } from "@/lib/hostaway";
import { getPropertyBySlug, getPropertyById } from "@/config/properties";

export const runtime = "nodejs";
export const revalidate = 300;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const propertyParam = searchParams.get("property");
  const startDate = searchParams.get("start");
  const endDate = searchParams.get("end");

  if (!propertyParam || !startDate || !endDate) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  const idNum = Number(propertyParam);
  const property = Number.isFinite(idNum)
    ? getPropertyById(idNum)
    : getPropertyBySlug(propertyParam);
  if (!property) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const days = await getCalendar(property.id, startDate, endDate);
  const mapped = days.map((d) => ({
    date: d.date,
    isAvailable: d.isAvailable === 1,
    price: d.price,
    minimumStay: d.minimumStay,
    closedOnArrival: d.closedOnArrival === 1,
    closedOnDeparture: d.closedOnDeparture === 1,
  }));
  return NextResponse.json({ propertySlug: property.slug, days: mapped });
}
