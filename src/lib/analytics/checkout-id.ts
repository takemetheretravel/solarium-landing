"use client";

/**
 * Identificador da TENTATIVA de checkout.
 *
 * `begin_checkout` é disparado no clique do CTA "Reservar", e nesse instante
 * ainda não existe draft nem reserva — não há identificador canônico para
 * carregar. Este id nasce no clique, viaja com o hóspede até a criação do draft
 * e fica gravado nele, o que permite ligar a intenção medida à reserva que
 * eventualmente saiu dela.
 *
 * Escopo de aba (`sessionStorage`): não é identidade de pessoa nem sobrevive ao
 * fechamento do navegador.
 */

const CHAVE = "solarium:checkout_id";

function novoId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `co_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Abre uma tentativa nova. Chamar no clique do CTA, nunca depois. */
export function iniciarCheckoutId(): string {
  const id = novoId();
  if (typeof window === "undefined") return id;
  try {
    window.sessionStorage.setItem(CHAVE, id);
  } catch {
    // sem sessionStorage: o id vale só para o evento deste clique.
  }
  return id;
}

/** Recupera a tentativa em curso. `null` quando o hóspede chegou por link direto. */
export function lerCheckoutId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(CHAVE);
  } catch {
    return null;
  }
}
