import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

// Rodada S1 — rotas administrativas e de diagnóstico só com
// Authorization: Bearer <ADMIN_API_TOKEN>, 404 em qualquer outro caso.

const mocks = vi.hoisted(() => ({
  getChannels: vi.fn(async () => [{ id: 2000, name: "direto" }]),
  clearTokenCache: vi.fn(),
  getAccessToken: vi.fn(async () => null),
  calculatePriceDetailed: vi.fn(async () => ({ quote: { totalPrice: 100 } })),
  getCalendar: vi.fn(async () => []),
  readAuthLog: vi.fn(async () => [{ PaymentId: "p1" }]),
  scanAllDrafts: vi.fn(async () => []),
  scanOrphanReservations: vi.fn(async () => []),
}));

vi.mock("@/lib/hostaway", () => ({
  getChannels: mocks.getChannels,
  clearTokenCache: mocks.clearTokenCache,
  getAccessToken: mocks.getAccessToken,
  calculatePriceDetailed: mocks.calculatePriceDetailed,
  getCalendar: mocks.getCalendar,
}));
vi.mock("@/lib/kv-store", () => ({
  readAuthLog: mocks.readAuthLog,
  scanAllDrafts: mocks.scanAllDrafts,
  scanOrphanReservations: mocks.scanOrphanReservations,
}));
vi.mock("@/lib/braspag-pix-confirm", () => ({ confirmPixPaymentIfPaid: vi.fn() }));
vi.mock("@/lib/reservation-recovery", () => ({ reprocessOrphan: vi.fn() }));

import { GET as channels } from "@/app/api/debug/channels/route";
import { GET as hostawayReservation } from "@/app/api/debug/hostaway-reservation/route";
import { GET as priceTest } from "@/app/api/debug/price-test/route";
import { POST as regenerateToken } from "@/app/api/debug/regenerate-token/route";
import { GET as authlog } from "@/app/api/payments/braspag/authlog/route";
import { GET as pixReconcile } from "@/app/api/payments/braspag/pix-reconcile/route";

const TOKEN = "tok-admin-s1";
const BASE = "https://solarium.test";

type Rota = {
  nome: string;
  chamar: (req: Request) => Promise<Response>;
  url: string;
  metodo: "GET" | "POST";
  // efeito que só pode acontecer com token válido
  efeito: () => unknown[];
};

const rotas: Rota[] = [
  { nome: "debug/channels", chamar: channels, url: "/api/debug/channels", metodo: "GET", efeito: () => mocks.getChannels.mock.calls },
  {
    nome: "debug/hostaway-reservation",
    chamar: hostawayReservation,
    url: "/api/debug/hostaway-reservation",
    metodo: "GET",
    efeito: () => mocks.getAccessToken.mock.calls,
  },
  {
    nome: "debug/price-test",
    chamar: priceTest as unknown as (req: Request) => Promise<Response>,
    url: "/api/debug/price-test?propertyId=316007&checkin=2099-01-10&checkout=2099-01-12&guests=2",
    metodo: "GET",
    efeito: () => mocks.calculatePriceDetailed.mock.calls,
  },
  {
    nome: "debug/regenerate-token",
    chamar: regenerateToken,
    url: "/api/debug/regenerate-token",
    metodo: "POST",
    efeito: () => mocks.clearTokenCache.mock.calls,
  },
  { nome: "braspag/authlog", chamar: authlog, url: "/api/payments/braspag/authlog", metodo: "GET", efeito: () => mocks.readAuthLog.mock.calls },
];

