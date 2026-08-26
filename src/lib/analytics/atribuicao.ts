"use client";

/**
 * Atribuição da sessão: `gclid` e `utm_*`.
 *
 * Capturados na PRIMEIRA página que o hóspede abre e guardados pela aba. Sem
 * isso a informação se perde na primeira navegação interna, e o envio
 * server-side da conversão — que acontece depois do webhook, sem navegador por
 * perto — fica sem origem.
 *
 * Só o primeiro toque é gravado: uma volta pelo site pela busca orgânica não
 * apaga o clique de anúncio que trouxe a pessoa.
 */

const CHAVE = "solarium:atribuicao";

export type Atribuicao = {
  gclid?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  landing_page?: string;
  capturado_em?: string;
};

const CAMPOS_UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

/** Valores vindos da URL: truncados, para não guardar querystring inteira. */
function limpar(v: string | null): string | undefined {
  const s = (v || "").trim();
  return s ? s.slice(0, 200) : undefined;
}

/**
 * Grava a atribuição desta sessão, se ainda não houver uma. Idempotente e
 * seguro de chamar em toda montagem de página.
 */
export function capturarAtribuicao(): void {
  if (typeof window === "undefined") return;
  try {
    if (window.sessionStorage.getItem(CHAVE)) return;

    const params = new URLSearchParams(window.location.search);
    const dados: Atribuicao = {};
    const gclid = limpar(params.get("gclid"));
    if (gclid) dados.gclid = gclid;
    for (const campo of CAMPOS_UTM) {
      const valor = limpar(params.get(campo));
      if (valor) dados[campo] = valor;
    }

    // Sem nenhum parâmetro não há atribuição a guardar — gravar um registro
    // vazio só impediria a captura de um clique de anúncio numa aba reusada.
    if (Object.keys(dados).length === 0) return;

    dados.landing_page = window.location.pathname.slice(0, 200);
    dados.capturado_em = new Date().toISOString();
    window.sessionStorage.setItem(CHAVE, JSON.stringify(dados));
  } catch {
    // sessionStorage bloqueado: a conversão segue sem atribuição.
  }
}

/** `null` quando não houve clique identificável — nunca bloqueia o checkout. */
export function lerAtribuicao(): Atribuicao | null {
  if (typeof window === "undefined") return null;
  try {
    const bruto = window.sessionStorage.getItem(CHAVE);
    return bruto ? (JSON.parse(bruto) as Atribuicao) : null;
  } catch {
    return null;
  }
}
