import { NextResponse } from "next/server";
import { getChannels } from "@/lib/hostaway";
import { tokenAdminValido, naoEncontrado } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Header: Authorization: Bearer <ADMIN_API_TOKEN>
export async function GET(req: Request) {
  if (!tokenAdminValido(req)) return naoEncontrado();
  const channels = await getChannels();
  return NextResponse.json({ channels });
}