function req(r: Rota, token?: string, url = r.url) {
  return new Request(BASE + url, {
    method: r.metodo,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_API_TOKEN = TOKEN;
});
afterEach(() => {
  delete process.env.ADMIN_API_TOKEN;
  delete process.env.BRASPAG_RECONCILE_SECRET;
  delete process.env.CRON_SECRET;
});

describe.each(rotas)("$nome", (r) => {
  it("sem header → 404, sem efeito", async () => {
    expect((await r.chamar(req(r))).status).toBe(404);
    expect(r.efeito()).toHaveLength(0);
  });

  it("token errado → 404, sem efeito", async () => {
    expect((await r.chamar(req(r, "errado"))).status).toBe(404);
    expect((await r.chamar(req(r, TOKEN + "x"))).status).toBe(404);
    expect(r.efeito()).toHaveLength(0);
  });

  it("ADMIN_API_TOKEN ausente → 404 mesmo com header", async () => {
    delete process.env.ADMIN_API_TOKEN;
    expect((await r.chamar(req(r, TOKEN))).status).toBe(404);
    process.env.ADMIN_API_TOKEN = "   ";
    expect((await r.chamar(req(r, ""))).status).toBe(404);
    expect(r.efeito()).toHaveLength(0);
  });

  it("chave antiga em query string → 404", async () => {
    const sep = r.url.includes("?") ? "&" : "?";
    const antiga = ["lucas", "2026"].join("");
    expect((await r.chamar(req(r, undefined, `${r.url}${sep}key=${antiga}&secret=${TOKEN}`))).status).toBe(404);
    expect(r.efeito()).toHaveLength(0);
  });

  it("token correto → responde e executa", async () => {
    const res = await r.chamar(req(r, TOKEN));
    expect(res.status).not.toBe(404);
    expect(r.efeito()).toHaveLength(1);
  });
});

describe("respostas com token correto", () => {
  it("channels devolve os canais", async () => {
    const res = await channels(req(rotas[0], TOKEN));
    expect(await res.json()).toEqual({ channels: [{ id: 2000, name: "direto" }] });
  });

  it("regenerate-token devolve JSON, sem redirect", async () => {
    const res = await regenerateToken(req(rotas[3], TOKEN));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("authlog devolve os registros", async () => {
    const res = await authlog(req(rotas[4], TOKEN));
    expect(await res.json()).toEqual({ count: 1, entries: [{ PaymentId: "p1" }] });
  });
});

describe("pix-reconcile", () => {
  const chamar = (url: string, headers: Record<string, string> = {}) =>
    pixReconcile(new Request(BASE + url, { headers }));

  it("segredo por query string não autoriza mais", async () => {
    process.env.BRASPAG_RECONCILE_SECRET = "seg-reconcile";
    expect((await chamar("/api/payments/braspag/pix-reconcile?secret=seg-reconcile")).status).toBe(401);
    expect(mocks.scanAllDrafts).not.toHaveBeenCalled();
  });

  it("header e cron seguem funcionando", async () => {
    process.env.BRASPAG_RECONCILE_SECRET = "seg-reconcile";
    process.env.CRON_SECRET = "seg-cron";
    expect((await chamar("/api/payments/braspag/pix-reconcile", { "x-reconcile-secret": "seg-reconcile" })).status).toBe(200);
    expect((await chamar("/api/payments/braspag/pix-reconcile", { authorization: "Bearer seg-cron" })).status).toBe(200);
  });
});

describe("chave antiga fora do fonte", () => {
  // Montada em partes para este arquivo não conter o literal.
  const antiga = ["lucas", "2026"].join("");
  const raiz = path.resolve(__dirname, "../..");
  const pastas = ["src", "scripts", "content", "public"];
  const ignorar = new Set(["node_modules", ".next"]);

  function arquivos(dir: string): string[] {
    let saida: string[] = [];
    let nomes: string[];
    try {
      nomes = readdirSync(dir);
    } catch {
      return saida;
    }
    for (const nome of nomes) {
      if (ignorar.has(nome)) continue;
      const p = path.join(dir, nome);
      if (statSync(p).isDirectory()) saida = saida.concat(arquivos(p));
      else saida.push(p);
    }
    return saida;
  }

  it("nenhum arquivo contém o literal", () => {
    const todos = pastas.flatMap((p) => arquivos(path.join(raiz, p)));
    expect(todos.length).toBeGreaterThan(50);
    const comChave = todos
      .filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs|json|md|html|txt)$/.test(f))
      .filter((f) => readFileSync(f, "utf8").includes(antiga))
      .map((f) => path.relative(raiz, f));
    expect(comChave).toEqual([]);
  });
});
