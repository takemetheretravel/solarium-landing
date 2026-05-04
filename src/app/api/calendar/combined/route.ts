import { NextRequest, NextResponse } from "next/server";
import { getCombinedCalendar } from "@/lib/hostaway";
import { PROPERTIES } from "@/config/properties";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const start = sp.get("start");
  const end = sp.get("end");
  if (!start || !end) {
    return NextResponse.json({ error: "Missing start/end" }, { status: 400 });
  }
  const ids = PROPERTIES.map((p) => p.id);
  const days = await getCombinedCalendar(ids, start, end);
  return NextResponse.json(
    { days },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } },
  );
}
