import { NextResponse } from "next/server";
import { diasSemChegada } from "@/lib/pricing/restricoes-chegada";
import { getPropertyBySlug } from "@/config/properties";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dias em que a casa não recebe chegada, num intervalo.
 *
 * CONVENIÊNCIA DE INTERFACE, não autoridade. Serve para o seletor marcar os
 * dias como não selecionáveis antes do hóspede tentar. Quem decide é o
 * servidor, no cálculo de preço e na criação do draft — esta rota pode falhar
 * ou ser ignorada sem abrir brecha de venda.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const property = (searchParams.get("property") || "").trim();
  const inicio = (searchParams.get("inicio") || "").trim();
  const fim = (searchParams.get("fim") || "").trim();

  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  if (!property || !ISO.test(inicio) || !ISO.test(fim)) {
    return NextResponse.json({ dias: [] });
  }
  if (!getPropertyBySlug(property)) {
    return NextResponse.json({ dias: [] });
  }

  const dias = await diasSemChegada(property, inicio, fim);
  return NextResponse.json({ dias });
}
