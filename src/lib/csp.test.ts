import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { NextRequest } from "next/server";

// Rodada PAG1b — CSP report-only na página de pagamento e /api/csp-report.

// Redis em memória: só o que as funções de CSP usam.
const redis = vi.hoisted(() => {
  const kv = new Map<string, unknown>();
  const hash = (k: string) => {
    if (!kv.has(k)) kv.set(k, {} as Record<string, number>);
    return kv.get(k) as Record<string, number>;
  };
  const lista = (k: string) => {
    if (!kv.has(k)) kv.set(k, [] as string[]);
    return kv.get(k) as string[];
  };
  const ops = {
    incr: (k: string) => {
      const n = Number(kv.get(k) ?? 0) + 1;
      kv.set(k, n);
      return n;
    },
    expire: () => 1,
    hincrby: (k: string, campo: string, n: number) => (hash(k)[campo] = (hash(k)[campo] ?? 0) + n),
    lpush: (k: string, v: string) => lista(k).unshift(v),
    ltrim: (k: string, a: number, b: number) => {
      kv.set(k, lista(k).slice(a, b + 1));
      return "OK";
    },
  };
  const api = {
    kv,
    falhar: false,
    pipeline() {
      const fila: (() => unknown)[] = [];
      const p = new Proxy(
        {},
        {
          get: (_t, nome: string) => {
            if (nome === "exec")
              return async () => {
                if (api.falhar) throw new Error("redis fora");
                return fila.map((f) => f());
              };
            return (...args: unknown[]) => {
              fila.push(() => (ops as Record<string, (...a: unknown[]) => unknown>)[nome](...args));
              return p;
            };
          },
        },
      );
      return p;
    },
    async hgetall(k: string) {
      return (kv.get(k) as Record<string, number>) ?? null;
    },
    async lrange(k: string, a: number, b: number) {
      return ((kv.get(k) as string[]) ?? []).slice(a, b + 1);
    },
  };
  return api;
});

vi.mock("@upstash/redis", () => ({
  Redis: class {
    constructor() {
      return redis;
    }
  },
}));

import { middleware, config } from "@/middleware";
import { higienizarRelatorio, politicaPagamento } from "@/lib/csp";
import { POST as cspReport } from "@/app/api/csp-report/route";
import { GET as adminCsp } from "@/app/api/admin/csp/route";
import { CSP_TAXA_POR_ORIGEM_POR_MINUTO } from "@/lib/kv-store";

const envOriginal = { ...process.env };
beforeEach(() => {
  process.env.KV_REST_API_URL = "https://kv.teste";
  process.env.KV_REST_API_TOKEN = "t";
  redis.kv.clear();
  redis.falhar = false;
});
afterEach(() => {
  process.env = { ...envOriginal };
  vi.restoreAllMocks();
});

const HEADER = "content-security-policy-report-only";

// ===========================================================================
describe("header CSP-Report-Only", () => {
  it("presente na página de pagamento, com nonce e endpoint de relatório", () => {
    const res = middleware(new NextRequest("https://solariummantiqueira.com/reservar/abc123/pagamento"));
    const csp = res.headers.get(HEADER);
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]{24}'/);
    expect(csp).toContain("report-uri /api/csp-report");
    expect(csp).toContain("report-to csp-endpoint");
    expect(res.headers.get("reporting-endpoints")).toBe('csp-endpoint="https://solariummantiqueira.com/api/csp-report"');
    // Nunca em modo bloqueante.
    expect(res.headers.get("content-security-policy")).toBeNull();
    // O nonce segue no request para o Next marcar os scripts inline dele.
    expect(res.headers.get(`x-middleware-request-${HEADER}`)).toBe(csp);
  });

  it("um nonce novo por resposta", () => {
    const req = () => middleware(new NextRequest("https://x.com/reservar/abc/pagamento")).headers.get(HEADER);
    expect(req()).not.toBe(req());
  });

  it.each(["/", "/reservar", "/reservar/abc/confirmacao", "/pacotes", "/braspag-3ds-test", "/reservar/abc/pagamento/x", "/api/csp-report"])(
    "ausente em %s",
    (rota) => {
      const res = middleware(new NextRequest(`https://x.com${rota}`));
      expect(res.headers.get(HEADER)).toBeNull();
      expect(res.headers.get("content-security-policy")).toBeNull();
    },
  );

  it("o matcher só cobre a página de pagamento", () => {
    expect(config.matcher).toEqual(["/reservar/:draftId/pagamento"]);
  });

  it("next.config não aplica CSP em lugar nenhum", () => {
    const cfg = readFileSync(path.resolve(__dirname, "../../next.config.mjs"), "utf-8");
    expect(cfg).not.toMatch(/Content-Security-Policy/i);
  });

  it("allowlist sem curinga amplo, sem unsafe-inline em script, com ThreatMetrix e 3DS", () => {
    const csp = politicaPagamento("n");
    expect(csp).not.toMatch(/\*|\shttps:(\s|;|$)|\sdata:\s.*script/);
    const script = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(script).toContain("https://h.online-metrix.net");
    expect(script).toContain("https://mpi.braspag.com.br");
    expect(csp).not.toMatch(/googletagmanager|google-analytics|facebook/);
    expect(politicaPagamento("n", { dev: true })).toContain("'unsafe-eval'");
  });
});

