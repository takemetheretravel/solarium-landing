import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Rodada PAG1 — a página de pagamento tem root layout próprio, sem analytics.

// O Vitest compila o JSX no modo clássico (React.createElement).
(globalThis as unknown as { React: typeof React }).React = React;

vi.mock("next/font/google", () => ({
  Cormorant_Garamond: () => ({ variable: "font-serif", className: "font-serif" }),
  Inter: () => ({ variable: "font-sans", className: "font-sans" }),
}));
// next/script não emite nada no SSR (afterInteractive entra no cliente). O mock
// materializa o script para o teste enxergar o que o layout pede.
vi.mock("next/script", () => ({
  default: (p: { id?: string; src?: string; children?: string }) =>
    createElement("script", { id: p.id, src: p.src, dangerouslySetInnerHTML: { __html: p.children ?? "" } }),
}));
vi.mock("@/components/layout/Header", () => ({ default: () => createElement("header") }));
vi.mock("@/components/layout/Footer", () => ({ default: () => createElement("footer") }));
vi.mock("@/components/ui/FloatingWhatsApp", () => ({ default: () => createElement("aside") }));

import SiteLayout from "@/app/(site)/layout";
import CheckoutLayout from "@/app/(checkout)/layout";
import { quandoAnalyticsPronto } from "@/lib/tracking";

const RAIZ = path.resolve(__dirname, "..");
const APP = path.join(RAIZ, "app");

function listar(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? listar(p) : [p];
  });
}

/** Caminho de arquivo → URL, sem os route groups. */
function url(arquivo: string): string {
  const segs = path
    .relative(APP, path.dirname(arquivo))
    .split(path.sep)
    .filter((s) => s && !/^\(.+\)$/.test(s));
  return "/" + segs.join("/");
}

const envOriginal = { ...process.env };
afterEach(() => {
  process.env = { ...envOriginal };
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ===========================================================================
describe("URLs inalteradas", () => {
  it("as páginas respondem exatamente nas mesmas URLs de antes da PAG1", () => {
    const paginas = listar(APP)
      .filter((f) => path.basename(f) === "page.tsx")
      .map(url)
      .sort();
    expect(paginas).toEqual(
      [
        "/",
        "/[propertyId]",
        "/braspag-3ds-test",
        "/experiencias",
        "/ofertas",
        "/pacotes",
        "/pacotes/[slug]",
        "/parceiros",
        "/privacidade",
        "/reservar",
        "/reservar/[draftId]/confirmacao",
        "/reservar/[draftId]/pagamento",
        "/termos",
      ].sort(),
    );
  });

  it("pagamento em (checkout), confirmação em (site)", () => {
    expect(existsSync(path.join(APP, "(checkout)/reservar/[draftId]/pagamento/page.tsx"))).toBe(true);
    expect(existsSync(path.join(APP, "(site)/reservar/[draftId]/confirmacao/page.tsx"))).toBe(true);
  });

  it("exatamente dois root layouts, nenhum na raiz de app/", () => {
    expect(existsSync(path.join(APP, "layout.tsx"))).toBe(false);
    const raizes = listar(APP)
      .filter((f) => path.basename(f) === "layout.tsx" && /<html\b/.test(readFileSync(f, "utf-8")))
      .map((f) => path.relative(APP, f).split(path.sep).join("/"))
      .sort();
    expect(raizes).toEqual(["(checkout)/layout.tsx", "(site)/layout.tsx"]);
  });

  it("webhooks, cron e 3DS mantêm os endereços", () => {
    for (const r of ["webhooks/cielo", "webhooks/braspag", "payments/braspag/pix-reconcile"]) {
      expect(existsSync(path.join(APP, "api", r, "route.ts"))).toBe(true);
    }
    const vercel = JSON.parse(readFileSync(path.join(RAIZ, "..", "vercel.json"), "utf-8"));
    expect(vercel.crons.map((c: { path: string }) => c.path)).toContain("/api/payments/braspag/pix-reconcile");
    // O 3DS não usa URL de retorno por redirect; o único endereço que ele leva é o do lojista.
    const cliente3ds = readFileSync(path.join(RAIZ, "lib/braspag-3ds-client.ts"), "utf-8");
    expect(cliente3ds).toContain('const MERCHANT_URL = "https://solariummantiqueira.com";');
  });

  it("o gateway devolve o hóspede para a confirmação no mesmo endereço", () => {
    for (const f of ["app/api/payments/braspag/credit/route.ts", "lib/braspag-pix-confirm.ts", "lib/bloqueio-analise.ts"]) {
      expect(readFileSync(path.join(RAIZ, f), "utf-8")).toContain("`/reservar/${draftId}/confirmacao`");
    }
  });
});

// ===========================================================================
// Tudo que a árvore (checkout) alcança por import — não só os arquivos da pasta.
function alcancaveis(): Map<string, string> {
  const vistos = new Map<string, string>();
  const resolver = (de: string, esp: string): string | null => {
    let base: string;
    if (esp.startsWith("@/")) base = path.join(RAIZ, esp.slice(2));
    else if (esp.startsWith(".")) base = path.resolve(path.dirname(de), esp);
    else return null;
    for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
      if (existsSync(c) && statSync(c).isFile()) return c;
    }
    return null;
  };
  const visitar = (f: string) => {
    if (vistos.has(f) || !/\.tsx?$/.test(f)) return;
    const fonte = readFileSync(f, "utf-8");
    vistos.set(f, fonte);
    for (const m of Array.from(fonte.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g))) {
      const alvo = resolver(f, m[1]);
      if (alvo) visitar(alvo);
    }
  };
  for (const f of listar(path.join(APP, "(checkout)"))) visitar(f);
  return vistos;
}

