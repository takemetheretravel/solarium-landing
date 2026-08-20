import { Redis } from "@upstash/redis";
import { createHash, timingSafeEqual } from "crypto";

/**
 * Limite por IP, janela deslizante simples com contador no Upstash.
 *
 * `/api/pacotes/preco` é público e a agente de atendimento consulta de verdade —
 * o limite precisa ser generoso o bastante para não atrapalhar quem cota, e
 * apertado o bastante para tornar raspagem de tarifa cara.
 *
 * Sem Redis configurado, NÃO bloqueia: uma indisponibilidade de infraestrutura
 * não pode derrubar a cotação do site.
 */
export type ResultadoLimite = { permitido: true } | { permitido: false; esperaSegundos: number };

function redisOpcional(): Redis | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  if (!url || !token) return null;
  try {
    return new Redis({ url, token });
  } catch {
    return null;
  }
}

export async function limitarPorChave(
  chave: string,
  identidade: string,
  maximo: number,
  janelaSegundos: number,
): Promise<ResultadoLimite> {
  const redis = redisOpcional();
  if (!redis) return { permitido: true };

  const k = `rl:${chave}:${identidade}`;
  try {
    const n = await redis.incr(k);
    if (n === 1) await redis.expire(k, janelaSegundos);
    if (n > maximo) {
      const ttl = await redis.ttl(k);
      return { permitido: false, esperaSegundos: ttl > 0 ? ttl : janelaSegundos };
    }
    return { permitido: true };
  } catch (err) {
    // Falha do Redis nunca bloqueia a cotação.
    console.warn("[rate-limit] indisponível, liberando:", err);
    return { permitido: true };
  }
}

/** IP do cliente atrás do proxy da Vercel. */
export function ipDaRequisicao(req: Request): string {
  const h = req.headers;
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "desconhecido"
  );
}

/**
 * Quem está chamando: serviço autenticado ou tráfego anônimo.
 *
 * O agente de atendimento sai por poucos IPs, e um limite por IP transformaria
 * vizinhança em 429. Com token, o limite é dele e é mais alto; sem token, o
 * limite por IP continua valendo igual.
 *
 * O segredo vive só em variável de ambiente. Sem `PACOTES_API_TOKEN` configurado
 * nenhuma requisição é tratada como autenticada — ninguém vira serviço por acaso.
 */
export type Chamador = {
  tipo: "servico" | "anonimo";
  /** Chave do contador: id do token ou IP. */
  identidade: string;
};

export function identificarChamador(req: Request): Chamador {
  const esperado = process.env.PACOTES_API_TOKEN || "";
  const recebido = tokenDoHeader(req);

  if (esperado && recebido && igualEmTempoConstante(recebido, esperado)) {
    // Nunca usar o segredo como chave do Redis: um hash curto identifica sem
    // guardar o valor em lugar nenhum.
    const id = createHash("sha256").update(esperado).digest("hex").slice(0, 12);
    return { tipo: "servico", identidade: `svc:${id}` };
  }

  return { tipo: "anonimo", identidade: ipDaRequisicao(req) };
}

function tokenDoHeader(req: Request): string {
  const auth = req.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return (req.headers.get("x-api-token") || "").trim();
}

function igualEmTempoConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
