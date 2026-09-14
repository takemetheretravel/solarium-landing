import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReservationDraft } from "@/lib/kv-store";

// Rodada AF1 — draft em `aguardando_analise` é recusado no servidor por toda
// rota de pagamento que recebe draftId, antes de qualquer chamada ao gateway.

const mocks = vi.hoisted(() => ({
  draft: null as unknown,
  getDraft: vi.fn(async () => mocks.draft),
  updateDraft: vi.fn(async () => {}),
  reservarEnvioUnico: vi.fn(async () => true),
  // gateways
  createPixPayment: vi.fn(async () => ({ paymentId: "cielo-pix", qrCodeBase64: "b64", qrCodeString: "copia", expiresAt: "x" })),
  createCreditPayment: vi.fn(async () => ({ approved: false, returnCode: "57", returnMessage: "negada", mensagemAmigavel: "Cartão recusado." })),
  getPaymentStatus: vi.fn(async () => ({ status: 1 })),
  createBraspagPixPayment: vi.fn(async () => ({ paymentId: "braspag-pix", qrCodeString: "copia", statusCode: 12, status: 201 })),
  confirmPixPaymentIfPaid: vi.fn(async () => ({ status: "pending" })),
  // efeitos colaterais
  enviarAlertaBloqueioAnalise: vi.fn(async () => {}),
  enviarAlertaRecusa: vi.fn(async () => {}),
  enviarAlertaAprovacao: vi.fn(async () => {}),
  createHostawayReservation: vi.fn(async () => null),
}));

vi.mock("@/lib/kv-store", () => ({
  getDraft: mocks.getDraft,
  updateDraft: mocks.updateDraft,
  reservarEnvioUnico: mocks.reservarEnvioUnico,
  liberarEnvioUnico: vi.fn(async () => {}),
}));
vi.mock("@/lib/cielo", () => ({
  createPixPayment: mocks.createPixPayment,
  createCreditPayment: mocks.createCreditPayment,
  getPaymentStatus: mocks.getPaymentStatus,
}));
vi.mock("@/lib/braspag", () => ({ createBraspagPixPayment: mocks.createBraspagPixPayment }));
vi.mock("@/lib/braspag-pix-confirm", () => ({ confirmPixPaymentIfPaid: mocks.confirmPixPaymentIfPaid }));
vi.mock("@/lib/email", () => ({
  enviarAlertaBloqueioAnalise: mocks.enviarAlertaBloqueioAnalise,
  enviarAlertaRecusa: mocks.enviarAlertaRecusa,
  enviarAlertaAprovacao: mocks.enviarAlertaAprovacao,
  enviarEmailHospede: vi.fn(),
}));
vi.mock("@/lib/hostaway", () => ({ createHostawayReservation: mocks.createHostawayReservation }));
vi.mock("@/lib/op-extras-server", () => ({ blockOpExtraNights: vi.fn(async () => ({ todasBloqueadas: false, resultados: [] })) }));
vi.mock("@/lib/reserva-pacote", () => ({ paramsDePacote: () => ({}), extrasProvidenciar: () => [] }));
vi.mock("@/lib/pix-pricing", () => ({ pixChargeFromDraft: () => ({ subtotalCents: 100000, discountCents: 5000, totalCents: 95000 }) }));
vi.mock("@/config/properties", () => ({ getPropertyBySlug: () => undefined }));
vi.mock("@/config/service-extras", () => ({ enrichServiceExtras: (x: unknown) => x }));

import { POST as cieloPix } from "@/app/api/payments/pix/route";
import { GET as cieloPixStatus } from "@/app/api/payments/pix/status/route";
import { POST as cieloCredit } from "@/app/api/payments/credit/route";
import { POST as braspagPix } from "@/app/api/payments/braspag/pix/route";
import { GET as braspagPixStatus } from "@/app/api/payments/braspag/pix/status/route";

const DRAFT_ID = "draft-af1";
const PAYMENT_ID = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
const BASE = "https://solarium.test";

