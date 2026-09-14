import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Redis falso em memória. Cobre só os comandos que kv-store usa.

const redis = vi.hoisted(() => {
  process.env.KV_REST_API_URL = "http://redis-falso";
  process.env.KV_REST_API_TOKEN = "falso";
  const kv = new Map<string, string | string[] | Record<string, number>>();
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
    async mget(...ks: string[]) {
      return ks.map((k) => kv.get(k) ?? null);
    },
    async scan(_cursor: number, o: { match: string }) {
      const re = new RegExp("^" + o.match.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
      return [0, Array.from(kv.keys()).filter((k) => re.test(k))];
    },
    async lpush(k: string, ...vs: string[]) {
      const l = (kv.get(k) as string[] | undefined) ?? [];
      l.unshift(...vs.reverse());
      kv.set(k, l);
      return l.length;
    },
    async ltrim(k: string, ini: number, fim: number) {
      const l = kv.get(k) as string[] | undefined;
      if (l) kv.set(k, l.slice(ini, fim + 1));
      return "OK";
    },
    async lrange(k: string, ini: number, fim: number) {
      return ((kv.get(k) as string[] | undefined) ?? []).slice(ini, fim + 1);
    },
    async expire() {
      return 1;
    },
    async hincrby(k: string, campo: string, n: number) {
      const h = (kv.get(k) as Record<string, number> | undefined) ?? {};
      h[campo] = (h[campo] ?? 0) + n;
      kv.set(k, h);
      return h[campo];
    },
    async hgetall(k: string) {
      return (kv.get(k) as Record<string, number> | undefined) ?? null;
    },
    pipeline() {
      const ops: Array<() => Promise<unknown>> = [];
      const p: Record<string, unknown> = {};
      for (const nome of ["lpush", "ltrim", "expire", "hincrby", "hgetall"]) {
        p[nome] = (...args: unknown[]) => {
          ops.push(() => (api[nome] as (...a: unknown[]) => Promise<unknown>)(...args));
          return p;
        };
      }
      p.exec = async () => {
        const saida: unknown[] = [];
        for (const op of ops) saida.push(await op());
        return saida;
      };
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
  enviarAlertaRecusa: vi.fn(async () => undefined),
  enviarAlertaAprovacao: vi.fn(async () => undefined),
}));

vi.mock("@/lib/hostaway", () => ({ createHostawayReservation: mocks.createHostawayReservation }));
vi.mock("@/lib/op-extras-server", () => ({
  blockOpExtraNights: vi.fn(async () => ({ todasBloqueadas: true, resultados: [] })),
}));
vi.mock("@/lib/email", () => ({
  enviarAlertaRecusa: mocks.enviarAlertaRecusa,
  enviarAlertaAprovacao: mocks.enviarAlertaAprovacao,
}));
vi.mock("@/lib/reservation-recovery", () => ({ registerOrphanAndAlert: vi.fn(async () => undefined) }));
vi.mock("@/lib/reserva-pacote", () => ({ paramsDePacote: () => ({}), extrasProvidenciar: () => [] }));
vi.mock("@/lib/braspag-pix-confirm", () => ({ confirmPixPaymentIfPaid: vi.fn(async () => ({ status: "pending" })) }));

import {
  normalizarFraudStatus,
  fraudStatusParaDecisao,
  rotuloFraudStatus,
  redigirParaRegistro,
  resumoAntifraude,
  type BraspagTransactionResult,
} from "@/lib/braspag";
import {
  registrarResultadoAntifraude,
  registrarWebhookNaoTratado,
  registrarVoidSemSucesso,
  lerObservabilidadeAntifraude,
  campoContagemWebhook,
  getDraft,
  readAuthLog,
} from "@/lib/kv-store";
import { POST as postCredito } from "@/app/api/payments/braspag/credit/route";
import { POST as postWebhook } from "@/app/api/webhooks/braspag/route";

// Dados do hóspede usados para provar que nada disso chega ao KV de observabilidade.
const PAN = "4111111111111111";
const CVV = "7319";
const NOME = "Maria Aparecida Souza";
const EMAIL = "maria.souza@exemplo.com";
const CPF = "123.456.789-09";
const DRAFT_ID = "0b6c1f7e-3d2a-4c55-9a1e-7f00c0ffee01";
const PAYMENT_ID = "5fb4a1c2-8d3e-4f60-b7a9-123456789012";

function kvDeObservabilidade(): string {
  return JSON.stringify(Array.from(redis.kv.entries()).filter(([k]) => k.startsWith("af:")));
}

// ===========================================================================
describe("normalizarFraudStatus", () => {
  it("aceita os seis valores numéricos", () => {
    expect([0, 1, 2, 3, 4, 5].map(normalizarFraudStatus)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("aceita string numérica", () => {
    expect(normalizarFraudStatus("3")).toBe(3);
    expect(normalizarFraudStatus(" 2 ")).toBe(2);
  });

  it("aceita string nominal em qualquer caixa", () => {
    expect(normalizarFraudStatus("Review")).toBe(3);
    expect(normalizarFraudStatus("review")).toBe(3);
    expect(normalizarFraudStatus("REVIEW")).toBe(3);
    expect(normalizarFraudStatus("Unfinished")).toBe(5);
  });

  it("bloco ausente vira Unknown", () => {
    expect(normalizarFraudStatus(undefined)).toBe(0);
    expect(normalizarFraudStatus(null)).toBe(0);
  });

  it("valor fora do enum vira Unknown e nunca lança", () => {
    for (const v of [7, -1, 1.5, NaN, "9", "banana", "", {}, [], true]) {
      expect(normalizarFraudStatus(v)).toBe(0);
    }
  });
});

describe("rotuloFraudStatus", () => {
  it("nunca imprime undefined", () => {
    for (const v of [undefined, null, 0, 1, 2, 3, 4, 5, "3", "Review", "xyz", 42]) {
      expect(rotuloFraudStatus(v)).not.toMatch(/undefined/);
    }
  });

  it("nomeia o status e sinaliza quando chegou como texto", () => {
    expect(rotuloFraudStatus(3)).toBe("Review");
    expect(rotuloFraudStatus("review")).toBe('Review (recebido como texto "review")');
    expect(rotuloFraudStatus(undefined)).toMatch(/ausente/);
    expect(rotuloFraudStatus("xyz")).toMatch(/não reconhecido/);
  });
});

describe("fraudStatusParaDecisao — equivalência com o cast antigo", () => {
  // O if da rota é `fraudStatus !== 1`. Antes: `fa.Status as number`.
  const decisaoAntiga = (cru: unknown) => ((cru as number) !== 1 ? "recusa" : "captura");
  const decisaoNova = (cru: unknown) => (fraudStatusParaDecisao(cru) !== 1 ? "recusa" : "captura");

  it.each([0, 1, 2, 3, 4, 5, 7, "1", "Accept", "accept", "3", "Review", undefined, null, 1.0])(
    "valor %s decide igual",
    (cru) => {
      expect(decisaoNova(cru)).toBe(decisaoAntiga(cru));
    },
  );
});

describe("redigirParaRegistro", () => {
  it("remove PAN, CVV, nome, e-mail e CPF e preserva o PaymentId", () => {
    const saida = JSON.stringify(
      redigirParaRegistro({
        PaymentId: PAYMENT_ID,
        ChangeType: 3,
        Customer: { Name: NOME, Email: EMAIL, Identity: CPF },
        CreditCard: { CardNumber: PAN, SecurityCode: CVV, Holder: NOME },
        Nota: `cartão ${PAN} / 4111-1111-1111-1111 / 4111 1111 1111 1111 contato ${EMAIL} cpf ${CPF}`,
      }),
    );
    for (const proibido of [PAN, CVV, NOME, EMAIL, CPF, "4111-1111-1111-1111", "4111 1111 1111 1111"]) {
      expect(saida).not.toContain(proibido);
    }
    expect(saida).toContain(PAYMENT_ID);
  });

  it("nunca lança com entrada estranha", () => {
    const ciclico: Record<string, unknown> = {};
    ciclico.eu = ciclico;
    expect(() => redigirParaRegistro(ciclico)).not.toThrow();
    expect(() => redigirParaRegistro(BigInt(1))).not.toThrow();
  });
});

describe("campoContagemWebhook", () => {
  it("normaliza o ChangeType", () => {
    expect(campoContagemWebhook(3)).toBe("webhook:3");
    expect(campoContagemWebhook("1")).toBe("webhook:1");
    expect(campoContagemWebhook(undefined)).toBe("webhook:ausente");
  });
});

// ===========================================================================
describe("persistência no KV", () => {
  beforeEach(() => redis.kv.clear());
  afterEach(() => vi.restoreAllMocks());

  const resumo = (status: unknown) =>
    resumoAntifraude(
      { status: 201, statusCode: 1, paymentId: PAYMENT_ID, fraudStatusCru: status, fraudScore: 42, fraudReasonCode: 100, fraudAnalysisId: "af-1", raw: {} } as BraspagTransactionResult,
      `${DRAFT_ID}-abc`,
    );

  it("não altera draft nem authlog pré-existentes, que seguem legíveis", async () => {
    const draftAntigo = JSON.stringify({ id: DRAFT_ID, status: "pending", finalTotal: 100 });
    const authlogAntigo = JSON.stringify({ PaymentId: "antigo", FraudAnalysisStatus: 1, _ts: 1 });
    redis.kv.set(`draft:${DRAFT_ID}`, draftAntigo);
    redis.kv.set("braspag:authlog:0000000000001-aaaaaa", authlogAntigo);

    await registrarResultadoAntifraude(resumo(3));
    await registrarWebhookNaoTratado({ changeType: 3, paymentId: PAYMENT_ID, motivo: "teste", corpo: {}, headers: {} });
    await registrarVoidSemSucesso({ paymentId: PAYMENT_ID, merchantOrderId: "x", contexto: "antifraude", httpStatus: 200, statusCode: 0, returnCode: null, erro: null });

    expect(redis.kv.get(`draft:${DRAFT_ID}`)).toBe(draftAntigo);
    expect(redis.kv.get("braspag:authlog:0000000000001-aaaaaa")).toBe(authlogAntigo);
    expect((await getDraft(DRAFT_ID))?.status).toBe("pending");
    expect(await readAuthLog()).toHaveLength(1);
    expect(Array.from(redis.kv.keys()).filter((k) => !k.startsWith("af:") && !k.startsWith("draft:") && !k.startsWith("braspag:authlog:"))).toEqual([]);
  });

  it("conta por janela de 24h e 7 dias e ignora entrada corrompida", async () => {
    const agora = Date.parse("2026-09-14T12:30:00Z");
    await registrarResultadoAntifraude(resumo(3), agora);
    await registrarResultadoAntifraude(resumo("Review"), agora - 3600_000);
    await registrarResultadoAntifraude(resumo(1), agora - 2 * 86400_000);
    await registrarResultadoAntifraude(resumo(2), agora - 10 * 86400_000); // fora dos 7 dias
    await registrarWebhookNaoTratado({ changeType: 3, paymentId: null, motivo: "x", corpo: {}, headers: {} }, agora);
    await registrarVoidSemSucesso({ paymentId: null, merchantOrderId: "x", contexto: "captura-falhou", httpStatus: 500, statusCode: null, returnCode: null, erro: null }, agora);
    (redis.kv.get("af:eventos") as string[]).push("{corrompido");

    const obs = await lerObservabilidadeAntifraude(agora);
    expect(obs.janela24h.antifraude).toEqual({ Unknown: 0, Accept: 0, Reject: 0, Review: 2, Aborted: 0, Unfinished: 0 });
    expect(obs.janela7d.antifraude).toEqual({ Unknown: 0, Accept: 1, Reject: 0, Review: 2, Aborted: 0, Unfinished: 0 });
    expect(obs.janela24h.webhooksNaoTratados).toEqual({ "3": 1 });
    expect(obs.janela24h.voidsSemSucesso).toBe(1);
    expect(obs.ultimosEventos).toHaveLength(4);
  });

  it("Redis fora do ar não propaga erro", async () => {
    vi.spyOn(redis as unknown as { pipeline: () => unknown }, "pipeline").mockImplementation(() => {
      throw new Error("redis caiu");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(registrarResultadoAntifraude(resumo(3))).resolves.toBeUndefined();
    await expect(registrarWebhookNaoTratado({ changeType: 3, paymentId: null, motivo: "x", corpo: {}, headers: {} })).resolves.toBeUndefined();
    await expect(registrarVoidSemSucesso({ paymentId: null, merchantOrderId: "x", contexto: "antifraude", httpStatus: null, statusCode: null, returnCode: null, erro: null })).resolves.toBeUndefined();
  });
});

// ===========================================================================
// Fluxo real da rota de crédito com o gateway simulado por fetch.
type CenarioGateway = { fraudStatus?: unknown; semBloco?: boolean; voidStatus?: number; voidLanca?: boolean };

function simularGateway(c: CenarioGateway): string[] {
  const chamadas: string[] = [];
  const resposta = (corpo: unknown) => new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith("/v2/sales/")) {
        chamadas.push("autorizacao");
        return resposta({
          MerchantOrderId: `${DRAFT_ID}-x`,
          Customer: { Name: NOME, Email: EMAIL, Identity: CPF },
          Payment: {
            PaymentId: PAYMENT_ID,
            Status: 1,
            ReturnCode: "00",
            CreditCard: { CardNumber: "411111******1111", Holder: NOME },
            ...(c.semBloco
              ? {}
              : { FraudAnalysis: { Id: "af-123", Status: c.fraudStatus, FraudAnalysisReasonCode: 100, ReplyData: { Score: 42 } } }),
          },
        });
      }
      if (u.includes("/capture")) {
        chamadas.push("captura");
        return resposta({ Status: 2, ReturnCode: "6" });
      }
      if (u.includes("/void")) {
        chamadas.push("void");
        if (c.voidLanca) throw new Error(`rede caiu ao cancelar ${PAN}`);
        return resposta({ Status: c.voidStatus ?? 10, ReturnCode: "9" });
      }
      throw new Error("URL inesperada: " + u);
    }),
  );
  return chamadas;
}

function requisicaoCredito(): Request {
  return new Request("https://solarium.test/api/payments/braspag/credit", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "200.1.2.3", host: "solarium.test" },
    body: JSON.stringify({
      draftId: DRAFT_ID,
      cardNumber: PAN,
      cardHolder: NOME,
      cardExpiration: "12/2030",
      cardCvv: CVV,
      installments: 1,
      browserFingerprint: "fp-abc",
      externalAuthentication: { Cavv: "cavv", Xid: "xid", Eci: "05", Version: "2.2.0", ReferenceId: "ref" },
      billing: { street: "Rua A", number: "1", neighborhood: "Centro", city: "Itanhandu", state: "MG", zipCode: "37464000" },
    }),
  });
}

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
      guestFirstName: "Maria Aparecida",
      guestLastName: "Souza",
      guestEmail: EMAIL,
      guestPhone: "35999999999",
      guestCpf: CPF,
      status: "pending",
      createdAt: "2026-09-14T00:00:00Z",
      expiresAt: "2026-09-14T02:00:00Z",
    }),
  );
}

