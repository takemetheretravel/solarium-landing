import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Redis falso em memória. Cobre só os comandos que kv-store usa.

const redis = vi.hoisted(() => {
  process.env.KV_REST_API_URL = "http://redis-falso";
  process.env.KV_REST_API_TOKEN = "falso";
  process.env.HOSTAWAY_ACCOUNT_ID = "123";
  process.env.HOSTAWAY_API_KEY = "chave-falsa";
  const kv = new Map<string, string | string[] | Record<string, number>>();
  const ttls = new Map<string, number | undefined>();
  const api: Record<string, unknown> & { kv: typeof kv; ttls: typeof ttls } = {
    kv,
    ttls,
    async set(k: string, v: unknown, o?: { nx?: boolean; ex?: number }) {
      if (o?.nx && kv.has(k)) return null;
      kv.set(k, String(v));
      ttls.set(k, o?.ex);
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
  enviarAlertaEmAnalise: vi.fn(async (_dados: { emailHospede?: string }) => undefined),
  enviarEmailHospede: vi.fn(
    async (_d: { para: string; assunto: string; html: string; texto: string }): Promise<{ enviado: true } | { enviado: false; motivo: string }> => ({
      enviado: true,
    }),
  ),
  resendSend: vi.fn(async (_payload: Record<string, unknown>): Promise<{ error: { message: string } | null }> => ({ error: null })),
  blockCalendarNight: vi.fn(async (_listingId: number, _noite: string) => true),
  unblockCalendarNight: vi.fn(async (_listingId: number, _noite: string) => true),
}));

// Parcial: noitesDaEstadia é a real; o que fala com a Hostaway é simulado.
vi.mock("@/lib/hostaway", async (original) => ({
  ...(await original<typeof import("@/lib/hostaway")>()),
  createHostawayReservation: mocks.createHostawayReservation,
  blockCalendarNight: mocks.blockCalendarNight,
  unblockCalendarNight: mocks.unblockCalendarNight,
}));
vi.mock("@/lib/op-extras-server", () => ({
  blockOpExtraNights: vi.fn(async () => ({ todasBloqueadas: true, resultados: [] })),
  noitesABloquear: () => [],
}));
vi.mock("@/lib/email", () => ({
  enviarAlertaRecusa: mocks.enviarAlertaRecusa,
  enviarAlertaAprovacao: mocks.enviarAlertaAprovacao,
  enviarAlertaEmAnalise: mocks.enviarAlertaEmAnalise,
  enviarEmailHospede: mocks.enviarEmailHospede,
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mocks.resendSend };
  },
}));
// A página de confirmação chama redirect() e renderiza o TrackPurchase.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/components/booking/TrackPurchase", () => ({ TrackPurchase: () => "[[PURCHASE]]" }));
vi.mock("@/lib/reservation-recovery", () => ({ registerOrphanAndAlert: vi.fn(async () => undefined) }));
vi.mock("@/lib/reserva-pacote", () => ({ paramsDePacote: () => ({}), extrasProvidenciar: () => [] }));
vi.mock("@/lib/braspag-pix-confirm", () => ({ confirmPixPaymentIfPaid: vi.fn(async () => ({ status: "pending" })) }));

import {
  normalizarFraudStatus,
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
  DRAFT_TTL_ANALISE,
} from "@/lib/kv-store";
import { antifraudeReviewAtivo } from "@/config/flags";
import { noitesDaEstadia } from "@/lib/hostaway";
import { getPropertyBySlug } from "@/config/properties";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// O Vitest compila o JSX das páginas no modo clássico (React.createElement);
// o Next usa o automático. Expor o React global evita mexer no vitest.config.
(globalThis as unknown as { React: typeof React }).React = React;
import ConfirmacaoPage from "@/app/reservar/[draftId]/confirmacao/page";
import {
  TEXTO_ESPERA,
  montarEmailEspera,
  enviarEmailEsperaUmaVez,
  varianteConfirmacao,
} from "@/lib/comunicacao-analise";
import type { ReservationDraft } from "@/lib/kv-store";
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