// ===========================================================================
function relatorio(corpo: unknown, headers: Record<string, string> = {}) {
  return new Request("https://solariummantiqueira.com/api/csp-report", {
    method: "POST",
    headers: { "content-type": "application/csp-report", "x-forwarded-for": "203.0.113.9", ...headers },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
}

const VIOLACAO_LEGADA = {
  "csp-report": {
    "document-uri": "https://solariummantiqueira.com/reservar/draft-secreto-42/pagamento?cupom=X",
    "violated-directive": "script-src-elem",
    "effective-directive": "script-src-elem",
    "blocked-uri": "https://www.googletagmanager.com/gtag/js?id=G-9J8F6Q1Y2M&email=maria@exemplo.com",
    "source-file": "https://solariummantiqueira.com/_next/static/chunks/app.js?cpf=12345678909",
    "script-sample": "var cartao='4111111111111111'",
    disposition: "report",
  },
};

describe("/api/csp-report", () => {
  it("grava contagem por diretiva e por origem bloqueada e responde 204", async () => {
    const res = await cspReport(relatorio(VIOLACAO_LEGADA));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(redis.kv.get("csp:diretiva")).toEqual({ "script-src-elem": 1 });
    expect(redis.kv.get("csp:bloqueado")).toEqual({ "https://www.googletagmanager.com": 1 });
    expect((redis.kv.get("csp:recentes") as string[]).length).toBe(1);
  });

  it("não guarda dado pessoal, path, query, trecho de código nem draftId", async () => {
    await cspReport(relatorio(VIOLACAO_LEGADA));
    const gravado = JSON.stringify(Array.from(redis.kv.entries()).filter(([k]) => !k.startsWith("csp:taxa:")));
    for (const proibido of ["maria@exemplo.com", "12345678909", "4111", "draft-secreto-42", "cupom", "gtag/js", "G-9J8F6Q1Y2M", "app.js", "203.0.113.9"]) {
      expect(gravado).not.toContain(proibido);
    }
    const [recente] = (redis.kv.get("csp:recentes") as string[]).map((s) => JSON.parse(s));
    expect(recente).toMatchObject({
      diretiva: "script-src-elem",
      bloqueado: "https://www.googletagmanager.com",
      origemScript: "https://solariummantiqueira.com",
      pagina: "/reservar/[draftId]/pagamento",
      disposicao: "report",
    });
    expect(Object.keys(recente).sort()).toEqual(["bloqueado", "diretiva", "disposicao", "origemScript", "pagina", "ts"]);
  });

  it("aceita o formato reports+json (report-to)", async () => {
    const corpo = [
      {
        type: "csp-violation",
        body: {
          documentURL: "https://solariummantiqueira.com/reservar/d1/pagamento",
          effectiveDirective: "script-src-elem",
          blockedURL: "inline",
          sample: "segredo",
          disposition: "report",
        },
      },
      { type: "deprecation", body: { message: "x" } },
    ];
    expect(await cspReport(relatorio(corpo, { "content-type": "application/reports+json" }))).toHaveProperty("status", 204);
    expect(redis.kv.get("csp:bloqueado")).toEqual({ inline: 1 });
  });

  it("corpo acima de 16 KB: descarta sem gravar e responde 204", async () => {
    const grande = { "csp-report": { ...VIOLACAO_LEGADA["csp-report"], "script-sample": "x".repeat(17 * 1024) } };
    const res = await cspReport(relatorio(grande));
    expect(res.status).toBe(204);
    expect(redis.kv.has("csp:diretiva")).toBe(false);
  });

  it("content-length declarado acima do limite: nem lê", async () => {
    const res = await cspReport(relatorio(VIOLACAO_LEGADA, { "content-length": String(1024 * 1024) }));
    expect(res.status).toBe(204);
    expect(redis.kv.size).toBe(0);
  });

  it.each([["JSON inválido", "{nao é json"], ["vazio", ""], ["formato estranho", { qualquer: 1 }]])("%s: 204 sem gravar", async (_n, corpo) => {
    const res = await cspReport(relatorio(corpo));
    expect(res.status).toBe(204);
    expect(redis.kv.has("csp:diretiva")).toBe(false);
  });

  it("limita a taxa por remetente", async () => {
    for (let i = 0; i < CSP_TAXA_POR_ORIGEM_POR_MINUTO + 10; i++) {
      expect((await cspReport(relatorio(VIOLACAO_LEGADA))).status).toBe(204);
    }
    expect(redis.kv.get("csp:diretiva")).toEqual({ "script-src-elem": CSP_TAXA_POR_ORIGEM_POR_MINUTO });
    // Outro remetente ainda passa.
    await cspReport(relatorio(VIOLACAO_LEGADA, { "x-forwarded-for": "198.51.100.7" }));
    expect(redis.kv.get("csp:diretiva")).toEqual({ "script-src-elem": CSP_TAXA_POR_ORIGEM_POR_MINUTO + 1 });
  });

  it("Redis fora do ar: 204 mesmo assim", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    redis.falhar = true;
    expect((await cspReport(relatorio(VIOLACAO_LEGADA))).status).toBe(204);
  });

  it("higienização: esquemas e palavras-chave viram rótulo, lixo vira 'outro'", () => {
    const um = (blocked: string) =>
      higienizarRelatorio({ "csp-report": { "blocked-uri": blocked, "effective-directive": "img-src", "document-uri": "https://x/y" } })[0];
    expect(um("data:image/png;base64,AAAA").bloqueado).toBe("data");
    expect(um("blob:https://x/uuid").bloqueado).toBe("blob");
    expect(um("eval").bloqueado).toBe("eval");
    expect(um("javascript:alert(1)").bloqueado).toBe("outro");
    expect(um("https://h.online-metrix.net/fp/tags.js?session_id=abc").bloqueado).toBe("https://h.online-metrix.net");
    expect(um("x").pagina).toBe("outra");
    expect(higienizarRelatorio({ "csp-report": { "effective-directive": "<script>" } })[0].diretiva).toBe("desconhecida");
  });
});

// ===========================================================================
describe("/api/admin/csp", () => {
  const req = (auth?: string) =>
    new Request("https://x.com/api/admin/csp", { headers: auth ? { authorization: auth } : {} });

  it("404 sem header", async () => {
    process.env.ADMIN_API_TOKEN = "segredo-de-teste";
    expect((await adminCsp(req())).status).toBe(404);
  });

  it("404 com token errado ou sem ADMIN_API_TOKEN no ambiente", async () => {
    process.env.ADMIN_API_TOKEN = "segredo-de-teste";
    expect((await adminCsp(req("Bearer outro"))).status).toBe(404);
    delete process.env.ADMIN_API_TOKEN;
    expect((await adminCsp(req("Bearer "))).status).toBe(404);
  });

  it("com o token devolve contagens e recentes", async () => {
    process.env.ADMIN_API_TOKEN = "segredo-de-teste";
    await cspReport(relatorio(VIOLACAO_LEGADA));
    const res = await adminCsp(req("Bearer segredo-de-teste"));
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo.porDiretiva).toEqual({ "script-src-elem": 1 });
    expect(corpo.porBloqueado).toEqual({ "https://www.googletagmanager.com": 1 });
    expect(corpo.recentes).toHaveLength(1);
  });
});
