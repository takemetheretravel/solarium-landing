import { Redis } from "@upstash/redis";

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

export async function limitarPorIp(
  chave: string,
  ip: string,
  maximo: number,
  janelaSegundos: number,
): Promise<ResultadoLimite> {
  const redis = redisOpcional();
  if (!redis) return { permitido: true };

  const k = `rl:${chave}:${ip}`;
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