function montarDraft(status: ReservationDraft["status"], extra: Partial<ReservationDraft> = {}): ReservationDraft {
  return {
    id: DRAFT_ID,
    status,
    propertyId: "solarium-1",
    propertyName: "Solarium 1",
    paymentMethod: "pix",
    finalTotal: 950,
    nights: 2,
    guests: 2,
    checkin: "2099-01-10",
    checkout: "2099-01-12",
    guestFirstName: "Hóspede",
    guestLastName: "Teste",
    guestEmail: "hospede@exemplo.test",
    guestPhone: "+550000000000",
    guestCpf: "00000000000",
    cieloPaymentId: "cielo-anterior",
    ...(status === "aguardando_analise" ? { analise: { paymentId: PAYMENT_ID } } : {}),
    ...extra,
  } as unknown as ReservationDraft;
}

const post = (url: string, corpo: unknown) =>
  new Request(BASE + url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });

type Rota = {
  nome: string;
  chamar: () => Promise<Response>;
  gateway: () => unknown[];
};

const cartao = { cardNumber: "4000000000000010", cardHolder: "TESTE", cardExpiration: "01/2099", cardCvv: "123", installments: 1 };

const rotas: Rota[] = [
  { nome: "/api/payments/pix", chamar: () => cieloPix(post("/api/payments/pix", { draftId: DRAFT_ID })), gateway: () => mocks.createPixPayment.mock.calls },
  {
    nome: "/api/payments/pix/status",
    chamar: () => cieloPixStatus(new Request(`${BASE}/api/payments/pix/status?draftId=${DRAFT_ID}`)),
    gateway: () => mocks.getPaymentStatus.mock.calls,
  },
  {
    nome: "/api/payments/credit",
    chamar: () => cieloCredit(post("/api/payments/credit", { draftId: DRAFT_ID, ...cartao })),
    gateway: () => mocks.createCreditPayment.mock.calls,
  },
  {
    nome: "/api/payments/braspag/pix",
    chamar: () => braspagPix(post("/api/payments/braspag/pix", { draftId: DRAFT_ID })),
    gateway: () => mocks.createBraspagPixPayment.mock.calls,
  },
  {
    nome: "/api/payments/braspag/pix/status",
    chamar: () => braspagPixStatus(new Request(`${BASE}/api/payments/braspag/pix/status?draftId=${DRAFT_ID}`)),
    gateway: () => mocks.confirmPixPaymentIfPaid.mock.calls,
  },
];

const PROIBIDAS_HOSPEDE = ["avaliação", "análise", "analise", "risco", "antifraude", "pendente", "em processamento", "verificação", "confirmada", "aprovado"];

let erros: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  erros = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    erros.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe.each(rotas)("$nome com draft em aguardando_analise", (r) => {
  beforeEach(() => {
    mocks.draft = montarDraft("aguardando_analise");
  });

  it("recusa com 409, sem chamar gateway nem alterar o draft", async () => {
    const res = await r.chamar();
    expect(res.status).toBe(409);
    expect(r.gateway()).toHaveLength(0);
    expect(mocks.createPixPayment).not.toHaveBeenCalled();
    expect(mocks.createCreditPayment).not.toHaveBeenCalled();
    expect(mocks.getPaymentStatus).not.toHaveBeenCalled();
    expect(mocks.createBraspagPixPayment).not.toHaveBeenCalled();
    expect(mocks.confirmPixPaymentIfPaid).not.toHaveBeenCalled();
    expect(mocks.updateDraft).not.toHaveBeenCalled();
    expect(mocks.createHostawayReservation).not.toHaveBeenCalled();
  });

  it("resposta ao hóspede sem linguagem proibida e com o contrato que a tela lê", async () => {
    const corpo = await (await r.chamar()).json();
    expect(corpo).toMatchObject({ approved: false, estado: "aguardando_analise", redirectTo: `/reservar/${DRAFT_ID}/confirmacao` });
    expect(corpo.error).toBe(corpo.returnMessage);
    const texto = `${corpo.error}`.toLowerCase();
    for (const p of PROIBIDAS_HOSPEDE) expect(texto).not.toContain(p);
  });

  it("log e alerta dizem que veio do estado de análise e como resolver", async () => {
    await r.chamar();
    const log = erros.find((e) => e.includes("[Bloqueio:aguardando_analise]"));
    expect(log).toBeDefined();
    expect(log).toContain(r.nome);
    expect(log).toContain(PAYMENT_ID);
    expect(log).toContain("/api/admin/antifraude");
    expect(log).not.toContain("hospede@exemplo.test");
    expect(log).not.toContain("00000000000");

    expect(mocks.enviarAlertaBloqueioAnalise).toHaveBeenCalledTimes(1);
    expect(mocks.enviarAlertaBloqueioAnalise).toHaveBeenCalledWith(
      expect.objectContaining({ rota: r.nome, draftId: DRAFT_ID, paymentId: PAYMENT_ID, resolver: expect.stringContaining("/api/admin/antifraude") }),
    );
  });

  it("alerta sai uma vez por janela; o bloqueio vale em toda chamada", async () => {
    mocks.reservarEnvioUnico.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect((await r.chamar()).status).toBe(409);
    expect((await r.chamar()).status).toBe(409);
    expect(mocks.enviarAlertaBloqueioAnalise).toHaveBeenCalledTimes(1);
    expect(r.gateway()).toHaveLength(0);
  });
});