describe("antifraudeReviewAtivo", () => {
  afterEach(() => {
    delete process.env.ANTIFRAUDE_REVIEW_ENABLED;
  });

  it("é desligada por padrão e só liga com true explícito", () => {
    delete process.env.ANTIFRAUDE_REVIEW_ENABLED;
    expect(antifraudeReviewAtivo()).toBe(false);
    for (const v of ["false", "1", "yes", "", "ligada"]) {
      process.env.ANTIFRAUDE_REVIEW_ENABLED = v;
      expect(antifraudeReviewAtivo()).toBe(false);
    }
    for (const v of ["true", "TRUE", " true "]) {
      process.env.ANTIFRAUDE_REVIEW_ENABLED = v;
      expect(antifraudeReviewAtivo()).toBe(true);
    }
  });
});

describe("noitesDaEstadia", () => {
  it("vai do check-in à véspera do check-out, atravessando mês", () => {
    expect(noitesDaEstadia("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(noitesDaEstadia("2026-10-10", "2026-10-10")).toEqual([]);
  });
});

describe("unblockCalendarNight (real, com a Hostaway simulada)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("envia isAvailable 1, é idempotente e tolera noite já liberada", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const real = await vi.importActual<typeof import("@/lib/hostaway")>("@/lib/hostaway");
    const corpos: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (String(url).endsWith("/accessTokens")) {
          return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
        }
        corpos.push({ url: String(url), metodo: init?.method, corpo: JSON.parse(String(init?.body)) });
        // A Hostaway responde 200 mesmo quando a noite já está livre.
        return new Response(JSON.stringify({ status: "success" }), { status: 200 });
      }),
    );

    expect(await real.unblockCalendarNight(316007, "2026-10-10")).toBe(true);
    expect(await real.unblockCalendarNight(316007, "2026-10-10")).toBe(true);
    expect(corpos).toHaveLength(2);
    expect(corpos[0]).toEqual(corpos[1]);
    expect(corpos[0]).toMatchObject({
      metodo: "PUT",
      corpo: { startDate: "2026-10-10", endDate: "2026-10-10", isAvailable: 1 },
    });

    // O bloqueio segue mandando 0.
    expect(await real.blockCalendarNight(316007, "2026-10-10")).toBe(true);
    expect(corpos[2]).toMatchObject({ corpo: { isAvailable: 0 } });
    vi.restoreAllMocks();
  });

  it("devolve false sem lançar quando a Hostaway falha", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const real = await vi.importActual<typeof import("@/lib/hostaway")>("@/lib/hostaway");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (String(url).endsWith("/accessTokens")) {
          return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
        }
        throw new Error("rede caiu");
      }),
    );
    await expect(real.unblockCalendarNight(316007, "2026-10-10")).resolves.toBe(false);
    vi.restoreAllMocks();
  });
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