describe("rota de crédito — decisão idêntica à anterior", () => {
  beforeEach(() => {
    redis.kv.clear();
    semearDraft();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.createHostawayReservation.mockClear();
    mocks.enviarAlertaRecusa.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Antes da A1: só o NÚMERO 1 capturava; todo o resto dava void e 402.
  const casos: Array<[string, CenarioGateway, "captura" | "recusa"]> = [
    ["Unknown (0)", { fraudStatus: 0 }, "recusa"],
    ["Accept (1)", { fraudStatus: 1 }, "captura"],
    ["Reject (2)", { fraudStatus: 2 }, "recusa"],
    ["Review (3)", { fraudStatus: 3 }, "recusa"],
    ["Aborted (4)", { fraudStatus: 4 }, "recusa"],
    ["Unfinished (5)", { fraudStatus: 5 }, "recusa"],
    ['"1" como texto', { fraudStatus: "1" }, "recusa"],
    ['"Accept" como texto', { fraudStatus: "Accept" }, "recusa"],
    ['"Review" como texto', { fraudStatus: "Review" }, "recusa"],
    ["bloco ausente", { semBloco: true }, "recusa"],
  ];

  it.each(casos)("%s", async (_nome, cenario, esperado) => {
    const chamadas = simularGateway(cenario);
    const res = await postCredito(requisicaoCredito());
    const corpo = await res.json();

    if (esperado === "captura") {
      expect(chamadas).toEqual(["autorizacao", "captura"]);
      expect(res.status).toBe(200);
      expect(corpo.approved).toBe(true);
      expect(mocks.createHostawayReservation).toHaveBeenCalledTimes(1);
    } else {
      expect(chamadas).toEqual(["autorizacao", "void"]);
      expect(res.status).toBe(402);
      expect(corpo).toEqual({
        approved: false,
        returnMessage: "Não foi possível concluir o pagamento. Nenhum valor foi cobrado — tente novamente ou fale conosco no WhatsApp.",
      });
      expect(mocks.createHostawayReservation).not.toHaveBeenCalled();
      const motivo = (mocks.enviarAlertaRecusa.mock.calls[0] as unknown as [{ motivo: string }])[0].motivo;
      expect(motivo).not.toMatch(/undefined/);
    }
  });

  it("registra o resultado do antifraude sem dado do hóspede", async () => {
    simularGateway({ fraudStatus: "REVIEW" });
    await postCredito(requisicaoCredito());
    const obs = await lerObservabilidadeAntifraude();
    expect(obs.janela24h.antifraude.Review).toBe(1);
    expect(obs.ultimosEventos[0]).toMatchObject({ paymentId: PAYMENT_ID, fraudStatus: 3, fraudStatusCru: "REVIEW", analysisId: "af-123", score: 42 });
    const kv = kvDeObservabilidade();
    for (const proibido of [PAN, CVV, NOME, "Maria Aparecida", EMAIL, CPF]) expect(kv).not.toContain(proibido);
  });

  it("void com status diferente de 10 é registrado e o hóspede vê a mesma resposta", async () => {
    const chamadas = simularGateway({ fraudStatus: 3, voidStatus: 0 });
    const res = await postCredito(requisicaoCredito());
    expect(chamadas).toEqual(["autorizacao", "void"]);
    expect(res.status).toBe(402);
    const obs = await lerObservabilidadeAntifraude();
    expect(obs.janela24h.voidsSemSucesso).toBe(1);
    expect(obs.ultimosVoidsSemSucesso[0]).toMatchObject({ paymentId: PAYMENT_ID, contexto: "antifraude", statusCode: 0 });
    const motivo = (mocks.enviarAlertaRecusa.mock.calls[0] as unknown as [{ motivo: string }])[0].motivo;
    expect(motivo).toMatch(/VOID NÃO CONFIRMADO/);
  });

  it("void que lança é registrado sem vazar o PAN da mensagem de erro", async () => {
    simularGateway({ fraudStatus: 2, voidLanca: true });
    const res = await postCredito(requisicaoCredito());
    expect(res.status).toBe(402);
    const obs = await lerObservabilidadeAntifraude();
    expect(obs.janela24h.voidsSemSucesso).toBe(1);
    expect(kvDeObservabilidade()).not.toContain(PAN);
  });

  it("void bem-sucedido não gera registro", async () => {
    simularGateway({ fraudStatus: 3 });
    await postCredito(requisicaoCredito());
    const obs = await lerObservabilidadeAntifraude();
    expect(obs.janela24h.voidsSemSucesso).toBe(0);
  });
});

// ===========================================================================
describe("webhook Braspag — notificações não tratadas", () => {
  beforeEach(() => {
    redis.kv.clear();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const webhook = (corpo: string, headers: Record<string, string> = {}) =>
    postWebhook(
      new Request("https://solarium.test/api/webhooks/braspag", {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "Braspag-Notifier", authorization: "Bearer segredo", ...headers },
        body: corpo,
      }),
    );

  it("ChangeType desconhecido é persistido e ainda responde 200", async () => {
    const res = await webhook(JSON.stringify({ PaymentId: PAYMENT_ID, ChangeType: 3 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignored: true });

    const obs = await lerObservabilidadeAntifraude();
    expect(obs.janela24h.webhooksNaoTratados).toEqual({ "3": 1 });
    const registro = obs.ultimosWebhooksNaoTratados[0] as Record<string, unknown>;
    expect(registro).toMatchObject({ changeType: 3, paymentId: PAYMENT_ID, corpo: { PaymentId: PAYMENT_ID, ChangeType: 3 } });
    expect(registro.headers).toMatchObject({ "user-agent": "Braspag-Notifier" });
    expect(JSON.stringify(registro)).not.toContain("segredo");
  });

  it("ChangeType 1 como texto também é registrado (hoje é ignorado)", async () => {
    const res = await webhook(JSON.stringify({ PaymentId: PAYMENT_ID, ChangeType: "1" }));
    expect(res.status).toBe(200);
    expect((await lerObservabilidadeAntifraude()).janela24h.webhooksNaoTratados).toEqual({ "1": 1 });
  });

  it("corpo que não é JSON é registrado como veio", async () => {
    const res = await webhook("PaymentId=abc&ChangeType=3", { "content-type": "application/x-www-form-urlencoded" });
    expect(res.status).toBe(200);
    const obs = await lerObservabilidadeAntifraude();
    expect(obs.ultimosWebhooksNaoTratados[0]).toMatchObject({ motivo: "corpo não é JSON", corpo: "PaymentId=abc&ChangeType=3" });
  });

  it("não persiste dado do hóspede que venha no corpo", async () => {
    await webhook(
      JSON.stringify({
        PaymentId: PAYMENT_ID,
        ChangeType: 9,
        Customer: { Name: NOME, Email: EMAIL, Identity: CPF },
        CreditCard: { CardNumber: PAN, SecurityCode: CVV },
        Observacao: `cartão ${PAN} de ${EMAIL}`,
      }),
    );
    const kv = kvDeObservabilidade();
    for (const proibido of [PAN, CVV, NOME, EMAIL, CPF]) expect(kv).not.toContain(proibido);
    expect(kv).toContain(PAYMENT_ID);
  });

  it("ChangeType 1 segue o fluxo normal e não é registrado", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const res = await webhook(JSON.stringify({ PaymentId: PAYMENT_ID, ChangeType: 1 }));
    expect(res.status).toBe(200);
    expect((await lerObservabilidadeAntifraude()).ultimosWebhooksNaoTratados).toEqual([]);
  });
});