describe.each(["pending", "paid", "failed", "expired"] as const)("draft em %s — comportamento inalterado", (status) => {
  beforeEach(() => {
    mocks.draft = montarDraft(status);
  });

  it("nenhuma rota barra nem alerta", async () => {
    for (const r of rotas) {
      const res = await r.chamar();
      expect(res.status, r.nome).not.toBe(409);
    }
    expect(erros.some((e) => e.includes("[Bloqueio:aguardando_analise]"))).toBe(false);
    expect(mocks.enviarAlertaBloqueioAnalise).not.toHaveBeenCalled();
  });

  it("criação de Pix Cielo chama o gateway e responde o QR", async () => {
    const res = await cieloPix(post("/api/payments/pix", { draftId: DRAFT_ID }));
    expect(res.status).toBe(200);
    expect(mocks.createPixPayment).toHaveBeenCalledTimes(1);
    expect(await res.json()).toMatchObject({ paymentId: "cielo-pix", qrCodeString: "copia" });
  });

  it("cartão Cielo chama o gateway (recusa simulada → 402)", async () => {
    const res = await cieloCredit(post("/api/payments/credit", { draftId: DRAFT_ID, ...cartao }));
    expect(mocks.createCreditPayment).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(402);
  });

  it("criação de Pix Braspag chama o gateway", async () => {
    const res = await braspagPix(post("/api/payments/braspag/pix", { draftId: DRAFT_ID }));
    expect(res.status).toBe(200);
    expect(mocks.createBraspagPixPayment).toHaveBeenCalledTimes(1);
  });

  it("status do Pix Braspag delega à confirmação", async () => {
    const res = await braspagPixStatus(new Request(`${BASE}/api/payments/braspag/pix/status?draftId=${DRAFT_ID}`));
    expect(mocks.confirmPixPaymentIfPaid).toHaveBeenCalledWith(DRAFT_ID);
    expect(await res.json()).toEqual({ status: "pending" });
  });

  it("status do Pix Cielo segue o próprio fluxo", async () => {
    const res = await cieloPixStatus(new Request(`${BASE}/api/payments/pix/status?draftId=${DRAFT_ID}`));
    const corpo = await res.json();
    if (status === "paid") {
      expect(corpo).toEqual({ status: "paid", redirectTo: `/reservar/${DRAFT_ID}/confirmacao` });
      expect(mocks.getPaymentStatus).not.toHaveBeenCalled();
    } else {
      expect(mocks.getPaymentStatus).toHaveBeenCalledWith("cielo-anterior");
      expect(corpo).toEqual({ status: "pending" });
    }
  });
});

describe("sem draft", () => {
  it("rotas seguem respondendo como antes", async () => {
    mocks.draft = null;
    expect((await cieloPix(post("/api/payments/pix", { draftId: DRAFT_ID }))).status).toBe(404);
    expect(await (await cieloPixStatus(new Request(`${BASE}/api/payments/pix/status?draftId=${DRAFT_ID}`))).json()).toEqual({ status: "expired" });
    expect((await braspagPix(post("/api/payments/braspag/pix", { draftId: DRAFT_ID }))).status).toBe(404);
    await braspagPixStatus(new Request(`${BASE}/api/payments/braspag/pix/status?draftId=${DRAFT_ID}`));
    expect(mocks.confirmPixPaymentIfPaid).toHaveBeenCalledWith(DRAFT_ID);
    expect(mocks.enviarAlertaBloqueioAnalise).not.toHaveBeenCalled();
  });
});
