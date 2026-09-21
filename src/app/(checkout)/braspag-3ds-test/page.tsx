import { notFound } from "next/navigation";
import Braspag3dsTestClient from "./Braspag3dsTestClient";

export const dynamic = "force-dynamic";

// GATE DE PRODUÇÃO: esta é uma página de TESTE/diagnóstico (inclui o painel
// "A1 — fluxo real (server)" que dispara /api/payments/braspag/credit de
// verdade). Em produção ela NÃO deve existir — 404, igual às rotas de API de
// teste. Server Component só para aplicar o gate antes de renderizar o client.
export default function Braspag3dsTestPage() {
  if (process.env.BRASPAG_ENVIRONMENT === "production") {
    notFound();
  }
  return <Braspag3dsTestClient />;
}
