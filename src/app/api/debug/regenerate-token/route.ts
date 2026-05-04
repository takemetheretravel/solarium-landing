import { NextRequest, NextResponse } from "next/server";
import { clearTokenCache } from "@/lib/hostaway";

const DEBUG_KEY = "lucas2026";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const key = String(form.get("key") || "");
  const redirect = String(form.get("redirect") || "/");
  if (key !== DEBUG_KEY) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  clearTokenCache();
  return NextResponse.redirect(new URL(redirect, req.url), { status: 303 });
}
