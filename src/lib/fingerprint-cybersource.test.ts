import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// O Vitest compila o JSX no modo clássico (React.createElement); o Next usa o
// automático. Mesmo contorno de braspag-antifraude.test.ts.
(globalThis as unknown as { React: typeof React }).React = React;

// ---------------------------------------------------------------------------
// Rodada FP1 — device fingerprint da Cybersource (ThreatMetrix) no checkout.
// ---------------------------------------------------------------------------

// Redis falso em memória: só o que a rota de crédito toca.
const redis = vi.hoisted(() => {
  process.env.KV_REST_API_URL = "http://redis-falso";
  process.env.KV_REST_API_TOKEN = "falso";
  process.env.HOSTAWAY_ACCOUNT_ID = "123";
  process.env.HOSTAWAY_API_KEY = "chave-falsa";
  const kv = new Map<string, unknown>();
  const api: Record<string, unknown> & { kv: typeof kv } = {
    kv,
    async set(k: string, v: unknown, o?: { nx?: boolean }) {
      if (o?.nx && kv.has(k)) return null;
      kv.set(k, String(v));
      return "OK";
    },
    async get(k: string) {
      return kv.get(k) ?? null;
    },
    async del(...ks: string[]) {
      return ks.filter((k) => kv.delete(k)).length;
    },
    async lpush() {
      return 1;
    },
    async ltrim() {
      return "OK";
    },
    async expire() {
      return 1;
    },
    async hincrby() {
      return 1;
    },
    async scan() {
      return [0, []];
    },
    pipeline() {
      const p: Record<string, unknown> = {};
      for (const nome of ["lpush", "ltrim", "expire", "hincrby", "hgetall"]) p[nome] = () => p;
      p.exec = async () => [];
      return p;
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

const mocks = vi.hoisted(() => ({
  createHostawayReservation: vi.fn(async () => ({ reservationId: 777 })),
}));

vi.mock("@/lib/hostaway", async (original) => ({
  ...(await original<typeof import("@/lib/hostaway")>()),
  createHostawayReservation: mocks.createHostawayReservation,
  blockCalendarNight: vi.fn(async () => true),
  unblockCalendarNight: vi.fn(async () => true),
}));
vi.mock("@/lib/op-extras-server", () => ({
  blockOpExtraNights: vi.fn(async () => ({ todasBloqueadas: true, resultados: [] })),
  noitesABloquear: () => [],
}));
vi.mock("@/lib/email", () => ({
  enviarAlertaRecusa: vi.fn(async () => undefined),
  enviarAlertaAprovacao: vi.fn(async () => undefined),
  enviarAlertaEmAnalise: vi.fn(async () => undefined),
  enviarEmailHospede: vi.fn(async () => ({ enviado: true })),
  enviarAlertaDesfechoAnalise: vi.fn(async () => undefined),
}));
vi.mock("@/lib/reservation-recovery", () => ({ registerOrphanAndAlert: vi.fn(async () => undefined) }));
vi.mock("@/lib/reserva-pacote", () => ({ paramsDePacote: () => ({}), extrasProvidenciar: () => [] }));

import {
  fingerprintOrgId,
  fingerprintConfig,
  fingerprintIdValido,
  fingerprintTags,
  gerarFingerprintId,
} from "@/lib/braspag";
import { getDraft } from "@/lib/kv-store";
import { POST } from "@/app/api/payments/braspag/credit/route";
import PagamentoLayout from "@/app/(checkout)/reservar/[draftId]/pagamento/layout";
import FingerprintCybersource, { useFingerprintId } from "@/app/(checkout)/reservar/[draftId]/pagamento/FingerprintCybersource";

const DRAFT_ID = "draft-fp1";
const NOME = "Maria";
const SOBRENOME = "Souza";
const EMAIL = "maria@exemplo.com";
const CPF = "12345678909";
const PMID = "braspag_lojateste";

const envOriginal = { ...process.env };
afterEach(() => {
  process.env = { ...envOriginal };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ===========================================================================
describe("org_id acompanha BRASPAG_ENVIRONMENT", () => {
  it.each([
    ["production", "k8vif92e"],
    ["sandbox", "1snn5n9w"],
    ["", "1snn5n9w"],
    ["qualquer-coisa", "1snn5n9w"],
  ])("BRASPAG_ENVIRONMENT=%j → %s", (env, org) => {
    process.env.BRASPAG_ENVIRONMENT = env;
    expect(fingerprintOrgId()).toBe(org);
  });

  it("preview apontando para a Braspag de produção usa o org de produção", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.BRASPAG_ENVIRONMENT = "production";
    process.env.BRASPAG_AF_PROVIDER_MERCHANT_ID = PMID;
    expect(fingerprintConfig()?.orgId).toBe("k8vif92e");
  });
});

describe("identificador", () => {
  it("gerado é GUID de 32 hex, diferente a cada chamada", () => {
    const a = gerarFingerprintId();
    const b = gerarFingerprintId();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(fingerprintIdValido(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it("validador recusa dado pessoal e formatos estranhos", () => {
    for (const v of [EMAIL, CPF, `${NOME} ${SOBRENOME}`, "fp-abc", "", undefined, null, 42, "A".repeat(32), PMID + gerarFingerprintId()]) {
      expect(fingerprintIdValido(v)).toBe(false);
    }
  });

  it("tags montam session_id = ProviderMerchantId + identificador, sem separador", () => {
    const id = gerarFingerprintId();
    const { scriptSrc, iframeSrc } = fingerprintTags({ orgId: "1snn5n9w", providerMerchantId: PMID }, id);
    expect(scriptSrc).toBe(`https://h.online-metrix.net/fp/tags.js?org_id=1snn5n9w&session_id=${PMID}${id}`);
    expect(iframeSrc).toBe(`https://h.online-metrix.net/fp/tags?org_id=1snn5n9w&session_id=${PMID}${id}`);
  });
});

// ===========================================================================
describe("layout da rota de pagamento", () => {
  beforeEach(() => {
    redis.kv.clear();
    process.env.PAYMENT_PROVIDER = "braspag";
    process.env.BRASPAG_ENVIRONMENT = "sandbox";
  });

  it("sem ProviderMerchantId: não carrega o script e alerta uma única vez", async () => {
    delete process.env.BRASPAG_AF_PROVIDER_MERCHANT_ID;
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(fingerprintConfig()).toBeNull();

    for (let i = 0; i < 3; i++) {
      const el = await PagamentoLayout({ children: "pagina" });
      const html = renderToStaticMarkup(el);
      expect(html).toBe("pagina");
      expect(html).not.toContain("online-metrix");
    }
    expect(erro.mock.calls.filter((c) => String(c[0]).includes("[Braspag:fingerprint]"))).toHaveLength(1);
  });

  it("provider Cielo: nada de fingerprint", async () => {
    process.env.PAYMENT_PROVIDER = "cielo";
    process.env.BRASPAG_AF_PROVIDER_MERCHANT_ID = PMID;
    const el = await PagamentoLayout({ children: "pagina" });
    expect(renderToStaticMarkup(el)).toBe("pagina");
  });

  it("com config: script e noscript com o mesmo identificador, novo a cada carregamento", async () => {
    process.env.BRASPAG_AF_PROVIDER_MERCHANT_ID = PMID;
    const a = (await PagamentoLayout({ children: "pagina" })) as { type: unknown; props: { id: string; scriptSrc: string; iframeSrc: string } };
    const b = (await PagamentoLayout({ children: "pagina" })) as { props: { id: string } };
    expect(a.type).toBe(FingerprintCybersource);
    expect(fingerprintIdValido(a.props.id)).toBe(true);
    expect(a.props.id).not.toBe(b.props.id);
    expect(a.props.scriptSrc).toContain(`session_id=${PMID}${a.props.id}`);

    const html = renderToStaticMarkup(a as never);
    expect(html).toContain("<noscript>");
    expect(html).toContain(`fp/tags?org_id=1snn5n9w&amp;session_id=${PMID}${a.props.id}`);
    expect(html).toContain("top:-5000px");
    expect(html).toContain("pagina");
  });
});

describe("uma sessão por janela", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("navegação client-side de volta ao pagamento envia o id do script já ativo", () => {
    (globalThis as { window?: unknown }).window = {};
    const Leitor = () => React.createElement("i", null, useFingerprintId());
    const render = (id: string) =>
      renderToStaticMarkup(
        React.createElement(FingerprintCybersource, {
          id,
          scriptSrc: `https://h.online-metrix.net/fp/tags.js?org_id=1snn5n9w&session_id=${PMID}${id}`,
          iframeSrc: "x",
          children: React.createElement(Leitor),
        }),
      );
    const primeiro = gerarFingerprintId();
    const segundo = gerarFingerprintId();
    expect(render(primeiro)).toContain(`<i>${primeiro}</i>`);
    // O layout gerou outro id, mas o tags.js não roda duas vezes na mesma janela.
    expect(render(segundo)).toContain(`<i>${primeiro}</i>`);
  });
});

// ===========================================================================
// Rota de crédito: o identificador vai para Payment.FraudAnalysis.FingerPrintId
// e nunca bloqueia a compra.
function semearDraft() {
  redis.kv.set(
    `draft:${DRAFT_ID}`,
    JSON.stringify({
      id: DRAFT_ID,
      propertyId: "solarium-1",
      propertyName: "Solarium 1",
      checkin: "2026-10-10",
      checkout: "2026-10-12",
      nights: 2,
      guests: 2,
      finalTotal: 1000,
      totalPrice: 1000,
      guestFirstName: NOME,
      guestLastName: SOBRENOME,
      guestEmail: EMAIL,
      guestPhone: "35999999999",
      guestCpf: CPF,
      paymentMethod: "card",
      status: "pending",
      createdAt: "2026-09-21T00:00:00Z",
      expiresAt: "2026-09-21T02:00:00Z",
    }),
  );
}

function capturarAutorizacao(): { payload: Record<string, unknown> | null } {
  const box: { payload: Record<string, unknown> | null } = { payload: null };
  const resposta = (corpo: unknown) => new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/v2/sales/")) {
        box.payload = JSON.parse(String(init?.body));
        return resposta({
          Payment: { PaymentId: "pay-1", Status: 1, ReturnCode: "00", FraudAnalysis: { Id: "af-1", Status: 1 } },
        });
      }
      if (u.includes("/capture")) return resposta({ Status: 2, ReturnCode: "6" });
      if (u.includes("/void")) return resposta({ Status: 10 });
      throw new Error("URL inesperada: " + u);
    }),
  );
  return box;
}

function requisicao(browserFingerprint: unknown): Request {
  return new Request("https://solarium.test/api/payments/braspag/credit", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "200.1.2.3", host: "solarium.test" },
    body: JSON.stringify({
      draftId: DRAFT_ID,
      cardNumber: "4111111111111111",
      cardHolder: `${NOME} ${SOBRENOME}`,
      cardExpiration: "12/2030",
      cardCvv: "123",
      installments: 1,
      browserFingerprint,
      externalAuthentication: { Cavv: "cavv", Xid: "xid", Eci: "05", Version: "2.2.0", ReferenceId: "ref" },
      billing: { street: "Rua A", number: "1", neighborhood: "Centro", city: "Itanhandu", state: "MG", zipCode: "37464000" },
    }),
  });
}

describe("rota de crédito", () => {
  beforeEach(() => {
    redis.kv.clear();
    semearDraft();
    process.env.PAYMENT_PROVIDER = "braspag";
    process.env.BRASPAG_ENVIRONMENT = "sandbox";
    process.env.BRASPAG_AF_PROVIDER_MERCHANT_ID = PMID;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("o mesmo GUID do script chega em Payment.FraudAnalysis.FingerPrintId e fica no draft", async () => {
    const layout = (await PagamentoLayout({ children: null })) as { props: { id: string; scriptSrc: string } };
    const id = layout.props.id;
    const box = capturarAutorizacao();

    const res = await POST(requisicao(id));
    expect(res.status).toBe(200);

    const fa = (box.payload?.Payment as { FraudAnalysis: Record<string, unknown> }).FraudAnalysis;
    expect(fa.FingerPrintId).toBe(id);
    expect(layout.props.scriptSrc).toContain(`session_id=${PMID}${fa.FingerPrintId}`);
    expect((await getDraft(DRAFT_ID))?.fingerprintId).toBe(id);
  });

  it("o FingerPrintId não carrega dado pessoal do hóspede", async () => {
    const id = gerarFingerprintId();
    const box = capturarAutorizacao();
    await POST(requisicao(id));
    const fp = String((box.payload?.Payment as { FraudAnalysis: Record<string, unknown> }).FraudAnalysis.FingerPrintId);
    expect(fp).toMatch(/^[0-9a-f]{32}$/);
    for (const pessoal of [NOME, SOBRENOME, EMAIL, CPF, "35999999999", "4111", DRAFT_ID]) {
      expect(fp.toLowerCase()).not.toContain(pessoal.toLowerCase());
    }
  });

  it.each([
    ["ausente", undefined],
    ["vazio", ""],
    ["fora do formato", "fp-abc"],
    ["com dado pessoal", EMAIL],
  ])("identificador %s: autoriza sem FingerPrintId e não bloqueia", async (_nome, valor) => {
    const box = capturarAutorizacao();
    const res = await POST(requisicao(valor));
    expect(res.status).toBe(200);
    expect((await res.json()).approved).toBe(true);
    const fa = (box.payload?.Payment as { FraudAnalysis: Record<string, unknown> }).FraudAnalysis;
    expect(fa).toBeDefined();
    expect("FingerPrintId" in fa).toBe(false);
    expect((await getDraft(DRAFT_ID))?.fingerprintId).toBeUndefined();
  });
});

// ===========================================================================
// Escopo: os arquivos DA ROTA de pagamento não adicionam GTM/GA/Meta. Desde a
// PAG1 a rota tem root layout próprio, (checkout), sem analytics — coberto em
// isolamento-pagamento.test.ts.
describe("rota de pagamento sem GTM", () => {
  const dir = path.resolve(__dirname, "../app/(checkout)/reservar/[draftId]/pagamento");
  it.each(["layout.tsx", "FingerprintCybersource.tsx", "page.tsx"])("%s", (arquivo) => {
    const fonte = readFileSync(path.join(dir, arquivo), "utf-8");
    expect(fonte).not.toMatch(/googletagmanager|gtag\(|GTM-|fbq\(|connect\.facebook\.net/);
  });

  it("o único script externo do componente é o da ThreatMetrix", () => {
    const fonte = readFileSync(path.join(dir, "FingerprintCybersource.tsx"), "utf-8");
    expect(fonte.match(/<Script\b/g)).toHaveLength(1);
  });
});
