import { NextResponse } from "next/server";
import { getPaymentProviderSafe } from "@/config/payment-provider";
import { getDraft } from "@/lib/kv-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Expõe a flag PAYMENT_PROVIDER ao cliente (não é segredo). A página de
// pagamento decide o caminho (cielo vs braspag). NÃO há default: ambiente sem a
// variável responde 503 com o motivo, em vez de escolher gateway em silêncio.
// `sandbox` habilita o checkbox de teste do caminho Braspag; em produção vem
// false e o checkbox nem renderiza.
//
// `?draftId=` faz a rota respeitar o `provider_forcado` daquele draft, gravado
// pelo fallback automático no segundo bloqueio do antifraude. É a ÚNICA coisa
// que sobrepõe a configuração global, e vale só para o draft em questão — a
// flag continua mandando em todo o resto.
export async function GET(req: Request) {
  const r = getPaymentProviderSafe();
  if (!r.ok) {
    console.error("[provider]", r.erro);
    return NextResponse.json({ error: r.erro, provider: null }, { status: 503 });
  }

  const sandbox = process.env.BRASPAG_ENVIRONMENT !== "production";
  const draftId = new URL(req.url).searchParams.get("draftId")?.trim();

  if (draftId) {
    // Best-effort: draft expirado ou Redis fora cai na flag global. Uma falha
    // de leitura aqui não pode deixar a tela de pagamento sem gateway nenhum.
    const draft = await getDraft(draftId).catch(() => null);
    const forcado = draft?.provider_forcado;
    if (forcado && forcado !== r.provider) {
      console.log(
        `[provider] draftId=${draftId} usando provider_forcado=${forcado} ` +
          `(global=${r.provider})`,
      );
      return NextResponse.json({ provider: forcado, sandbox, forcado: true });
    }
  }

  return NextResponse.json({ provider: r.provider, sandbox, forcado: false });
}
