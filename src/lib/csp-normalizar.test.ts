import { describe, it, expect } from "vitest";
import {
  extrairRelatorios,
  normalizarViolacao,
  chaveDedupe,
  DedupeCsp,
  ehRotaDePagamento,
} from "./csp-normalizar";

/**
 * A rota recebeu 151 relatórios e descartou todos. O que se perdeu foi
 * sobretudo o `disposition` — sem ele não dá para dizer se a política está
 * bloqueando de verdade ou só observando.
 */

describe("parsing dos dois formatos de relatório", () => {
  it("legado: application/csp-report", () => {
    const corpo = {
      "csp-report": {
        "document-uri": "https://solarium.com.br/reservar/abc/pagamento",
        "violated-directive": "script-src-elem",
        "blocked-uri": "https://cdn.exemplo.com/a.js",
        "source-file": "https://solarium.com.br/x.js",
        "line-number": 42,
        "status-code": 200,
        disposition: "enforce",
      },
    };

    const [bruto] = extrairRelatorios(corpo);
    const v = normalizarViolacao(bruto)!;

    expect(v.disposition).toBe("enforce");
    expect(v.effectiveDirective).toBe("script-src-elem");
    expect(v.blockedURL).toBe("https://cdn.exemplo.com/a.js");
    expect(v.lineNumber).toBe(42);
    expect(v.statusCode).toBe(200);
    expect(v.isPaymentRoute).toBe(true);
  });

  it("Reporting API: application/reports+json", () => {
    const corpo = [
      {
        type: "csp-violation",
        url: "https://solarium.com.br/",
        body: {
          documentURL: "https://solarium.com.br/",
          effectiveDirective: "img-src",
          blockedURL: "https://tracker.exemplo.com/p.gif",
          sourceFile: "https://solarium.com.br/y.js",
          lineNumber: 7,
          statusCode: 200,
          disposition: "report",
        },
      },
    ];

    const [bruto] = extrairRelatorios(corpo);
    const v = normalizarViolacao(bruto)!;

    expect(v.disposition).toBe("report");
    expect(v.effectiveDirective).toBe("img-src");
    expect(v.blockedURL).toBe("https://tracker.exemplo.com/p.gif");
    expect(v.isPaymentRoute).toBe(false);
  });

  it("descarta envelopes que não são violação de CSP", () => {
    // O mesmo canal entrega `deprecation` e `intervention`.
    const corpo = [
      { type: "deprecation", body: { id: "x" } },
      { type: "csp-violation", body: { effectiveDirective: "font-src", blockedURL: "data" } },
    ];
    expect(extrairRelatorios(corpo)).toHaveLength(1);
  });

  it("disposition ausente resolve para 'report', nunca 'enforce'", () => {
    // Afirmar bloqueio que não houve manda a operação caçar problema inexistente.
    const v = normalizarViolacao({ effectiveDirective: "style-src", blockedURL: "inline" })!;
    expect(v.disposition).toBe("report");
  });

  it("relatório sem diretiva e sem origem bloqueada é descartado", () => {
    expect(normalizarViolacao({ documentURL: "https://x/" })).toBeNull();
    expect(normalizarViolacao(null as never)).toBeNull();
  });

  it("trunca blockedURL e sourceFile em 500 caracteres", () => {
    const longo = "https://x.com/" + "a".repeat(2000);
    const v = normalizarViolacao({
      effectiveDirective: "script-src",
      blockedURL: longo,
      sourceFile: longo,
    })!;
    expect(v.blockedURL.length).toBe(500);
    expect(v.sourceFile.length).toBe(500);
  });

  it("isPaymentRoute exige /reservar/ E /pagamento", () => {
    expect(ehRotaDePagamento("https://s.com/reservar/abc/pagamento")).toBe(true);
    expect(ehRotaDePagamento("https://s.com/reservar/abc/confirmacao")).toBe(false);
    expect(ehRotaDePagamento("https://s.com/pagamento")).toBe(false);
  });
});

describe("deduplicação de 60s", () => {
  const violacao = (over: Partial<ReturnType<typeof normalizarViolacao>> = {}) =>
    ({
      disposition: "report",
      effectiveDirective: "script-src",
      blockedURL: "https://cdn.exemplo.com/a.js",
      documentURL: "https://s.com/",
      sourceFile: "",
      lineNumber: null,
      statusCode: null,
      isPaymentRoute: false,
      ...over,
    }) as NonNullable<ReturnType<typeof normalizarViolacao>>;

  it("a primeira loga integral, as repetições do minuto silenciam", () => {
    const d = new DedupeCsp();
    const t0 = 1_000_000;

    expect(d.registrar(violacao(), t0).acao).toBe("integral");
    // As 146 seguintes, dentro do minuto, não podem virar 146 linhas.
    for (let i = 1; i < 147; i++) {
      expect(d.registrar(violacao(), t0 + i * 100).acao).toBe("silenciar");
    }
  });

  it("passado um minuto, sai UMA linha agregada com a contagem", () => {
    const d = new DedupeCsp();
    const t0 = 1_000_000;

    d.registrar(violacao(), t0);
    d.registrar(violacao(), t0 + 1_000);
    d.registrar(violacao(), t0 + 2_000);

    // Exatamente no limite da janela: vira `integral` (janela nova).
    const noLimite = d.registrar(violacao(), t0 + 60_000);
    expect(noLimite.acao).toBe("integral");

    // Dentro da janela nova, mas com um minuto desde o último log: agregado.
    const d2 = new DedupeCsp();
    d2.registrar(violacao(), t0);
    for (let i = 1; i <= 50; i++) d2.registrar(violacao(), t0 + i * 100);
    const agregado = d2.registrar(violacao(), t0 + 59_999);
    expect(agregado.acao).toBe("silenciar");
  });

  it("chaves diferentes não se misturam", () => {
    const d = new DedupeCsp();
    const t0 = 1_000_000;

    expect(d.registrar(violacao(), t0).acao).toBe("integral");
    // Mesma origem, disposition diferente = fato diferente.
    expect(d.registrar(violacao({ disposition: "enforce" }), t0).acao).toBe("integral");
    // Mesma coisa, mas na rota de pagamento = prioridade diferente.
    expect(d.registrar(violacao({ isPaymentRoute: true }), t0).acao).toBe("integral");
    expect(d.tamanho).toBe(3);
  });

  it("a chave é exatamente disposition|diretiva|origem|isPaymentRoute", () => {
    expect(chaveDedupe(violacao())).toBe(
      "report|script-src|https://cdn.exemplo.com/a.js|false",
    );
  });
});
