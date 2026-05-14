import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/hostaway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_URL = process.env.HOSTAWAY_API_BASE_URL || "https://api.hostaway.com/v1";

const BASE_BODY = {
  listingMapId: 316007,
  arrivalDate: "2099-12-10",
  departureDate: "2099-12-11",
  checkInTime: 15,
  checkOutTime: 11,
  numberOfGuests: 1,
  adults: 1,
  children: 0,
  infants: 0,
  guestFirstName: "Debug",
  guestLastName: "Test",
  guestEmail: "debug@test.com",
  phone: "+5500000000000",
  totalPrice: 1,
  currency: "BRL",
  isPaid: false,
  paymentStatus: "Unknown",
  guestNote: "DEBUG TEST - DELETE ME",
  status: "inquiry",
};

const ATTEMPTS = [
  {
    name: "1 - Sem channelId (omitido completamente)",
    body: { ...BASE_BODY },
  },
  {
    name: "2 - channelId: null",
    body: { ...BASE_BODY, channelId: null },
  },
  {
    name: "3 - source: solarium-direct (sem channelId)",
    body: { ...BASE_BODY, source: "solarium-direct" },
  },
  {
    name: "4 - channelId: 2000 + source: solarium-direct",
    body: { ...BASE_BODY, channelId: 2000, source: "solarium-direct" },
  },
  {
    name: "5 - channelId: 2013 + isPaid:false + status:inquiry",
    body: { ...BASE_BODY, channelId: 2013, status: "inquiry", isPaid: false },
  },
  {
    name: "6 - channelId: 2013 + status:confirmed + isPaid:true",
    body: { ...BASE_BODY, channelId: 2013, status: "confirmed", isPaid: true, paymentStatus: "Paid" },
  },
];

async function tryCancel(token: string, reservationId: number): Promise<{ status: number; body: unknown }> {
  try {
    // Try PATCH to cancelled first
    const patchRes = await fetch(`${BASE_URL}/reservations/${reservationId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify({ status: "cancelled" }),
    });
    const patchData = await patchRes.json().catch(() => ({}));
    return { status: patchRes.status, body: patchData };
  } catch (err) {
    return { status: -1, body: { error: (err as Error).message } };
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("key") !== "lucas2026") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 404 });
  }

  const token = await getAccessToken(true);
  if (!token) {
    return NextResponse.json({ error: "Não foi possível obter token Hostaway. Verificar credenciais." }, { status: 500 });
  }

  const results: Array<{
    name: string;
    bodySent: unknown;
    httpStatus: number;
    responseBody: unknown;
    success: boolean;
    reservationId?: number;
    cancelResult?: unknown;
  }> = [];

  for (const attempt of ATTEMPTS) {
    console.log(`[Debug:hostaway-reservation] Testando: ${attempt.name}`);

    let httpStatus = -1;
    let responseBody: unknown = null;
    let success = false;
    let reservationId: number | undefined;
    let cancelResult: unknown;

    try {
      const res = await fetch(`${BASE_URL}/reservations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
        },
        body: JSON.stringify(attempt.body),
        cache: "no-store",
      });

      httpStatus = res.status;
      responseBody = await res.json().catch(() => null);

      if (res.ok) {
        success = true;
        reservationId = (responseBody as { result?: { id?: number } })?.result?.id;
        console.log(`[Debug:hostaway-reservation] ✓ Criou reserva ${reservationId} com: ${attempt.name}`);
        // Cancel it immediately
        if (reservationId) {
          cancelResult = await tryCancel(token, reservationId);
          console.log(`[Debug:hostaway-reservation] Cancel result:`, JSON.stringify(cancelResult));
        }
      } else {
        console.log(`[Debug:hostaway-reservation] ✗ HTTP ${httpStatus} com: ${attempt.name}`);
        console.log(`[Debug:hostaway-reservation] Response:`, JSON.stringify(responseBody)?.slice(0, 300));
      }
    } catch (err) {
      responseBody = { error: (err as Error).message };
      console.error(`[Debug:hostaway-reservation] Exceção em: ${attempt.name}`, err);
    }

    results.push({
      name: attempt.name,
      bodySent: attempt.body,
      httpStatus,
      responseBody,
      success,
      ...(reservationId !== undefined ? { reservationId } : {}),
      ...(cancelResult !== undefined ? { cancelResult } : {}),
    });
  }

  const winners = results.filter((r) => r.success);
  const summary = {
    total: results.length,
    successCount: winners.length,
    winners: winners.map((r) => ({ name: r.name, reservationId: r.reservationId })),
    recommendation:
      winners.length > 0
        ? `✅ Usar: "${winners[0].name}"`
        : "❌ Nenhuma abordagem funcionou — verificar permissões ou listingMapId",
  };

  return NextResponse.json({ summary, results }, { status: 200 });
}
