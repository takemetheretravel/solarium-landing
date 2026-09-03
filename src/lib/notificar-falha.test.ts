import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/kv-store", () => ({
  getDraft: vi.fn(),
  podeNotificarFalha: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  enviarAlertaFalhaTerminal: vi.fn(),
}));

import { getDraft, podeNotificarFalha } from "@/lib/kv-store";
import { enviarAlertaFalhaTerminal } from "@/lib/email";
import { notificarFalhaTerminal } from "./notificar-falha";

const DRAFT = "861734d3-929c-4bf4-af67-5ff1f39a2b9b";

beforeEach(() => {
  vi.mocked(getDraft).mockReset().mockResolvedValue(null as never);
  vi.mocked(podeNotificarFalha).mockReset().mockResolvedValue(true);
  vi.mocked(enviarAlertaFalhaTerminal).mockReset().mockResolvedValue(undefined as never);
});

describe("anti-flood da notificação de falha", () => {
  it("notifica quando a janela está livre", async () => {
    await notificarFalhaTerminal({ draftId: DRAFT, provider: "braspag", motivo: "af" });
    expect(enviarAlertaFalhaTerminal).toHaveBeenCalledTimes(1);
  });

  it("NÃO notifica quando a janela de 15 min está fechada", async () => {
    vi.mocked(podeNotificarFalha).mockResolvedValue(false);
    await notificarFalhaTerminal({ draftId: DRAFT, provider: "braspag", motivo: "af" });
    expect(enviarAlertaFalhaTerminal).not.toHaveBeenCalled();
  });

  it("as 6 tentativas do incidente de 28/08 rendem 2 e-mails, não 6", async () => {
    // A janela abre uma vez, fecha nas quatro seguintes, e reabre na sexta —
    // que é o comportamento de `SET NX EX` com TTL de 15 min ao longo de 18.
    const janela = [true, false, false, false, false, true];
    for (const livre of janela) {
      vi.mocked(podeNotificarFalha).mockResolvedValueOnce(livre);
      await notificarFalhaTerminal({ draftId: DRAFT, provider: "braspag", motivo: "af" });
    }
    expect(enviarAlertaFalhaTerminal).toHaveBeenCalledTimes(2);
  });

  it("drafts diferentes não compartilham a janela", async () => {
    await notificarFalhaTerminal({ draftId: "a", provider: "cielo", motivo: "x" });
    await notificarFalhaTerminal({ draftId: "b", provider: "cielo", motivo: "x" });
    expect(podeNotificarFalha).toHaveBeenNthCalledWith(1, "a");
    expect(podeNotificarFalha).toHaveBeenNthCalledWith(2, "b");
    expect(enviarAlertaFalhaTerminal).toHaveBeenCalledTimes(2);
  });

  it("sem draftId não notifica nem consulta a janela", async () => {
    await notificarFalhaTerminal({ draftId: "", provider: "cielo", motivo: "x" });
    expect(podeNotificarFalha).not.toHaveBeenCalled();
    expect(enviarAlertaFalhaTerminal).not.toHaveBeenCalled();
  });

  it("enriquece com o draft quando ele existe", async () => {
    vi.mocked(getDraft).mockResolvedValue({
      finalTotal: 5700,
      propertyName: "Solarium 2",
      checkin: "2026-10-10",
      checkout: "2026-10-13",
      guestFirstName: "Ana",
      guestLastName: "Souza",
      guestEmail: "a@b.com",
      guestPhone: "+5535900000000",
    } as never);

    await notificarFalhaTerminal({ draftId: DRAFT, provider: "braspag", motivo: "af" });

    expect(enviarAlertaFalhaTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        valor: 5700,
        listing: "Solarium 2",
        hospede: "Ana Souza",
        contato: "a@b.com · +5535900000000",
      }),
    );
  });

  it("draft ausente ainda notifica — e-mail com menos campos vale mais que nenhum", async () => {
    vi.mocked(getDraft).mockRejectedValue(new Error("redis fora"));
    await notificarFalhaTerminal({ draftId: DRAFT, provider: "cielo", motivo: "excecao" });
    expect(enviarAlertaFalhaTerminal).toHaveBeenCalledTimes(1);
  });

  it("nunca lança, mesmo com o e-mail falhando", async () => {
    vi.mocked(enviarAlertaFalhaTerminal).mockRejectedValue(new Error("resend fora"));
    await expect(
      notificarFalhaTerminal({ draftId: DRAFT, provider: "cielo", motivo: "x" }),
    ).resolves.toBeUndefined();
  });
});