describe("página de pagamento sem analytics", () => {
  const PROIBIDO = /googletagmanager|G-9J8F6Q1Y2M|GTM-|\bgtag\b|\bfbq\b|connect\.facebook\.net|fbevents|@\/lib\/tracking|analyticsAtivo/;

  it("nenhum módulo alcançável a partir de (checkout) carrega GA4, Meta Pixel ou GTM", () => {
    const mods = alcancaveis();
    expect(mods.size).toBeGreaterThan(5);
    const culpados = Array.from(mods).filter(([, fonte]) => PROIBIDO.test(fonte)).map(([f]) => path.relative(RAIZ, f));
    expect(culpados).toEqual([]);
  });

  it("o único next/script da árvore é o da ThreatMetrix", () => {
    const comScript = Array.from(alcancaveis())
      .filter(([, fonte]) => /from ["']next\/script["']/.test(fonte))
      .map(([f]) => path.basename(f));
    expect(comScript).toEqual(["FingerprintCybersource.tsx"]);
  });

  it("o layout (checkout) renderizado em produção não traz script de terceiros", () => {
    process.env.VERCEL_ENV = "production";
    const html = renderToStaticMarkup(CheckoutLayout({ children: createElement("main", null, "pagamento") }));
    expect(html).toContain("pagamento");
    expect(html).not.toMatch(/<script/);
    expect(html).not.toMatch(/googletagmanager|fbevents|G-9J8F6Q1Y2M/);
  });

  it("o add_payment_info saiu da página de pagamento e foi para o formulário", () => {
    const form = readFileSync(path.join(RAIZ, "components/booking/GuestForm.tsx"), "utf-8");
    expect(form).toMatch(/trackAddPaymentInfo\(\{ value: data\.finalTotal/);
  });
});

// ===========================================================================
describe("confirmação continua com analytics e purchase", () => {
  it("o layout (site) em produção carrega GA4 e Meta Pixel", () => {
    process.env.VERCEL_ENV = "production";
    const html = renderToStaticMarkup(SiteLayout({ children: createElement("main", null, "site") }));
    expect(html).toContain("googletagmanager.com/gtag/js?id=G-9J8F6Q1Y2M");
    expect(html).toContain("fbevents.js");
  });

  it("a página de confirmação ainda monta o TrackPurchase", () => {
    const fonte = readFileSync(path.join(APP, "(site)/reservar/[draftId]/confirmacao/page.tsx"), "utf-8");
    expect(fonte).toMatch(/<TrackPurchase\b/);
  });
});

// ===========================================================================
describe("quandoAnalyticsPronto", () => {
  it("espera o gtag e o fbq aparecerem para disparar", () => {
    vi.useFakeTimers();
    const w: Record<string, unknown> = {};
    vi.stubGlobal("window", w);
    const cb = vi.fn();
    quandoAnalyticsPronto(cb);
    vi.advanceTimersByTime(500);
    expect(cb).not.toHaveBeenCalled();
    w.gtag = () => {};
    w.fbq = () => {};
    vi.advanceTimersByTime(100);
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(20_000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("dispara na hora quando já estão prontos", () => {
    vi.stubGlobal("window", { gtag: () => {}, fbq: () => {} });
    const cb = vi.fn();
    quandoAnalyticsPronto(cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("no teto dispara mesmo sem analytics (preview: no-op)", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {});
    const cb = vi.fn();
    quandoAnalyticsPronto(cb);
    vi.advanceTimersByTime(9_900);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("cancelado no cleanup, não dispara", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {});
    const cb = vi.fn();
    quandoAnalyticsPronto(cb)();
    vi.advanceTimersByTime(20_000);
    expect(cb).not.toHaveBeenCalled();
  });
});
