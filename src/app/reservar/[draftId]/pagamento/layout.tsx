import { getPaymentProviderSafe } from "@/config/payment-provider";
import { fingerprintConfig, fingerprintTags, gerarFingerprintId } from "@/lib/braspag";
import { claimWebhookEventOnce } from "@/lib/kv-store";
import FingerprintCybersource from "./FingerprintCybersource";

// Um ProviderIdentifier novo por carregamento da página: nada de cache.
export const dynamic = "force-dynamic";

// Device fingerprint da Cybersource (ThreatMetrix). O identificador nasce aqui,
// no servidor, e é o MESMO no script, no noscript e no que a página envia à
// autorização (via contexto). Só este componente entra na rota — nenhum outro
// script de terceiros.
export default async function PagamentoLayout({ children }: { children: React.ReactNode }) {
  const provider = getPaymentProviderSafe();
  if (!provider.ok || provider.provider !== "braspag") return <>{children}</>;

  const cfg = fingerprintConfig();
  if (!cfg) {
    // Sem ProviderMerchantId o session_id sairia incompleto: não carrega nada.
    try {
      if (await claimWebhookEventOnce("alerta:fingerprint-sem-config", 86400)) {
        console.error(
          "[Braspag:fingerprint] BRASPAG_AF_PROVIDER_MERCHANT_ID ausente — checkout sem device fingerprint.",
        );
      }
    } catch {
      // alerta é acessório; a página segue.
    }
    return <>{children}</>;
  }

  const id = gerarFingerprintId();
  return (
    <FingerprintCybersource id={id} {...fingerprintTags(cfg, id)}>
      {children}
    </FingerprintCybersource>
  );
}