function semearDraft(propertyId = "solarium-1") {
  redis.kv.set(
    `draft:${DRAFT_ID}`,
    JSON.stringify({
      id: DRAFT_ID,
      propertyId,
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

const RECUSA_402 = {
  approved: false,
  returnMessage: "Não foi possível concluir o pagamento. Nenhum valor foi cobrado — tente novamente ou fale conosco no WhatsApp.",
};

function prepararRota(propertyId = "solarium-1") {
  redis.kv.clear();
  redis.ttls.clear();
  semearDraft(propertyId);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  mocks.createHostawayReservation.mockClear();
  mocks.enviarAlertaRecusa.mockClear();
  mocks.enviarAlertaEmAnalise.mockClear();
  mocks.blockCalendarNight.mockReset();
  mocks.blockCalendarNight.mockImplementation(async () => true);
  mocks.unblockCalendarNight.mockReset();
  mocks.unblockCalendarNight.mockImplementation(async () => true);
}

type Desfecho = "captura" | "recusa" | "analise";

// Desde a A2a o if lê o status normalizado: "1" e "Accept" em texto capturam.
// Review só muda de desfecho com a flag ligada.
const casosDecisao: Array<[string, CenarioGateway, Desfecho, Desfecho]> = [
  //  nome                    gateway                        flag off   flag on
  ["Unknown (0)", { fraudStatus: 0 }, "recusa", "recusa"],
  ["Accept (1)", { fraudStatus: 1 }, "captura", "captura"],
  ["Reject (2)", { fraudStatus: 2 }, "recusa", "recusa"],
  ["Review (3)", { fraudStatus: 3 }, "recusa", "analise"],
  ["Aborted (4)", { fraudStatus: 4 }, "recusa", "recusa"],
  ["Unfinished (5)", { fraudStatus: 5 }, "recusa", "recusa"],
  ['"1" como texto', { fraudStatus: "1" }, "captura", "captura"],
  ['"Accept" como texto', { fraudStatus: "Accept" }, "captura", "captura"],
  ['"accept" em minúsculas', { fraudStatus: "accept" }, "captura", "captura"],
  ['"Review" como texto', { fraudStatus: "Review" }, "recusa", "analise"],
  ['"2" como texto', { fraudStatus: "2" }, "recusa", "recusa"],
  ["bloco ausente", { semBloco: true }, "recusa", "recusa"],
];

async function conferirDesfecho(esperado: Desfecho, chamadas: string[], res: Response) {
  const corpo = await res.json();
  if (esperado === "captura") {
    expect(chamadas).toEqual(["autorizacao", "captura"]);
    expect(res.status).toBe(200);
    expect(corpo.approved).toBe(true);
    expect(mocks.createHostawayReservation).toHaveBeenCalledTimes(1);
    expect((await getDraft(DRAFT_ID))?.status).toBe("paid");
  } else if (esperado === "recusa") {
    expect(chamadas).toEqual(["autorizacao", "void"]);
    expect(res.status).toBe(402);
    expect(corpo).toEqual(RECUSA_402);
    expect(mocks.createHostawayReservation).not.toHaveBeenCalled();
    expect(mocks.blockCalendarNight).not.toHaveBeenCalled();
    const motivo = (mocks.enviarAlertaRecusa.mock.calls[0] as unknown as [{ motivo: string }])[0].motivo;
    expect(motivo).not.toMatch(/undefined/);
    expect((await getDraft(DRAFT_ID))?.status).toBe("pending");
  } else {
    expect(chamadas).toEqual(["autorizacao"]); // sem void e sem captura
    expect(res.status).toBe(202);
    expect(corpo).toEqual({
      approved: false,
      estado: "aguardando_analise",
      paymentId: PAYMENT_ID,
      redirectTo: `/reservar/${DRAFT_ID}/confirmacao`,
      returnMessage: expect.any(String),
    });
    expect(mocks.createHostawayReservation).not.toHaveBeenCalled();
    expect(mocks.enviarAlertaRecusa).not.toHaveBeenCalled();
    expect(mocks.enviarAlertaEmAnalise).toHaveBeenCalledTimes(1);
    expect((await getDraft(DRAFT_ID))?.status).toBe("aguardando_analise");
  }
}

describe("rota de crédito — flag ANTIFRAUDE_REVIEW_ENABLED desligada", () => {
  beforeEach(() => {
    delete process.env.ANTIFRAUDE_REVIEW_ENABLED;
    prepararRota();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(casosDecisao)("%s", async (_nome, cenario, flagOff) => {
    const chamadas = simularGateway(cenario);
    await conferirDesfecho(flagOff, chamadas, await postCredito(requisicaoCredito()));
  });

  it('"false" explícito também mantém o void em Review', async () => {
    process.env.ANTIFRAUDE_REVIEW_ENABLED = "false";
    const chamadas = simularGateway({ fraudStatus: 3 });
    await conferirDesfecho("recusa", chamadas, await postCredito(requisicaoCredito()));
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

describe("rota de crédito — flag ANTIFRAUDE_REVIEW_ENABLED ligada", () => {
  const ID_SOL1 = getPropertyBySlug("solarium-1")!.id;
  const ID_SOL2 = getPropertyBySlug("solarium-2")!.id;
  const ID_COMPLETO = getPropertyBySlug("solarium-completo")!.id;

  beforeEach(() => {
    process.env.ANTIFRAUDE_REVIEW_ENABLED = "true";
    prepararRota();
  });
  afterEach(() => {
    delete process.env.ANTIFRAUDE_REVIEW_ENABLED;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(casosDecisao)("%s", async (_nome, cenario, _flagOff, flagOn) => {
    const chamadas = simularGateway(cenario);
    await conferirDesfecho(flagOn, chamadas, await postCredito(requisicaoCredito()));
  });

  it("Review: draft em análise com PaymentId, valor, entrada e TTL estendido", async () => {
    simularGateway({ fraudStatus: 3 });
    await postCredito(requisicaoCredito());

    const draft = await getDraft(DRAFT_ID);
    expect(draft?.status).toBe("aguardando_analise");
    expect(draft?.braspagPaymentId).toBeUndefined(); // não é pagamento confirmado
    expect(draft?.analise).toMatchObject({
      paymentId: PAYMENT_ID,
      valorAutorizado: 1000,
      valorAutorizadoCentavos: 100000,
      parcelas: 1,
      bloqueios: [
        { listingId: ID_SOL1, noite: "2026-10-10" },
        { listingId: ID_SOL1, noite: "2026-10-11" },
      ],
    });
    expect(draft?.analise?.merchantOrderId.startsWith(DRAFT_ID)).toBe(true);
    expect(Date.parse(draft!.analise!.entrouEm)).not.toBeNaN();
    expect(redis.ttls.get(`draft:${DRAFT_ID}`)).toBe(DRAFT_TTL_ANALISE);
    expect(DRAFT_TTL_ANALISE).toBeGreaterThanOrEqual(12 * 3600);

    expect(mocks.blockCalendarNight.mock.calls).toEqual([
      [ID_SOL1, "2026-10-10"],
      [ID_SOL1, "2026-10-11"],
    ]);
    expect(mocks.unblockCalendarNight).not.toHaveBeenCalled();
  });

  it("Review no Completo bloqueia a listing do Completo e as duas casas", async () => {
    prepararRota("solarium-completo");
    simularGateway({ fraudStatus: 3 });
    await postCredito(requisicaoCredito());
    const bloqueios = (await getDraft(DRAFT_ID))?.analise?.bloqueios ?? [];
    for (const lid of [ID_COMPLETO, ID_SOL1, ID_SOL2]) {
      expect(bloqueios).toEqual(
        expect.arrayContaining([
          { listingId: lid, noite: "2026-10-10" },
          { listingId: lid, noite: "2026-10-11" },
        ]),
      );
    }
    expect(bloqueios).toHaveLength(6);
  });

  it("segunda tentativa no draft em análise não autoriza de novo", async () => {
    simularGateway({ fraudStatus: 3 });
    await postCredito(requisicaoCredito());
    const chamadas = simularGateway({ fraudStatus: 1 });
    const res = await postCredito(requisicaoCredito());
    expect(chamadas).toEqual([]);
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ estado: "aguardando_analise", paymentId: PAYMENT_ID });
  });

  it("SALVAGUARDA: bloqueio falhou → libera o que bloqueou e volta ao void", async () => {
    mocks.blockCalendarNight.mockImplementation(async (_lid: number, noite: string) => noite !== "2026-10-11");
    const chamadas = simularGateway({ fraudStatus: 3 });
    const res = await postCredito(requisicaoCredito());

    expect(chamadas).toEqual(["autorizacao", "void"]);
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual(RECUSA_402);
    expect(mocks.unblockCalendarNight.mock.calls).toEqual([[ID_SOL1, "2026-10-10"]]);
    const draft = await getDraft(DRAFT_ID);
    expect(draft?.status).toBe("pending");
    expect(draft?.analise).toBeUndefined();
    expect(mocks.enviarAlertaEmAnalise).not.toHaveBeenCalled();
    const motivo = (mocks.enviarAlertaRecusa.mock.calls[0] as unknown as [{ motivo: string }])[0].motivo;
    expect(motivo).toMatch(/bloqueio de calendário falhou em 2026-10-11/);
    expect(motivo).toMatch(/revertido para void/);
  });

  it("SALVAGUARDA: desbloqueio que também falha aparece no alerta", async () => {
    mocks.blockCalendarNight.mockImplementation(async (_lid: number, noite: string) => noite !== "2026-10-11");
    mocks.unblockCalendarNight.mockImplementation(async () => false);
    simularGateway({ fraudStatus: 3 });
    await postCredito(requisicaoCredito());
    const motivo = (mocks.enviarAlertaRecusa.mock.calls[0] as unknown as [{ motivo: string }])[0].motivo;
    expect(motivo).toMatch(/NÃO LIBERADAS, liberar à mão: 2026-10-10/);
  });

  it("Review não persiste PAN, CVV, nome, e-mail nem CPF no bloco de análise nem no af:*", async () => {
    simularGateway({ fraudStatus: 3 });
    await postCredito(requisicaoCredito());
    const draftBruto = String(redis.kv.get(`draft:${DRAFT_ID}`));
    const analise = JSON.stringify(JSON.parse(draftBruto).analise);
    for (const proibido of [PAN, CVV, NOME, "Maria Aparecida", EMAIL, CPF]) {
      expect(analise).not.toContain(proibido);
      expect(kvDeObservabilidade()).not.toContain(proibido);
    }
    // O draft já guardava os dados do hóspede antes; cartão nunca.
    expect(draftBruto).not.toContain(PAN);
    expect(draftBruto).not.toContain(CVV);
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

// ===========================================================================
// A2b — comunicação com o hóspede em aguardando_analise
// ===========================================================================

// Palavras que o hóspede nunca pode ler neste estado (com e sem acento).
const PROIBIDAS = [
  /avalia[cç][aã]o/i,
  /an[aá]lise/i,
  /risco/i,
  /antifraude/i,
  /pendente/i,
  /em processamento/i,
  /verifica[cç][aã]o/i,
  /reserva confirmada/i,
  /pagamento aprovado/i,
];

function semPalavraProibida(texto: string) {
  for (const re of PROIBIDAS) expect(texto, `contém ${re}`).not.toMatch(re);
}

function draftEmEspera(overrides: Partial<ReservationDraft> = {}): ReservationDraft {
  return {
    id: DRAFT_ID,
    propertyId: "solarium-1",
    propertyName: "Solarium 1",
    checkin: "2026-10-10",
    checkout: "2026-10-12",
    guests: 2,
    nights: 2,
    totalPrice: 1000,
    pixDiscount: 0,
    couponDiscount: 0,
    finalTotal: 1000,
    paymentMethod: "card",
    guestFirstName: "Maria Aparecida",
    guestLastName: "Souza",
    guestEmail: EMAIL,
    guestPhone: "35999999999",
    guestCpf: CPF,
    status: "aguardando_analise",
    analise: {
      paymentId: PAYMENT_ID,
      merchantOrderId: `${DRAFT_ID}-abc`,
      entrouEm: "2026-09-14T12:00:00Z",
      valorAutorizado: 1234.5,
      valorAutorizadoCentavos: 123450,
      parcelas: 3,
      bloqueios: [{ listingId: 316007, noite: "2026-10-10" }],
    },
    createdAt: "2026-09-14T00:00:00Z",
    expiresAt: "2026-09-14T02:00:00Z",
    ...overrides,
  };
}

async function renderizarConfirmacao(draft: ReservationDraft | null): Promise<string> {
  redis.kv.clear();
  if (draft) redis.kv.set(`draft:${DRAFT_ID}`, JSON.stringify(draft));
  return renderToStaticMarkup(await ConfirmacaoPage({ params: { draftId: DRAFT_ID } }));
}

describe("A2b — textos", () => {
  it("tela e e-mail não usam palavra proibida", () => {
    semPalavraProibida(Object.values(TEXTO_ESPERA).join(" "));
    const email = montarEmailEspera(draftEmEspera(), DRAFT_ID, 1234.5);
    semPalavraProibida(email.assunto);
    semPalavraProibida(email.html);
    semPalavraProibida(email.texto);
  });

  it("o e-mail traz nome, casa, datas, valor autorizado e WhatsApp, sem CPF", () => {
    const email = montarEmailEspera(draftEmEspera(), DRAFT_ID, 1234.5);
    expect(email.texto).toContain("Olá, Maria.");
    expect(email.texto).toContain("Solarium 1");
    expect(email.texto).toContain("10/10/2026");
    expect(email.texto).toContain("12/10/2026");
    expect(email.texto).toMatch(/Valor autorizado: R\$\s?1\.234,50/);
    expect(email.html).toContain("https://wa.me/");
    expect(email.texto).not.toContain(CPF);
    expect(email.html).not.toContain(CPF);
  });

  it("escapa HTML vindo do draft", () => {
    const email = montarEmailEspera(draftEmEspera({ guestFirstName: "<b>x</b>" }), DRAFT_ID, 10);
    expect(email.html).not.toContain("<b>x</b>");
  });
});

describe("A2b — página de confirmação", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("escolhe a variante pelo status", () => {
    expect(varianteConfirmacao({ status: "paid" })).toBe("confirmada");
    expect(varianteConfirmacao({ status: "aguardando_analise" })).toBe("espera");
    for (const s of ["pending", "failed", "expired"] as const) expect(varianteConfirmacao({ status: s })).toBe("sem-confirmacao");
    expect(varianteConfirmacao(null)).toBe("sem-confirmacao");
  });

  it("aprovado: confirmação de sempre, com purchase", async () => {
    const html = await renderizarConfirmacao(draftEmEspera({ status: "paid", analise: undefined }));
    expect(html).toContain("[[PURCHASE]]");
    expect(html).toContain("Sua reserva está feita!");
    expect(html).toContain("Total pago");
    expect(html).not.toContain(TEXTO_ESPERA.titulo);
  });

  it("aguardando_analise: variação de espera, sem purchase e sem palavra proibida", async () => {
    const html = await renderizarConfirmacao(draftEmEspera());
    expect(html).not.toContain("[[PURCHASE]]");
    expect(html).toContain(TEXTO_ESPERA.titulo);
    expect(html).toContain(TEXTO_ESPERA.corpo);
    expect(html).toContain("Valor autorizado");
    expect(html).toMatch(/1\.234,50/);
    expect(html).not.toContain("Total pago");
    expect(html).not.toContain("Sua reserva está feita");
    semPalavraProibida(html);
  });

  it.each(["pending", "failed", "expired"] as const)("recusado ou sem pagamento (%s): redireciona como antes", async (status) => {
    await expect(renderizarConfirmacao(draftEmEspera({ status }))).rejects.toThrow("REDIRECT:/");
  });

  it("draft inexistente: redireciona como antes", async () => {
    await expect(renderizarConfirmacao(null)).rejects.toThrow("REDIRECT:/");
  });
});

describe("A2b — e-mail ao hóspede sai uma vez só", () => {
  beforeEach(() => {
    process.env.ANTIFRAUDE_REVIEW_ENABLED = "true";
    prepararRota();
    mocks.enviarEmailHospede.mockReset();
    mocks.enviarEmailHospede.mockImplementation(async () => ({ enviado: true }));
  });
  afterEach(() => {
    delete process.env.ANTIFRAUDE_REVIEW_ENABLED;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("entrada em Review envia ao e-mail do hóspede e registra no alerta interno", async () => {
    simularGateway({ fraudStatus: 3 });
    const res = await postCredito(requisicaoCredito());
    semPalavraProibida((await res.json()).returnMessage);
    expect(mocks.enviarEmailHospede).toHaveBeenCalledTimes(1);
    const enviado = mocks.enviarEmailHospede.mock.calls[0][0];
    expect(enviado.para).toBe(EMAIL);
    semPalavraProibida(enviado.assunto + enviado.html + enviado.texto);
    expect(mocks.enviarAlertaEmAnalise.mock.calls[0][0].emailHospede).toBe("enviado");
  });

  it("reenvio do formulário e recarga da página não repetem o e-mail", async () => {
    simularGateway({ fraudStatus: 3 });
    await postCredito(requisicaoCredito());
    await postCredito(requisicaoCredito()); // reentrada: guarda do draft em análise
    await ConfirmacaoPage({ params: { draftId: DRAFT_ID } }); // recarga da confirmação
    await ConfirmacaoPage({ params: { draftId: DRAFT_ID } });
    expect(mocks.enviarEmailHospede).toHaveBeenCalledTimes(1);
  });

  it("falha no envio libera a trava: a próxima reentrada tenta de novo, e só uma vez", async () => {
    mocks.enviarEmailHospede.mockImplementationOnce(async () => ({ enviado: false, motivo: "Resend: domínio" }));
    simularGateway({ fraudStatus: 3 });
    await postCredito(requisicaoCredito());
    expect(mocks.enviarAlertaEmAnalise.mock.calls[0][0].emailHospede).toBe("NÃO ENVIADO (Resend: domínio)");

    await postCredito(requisicaoCredito());
    await postCredito(requisicaoCredito());
    expect(mocks.enviarEmailHospede).toHaveBeenCalledTimes(2); // a falha + um envio bem-sucedido
  });

  it("flag desligada: Review não envia e-mail ao hóspede", async () => {
    delete process.env.ANTIFRAUDE_REVIEW_ENABLED;
    simularGateway({ fraudStatus: 3 });
    await postCredito(requisicaoCredito());
    expect(mocks.enviarEmailHospede).not.toHaveBeenCalled();
  });

  it("draft sem bloco de análise não envia", async () => {
    expect(await enviarEmailEsperaUmaVez(draftEmEspera({ analise: undefined }), DRAFT_ID)).toMatch(/não enviado/);
    expect(mocks.enviarEmailHospede).not.toHaveBeenCalled();
  });
});

describe("A2b — enviarEmailHospede (real, Resend simulado)", () => {
  const dados = { para: EMAIL, assunto: "a", html: "<p>b</p>", texto: "b" };
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.resendSend.mockReset();
    mocks.resendSend.mockImplementation(async () => ({ error: null }));
    process.env.RESEND_API_KEY = "re_falsa";
  });
  afterEach(() => {
    delete process.env.EMAIL_REMETENTE_HOSPEDE;
    delete process.env.RESEND_API_KEY;
    vi.restoreAllMocks();
  });

  it("sem remetente de domínio não envia e diz por quê", async () => {
    const real = await vi.importActual<typeof import("@/lib/email")>("@/lib/email");
    expect(await real.enviarEmailHospede(dados)).toEqual({ enviado: false, motivo: "EMAIL_REMETENTE_HOSPEDE ausente" });
    expect(mocks.resendSend).not.toHaveBeenCalled();
  });

  it("recusa do Resend não é tratada como envio", async () => {
    process.env.EMAIL_REMETENTE_HOSPEDE = "Solarium <reservas@exemplo.com>";
    mocks.resendSend.mockImplementation(async () => ({ error: { message: "domain not verified" } }));
    const real = await vi.importActual<typeof import("@/lib/email")>("@/lib/email");
    expect(await real.enviarEmailHospede(dados)).toEqual({ enviado: false, motivo: "Resend: domain not verified" });
  });

  it("envia do remetente configurado para o hóspede, com texto e HTML", async () => {
    process.env.EMAIL_REMETENTE_HOSPEDE = "Solarium <reservas@exemplo.com>";
    const real = await vi.importActual<typeof import("@/lib/email")>("@/lib/email");
    expect(await real.enviarEmailHospede(dados)).toEqual({ enviado: true });
    expect(mocks.resendSend).toHaveBeenCalledWith({
      from: "Solarium <reservas@exemplo.com>",
      to: EMAIL,
      subject: "a",
      html: "<p>b</p>",
      text: "b",
    });
  });
});
