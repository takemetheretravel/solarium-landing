export type PaymentProvider = "cielo" | "braspag";

const PROVIDERS: PaymentProvider[] = ["cielo", "braspag"];

export class PaymentProviderIndefinido extends Error {
  constructor(valor: string | undefined) {
    super(
      valor
        ? `PAYMENT_PROVIDER="${valor}" não é válido. Use "cielo" ou "braspag".`
        : 'PAYMENT_PROVIDER não está definida neste ambiente. Defina "cielo" ou "braspag" e faça redeploy.',
    );
    this.name = "PaymentProviderIndefinido";
  }
}

/**
 * Gateway de pagamento do ambiente.
 *
 * NÃO tem default. Antes, qualquer valor diferente de "braspag" — inclusive a
 * variável ausente — virava Cielo em silêncio. Foi assim que três reservas de
 * teste de pacote rodaram na Cielo sem ninguém perceber: o Preview não tinha a
 * variável, e o fluxo nunca passou por 3DS, antifraude nem captura separada.
 *
 * Gateway escolhido por omissão é a mesma classe de erro da armadilha 1 do
 * handoff: o ambiente decide o que ninguém declarou. Agora falha explícito.
 */
export function getPaymentProvider(): PaymentProvider {
  const bruto = process.env.PAYMENT_PROVIDER?.trim().toLowerCase();
  if (!bruto || !PROVIDERS.includes(bruto as PaymentProvider)) {
    throw new PaymentProviderIndefinido(process.env.PAYMENT_PROVIDER);
  }
  return bruto as PaymentProvider;
}

/**
 * Versão que não derruba a requisição — para telas de diagnóstico, que precisam
 * mostrar o problema em vez de virar 500.
 */
export function getPaymentProviderSafe():
  | { ok: true; provider: PaymentProvider }
  | { ok: false; erro: string } {
  try {
    return { ok: true, provider: getPaymentProvider() };
  } catch (err) {
    return { ok: false, erro: (err as Error).message };
  }
}
