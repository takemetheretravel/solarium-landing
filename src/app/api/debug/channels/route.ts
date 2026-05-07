import { NextResponse } from "next/server";
import { getChannels } from "@/lib/hostaway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("key") !== "lucas2026") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 404 });
  }
  const channels = await getChannels();
  return NextResponse.json({ channels });
}
