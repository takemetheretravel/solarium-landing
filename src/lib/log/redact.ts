/**
 * Redação de campos sensíveis antes de qualquer console.log do fluxo de
 * pagamento. Os logs de produção da Vercel são exportáveis por quem tem acesso
 * ao projeto — nada que identifique cartão, credencial, estabelecimento ou
 * antifraude pode chegar até lá.
 */

/**
 * Chaves proibidas em log. Comparação case-insensitive e por igualdade do nome
 * da chave (não por substring), para não derrubar campos legítimos por acaso.
 */
export const CHAVES_PROIBIDAS = [
  // Cartão
  "cardnumber",
  "cardbin",
  "bin",
  "cvv",
  "securitycode",
  "expirationdate",
  "cardexpiration",
  "holder",
  "cardholder",
  "pan",
  // Credenciais / identificação do lojista
  "merchantid",
  "merchantkey",
  "clientid",
  "clientsecret",
  "clientidlen",
  "secretlen",
  "secretendswitheq",
  "establishmentcode",
  "accesstoken",
  "access_token",
  "authorization",
  "secret",
  "token",
  "apikey",
  "api_key",
  // Antifraude
  "fraudanalysisid",
  "fraudscore",
  "fraudanalysisreasoncode",
  "browserfingerprint",
  "fingerprintid",
  "providermerchantid",
] as const;

const PROIBIDAS = new Set<string>(CHAVES_PROIBIDAS.map((k) => k.toLowerCase()));

/** Campos que ficam, mas mascarados (só o suficiente para conferência humana). */
const MASCARAR = new Set<string>(["cardlast4", "last4", "guestcpf", "cpf", "identity"]);

function mascarar(valor: unknown): unknown {
  const s = String(valor ?? "");
  if (s.length <= 4) return s;
  return `***${s.slice(-4)}`;
}

/**
 * Remove recursivamente as chaves proibidas de um objeto (arrays inclusos) e
 * mascara as de conferência. Não muta a entrada.
 *
 * `extras` acrescenta chaves proibidas específicas de um ponto de chamada.
 */
export function redact<T>(valor: T, extras: string[] = []): T {
  let proibidas = PROIBIDAS;
  if (extras.length) {
    proibidas = new Set<string>(CHAVES_PROIBIDAS.map((k) => k.toLowerCase()));
    for (const e of extras) proibidas.add(e.toLowerCase());
  }
  return redactInterno(valor, proibidas, 0) as T;
}

function redactInterno(valor: unknown, proibidas: Set<string>, nivel: number): unknown {
  if (nivel > 8) return "[profundo demais]";
  if (valor === null || typeof valor !== "object") return valor;
  if (Array.isArray(valor)) return valor.map((v) => redactInterno(v, proibidas, nivel + 1));

  const saida: Record<string, unknown> = {};
  for (const [chave, v] of Object.entries(valor as Record<string, unknown>)) {
    const k = chave.toLowerCase();
    if (proibidas.has(k)) continue;
    if (MASCARAR.has(k)) {
      saida[chave] = mascarar(v);
      continue;
    }
    saida[chave] = redactInterno(v, proibidas, nivel + 1);
  }
  return saida;
}

/**
 * console.log de um payload do fluxo de pagamento, já redigido e serializado.
 * Único caminho permitido para logar objeto de pagamento.
 */
export function logSeguro(rotulo: string, payload: unknown, extras: string[] = []): void {
  console.log(`${rotulo} ${JSON.stringify(redact(payload, extras))}`);
}

/** Mesma coisa em nível de erro. */
export function logErroSeguro(rotulo: string, payload: unknown, extras: string[] = []): void {
  console.error(`${rotulo} ${JSON.stringify(redact(payload, extras))}`);
}
