export type PaymentProvider = "cielo" | "braspag";

// Flag de provider. Default = "cielo" (produção atual intacta).
// Para ativar a Braspag, definir PAYMENT_PROVIDER=braspag no ambiente.
export function getPaymentProvider(): PaymentProvider {
  return process.env.PAYMENT_PROVIDER === "braspag" ? "braspag" : "cielo";
}
