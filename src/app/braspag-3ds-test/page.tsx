"use client";

import { useEffect, useRef, useState } from "react";

// =============================================================================
// 1B — Página de teste ISOLADA do 3DS 2.0 (browser SDK da Braspag).
// NÃO faz parte do checkout real. Não linkada em nenhum menu/navegação.
// Objetivo: provar a mecânica do SDK e capturar o resultado da AUTENTICAÇÃO
// (Cavv, Eci, Xid, Version, ReferenceId). NÃO autoriza (isso é 1C).
//
// ORDEM DE INICIALIZAÇÃO (crítica):
//  O SDK dispara POST /v2/3ds/init já no LOAD do script (bpmpi_load), lendo o
//  bpmpi_accesstoken do DOM naquele instante. Portanto o token PRECISA estar
//  injetado ANTES de o script ser anexado. Fluxo ao montar:
//   (1) define window.bpmpi_config;
//   (2) busca o access token em /api/payments/braspag/3ds-session;
//   (3) injeta o token no input .bpmpi_accesstoken;
//   (4) SÓ ENTÃO anexa o script BP.Mpi.3ds20.min.js.
//  Cada RELOAD da página = token novo + init novo (token MPI é de curta duração).
//  3DS completo (com desafio): bpmpi_auth=true, bpmpi_auth_notifyonly=false.
//  Sandbox: Environment "SDB".
//
// SCRIPT SELF-HOSTED (exigência da doc: "O arquivo JavaScript deve ser salvo no
// servidor onde está a aplicação da loja"). O arquivo em
// public/scripts/BP.Mpi.3ds20.min.js foi baixado de
// https://mpisandbox.braspag.com.br/Scripts/BP.Mpi.3ds20.min.js em 2026-07-05.
// Se a Braspag atualizar o SDK, re-baixar dessa origem e recommitar.
// =============================================================================

const SDK_SRC = "/scripts/BP.Mpi.3ds20.min.js"; // mesmo domínio (self-hosted)
const SDK_SCRIPT_ID = "bpmpi-3ds20-sdk";

// Campos fixos do pedido/estabelecimento e billto (dados de TESTE) alinhados ao
// exemplo oficial. productcode = "PHY" (o domínio oficial não traz "ACC").
// transaction_mode = "S" conforme especificado.
const MERCHANT_URL = "https://staging.solariummantiqueira.com";
const ORDER_PRODUCTCODE = "PHY";
const TRANSACTION_MODE = "S";
const BILLTO = {
  name: "Teste Solarium",
  email: "teste@solariummantiqueira.com",
  phonenumber: "5535999990000",
  street1: "Rua das Flores, 100",
  city: "Itanhandu",
  state: "MG",
  country: "BR",
  zipcode: "37464000",
};

type AuthResult = {
  event: string;
  fields: Record<string, unknown>;
};

declare global {
  interface Window {
    bpmpi_config?: () => unknown;
    bpmpi_authenticate?: () => void;
  }
}

function pick(e: unknown): Record<string, unknown> {
  const ev = (e || {}) as Record<string, unknown>;
  return {
    Cavv: ev.Cavv,
    Eci: ev.Eci,
    Xid: ev.Xid,
    Version: ev.Version,
    ReferenceId: ev.ReferenceId,
    ReturnCode: ev.ReturnCode,
    ReturnMessage: ev.ReturnMessage,
  };
}

// URL exata que o SDK chama no load (sandbox), só para o diagnóstico.
const INIT_URL = "https://mpisandbox.braspag.com.br/v2/3ds/init";

// Decodifica APENAS o payload (parte do meio) de um JWT. NÃO expõe a assinatura.
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const json = decodeURIComponent(
      atob(b64)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(""),
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Serializa qualquer objeto (inclusive props não-enumeráveis de Error) sem
// quebrar em referências circulares.
function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(
      obj,
      (() => {
        const seen = new WeakSet();
        return (_k: string, v: unknown) => {
          if (typeof v === "object" && v !== null) {
            if (seen.has(v as object)) return "[circular]";
            seen.add(v as object);
          }
          return v;
        };
      })(),
      2,
    );
  } catch {
    try {
      return String(obj);
    } catch {
      return "[não serializável]";
    }
  }
}

export default function Braspag3dsTestPage() {
  const [sdkReady, setSdkReady] = useState(false);
  const [result, setResult] = useState<AuthResult | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [tokenInjected, setTokenInjected] = useState<boolean | null>(null);
  // Diagnóstico p/ enviar à Braspag
  const [tokenClaims, setTokenClaims] = useState<Record<string, unknown> | null>(null);
  const [establishmentCode, setEstablishmentCode] = useState<string>("(não setado)");
  const [errorObj, setErrorObj] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);

  // Formulário mínimo
  const [cardNumber, setCardNumber] = useState("4000000000002503");
  const [holder, setHolder] = useState("TESTE SOLARIUM");
  const [expiration, setExpiration] = useState("12/2030"); // MM/AAAA
  const [cvv, setCvv] = useState("123");
  const [amount, setAmount] = useState(1000); // centavos → R$ 10,00
  const [orderId, setOrderId] = useState("");
  const [installments, setInstallments] = useState(1);

  const initRef = useRef(false);
  // Container dos inputs bpmpi_*. Sincronizamos os DADOS do formulário
  // imperativamente no clique; o TOKEN é injetado no load (antes do script).
  const hiddenRef = useRef<HTMLDivElement>(null);

  function addLog(msg: string) {
    const ts = new Date().toLocaleTimeString("pt-BR");
    setLogs((prev) => [`[${ts}] ${msg}`, ...prev].slice(0, 30));
  }

  // Seta o valor do input TANTO na propriedade DOM (.value) QUANTO no atributo
  // HTML (setAttribute("value", …)). O SDK lê via .value, mas alguns fluxos leem
  // via getAttribute — setar ambos evita ler vazio.
  function setInput(cls: string, val: string) {
    const el = hiddenRef.current?.querySelector<HTMLInputElement>(`.${cls}`);
    if (el) {
      el.value = val;
      el.setAttribute("value", val);
    }
  }

  // orderId default gerado no cliente (evita mismatch de hidratação)
  useEffect(() => {
    if (!orderId) setOrderId(`3ds-test-${Date.now()}`);
  }, [orderId]);

  // Inicialização na ordem correta: config → token → injeta token → carrega script
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    // (1) bpmpi_config PRECISA existir antes do script
    window.bpmpi_config = function () {
      return {
        Debug: true,
        Environment: "SDB", // sandbox
        onReady: function () {
          setSdkReady(true);
          addLog("SDK pronto (onReady) — init /v2/3ds/init OK.");
        },
        onSuccess: function (e: unknown) {
          setResult({ event: "onSuccess", fields: pick(e) });
        },
        onFailure: function (e: unknown) {
          setResult({ event: "onFailure", fields: pick(e) });
        },
        onUnenrolled: function (e: unknown) {
          setResult({ event: "onUnenrolled", fields: pick(e) });
        },
        onDisabled: function () {
          setResult({ event: "onDisabled", fields: {} });
        },
        onError: function (e: unknown) {
          setResult({ event: "onError", fields: pick(e) });
          setErrorObj(e); // objeto COMPLETO para o diagnóstico
          addLog(`onError capturado: ${safeStringify(e)}`);
        },
        onUnsupportedBrand: function (e: unknown) {
          setResult({ event: "onUnsupportedBrand", fields: pick(e) });
        },
      };
    };

    // (2)(3)(4) busca token → injeta → só então carrega o script
    (async () => {
      try {
        const res = await fetch("/api/payments/braspag/3ds-session", { method: "POST" });
        const data = await res.json().catch(() => ({}));
        setEstablishmentCode(data.establishmentCode ?? "(não setado)");
        const ecLabel = `EstablishmentCode=${data.establishmentCode ?? "(não setado)"}`;

        if (!res.ok || !data.accessToken) {
          const detail =
            data.mpiStatus !== undefined
              ? `MPI ${data.mpiStatus}: ${JSON.stringify(data.mpiBody)}`
              : data.error || "sem accessToken";
          setTokenInjected(false);
          addLog(`Token injetado em bpmpi_accesstoken ANTES do load do script? NÃO — falha ao obter token (HTTP ${res.status}). ${ecLabel}. ${detail}`);
          addLog("Script NÃO carregado (sem token não faz sentido iniciar o SDK). Recarregue após corrigir o env.");
          return;
        }

        // (3) injeta o token ANTES do script
        setInput("bpmpi_accesstoken", data.accessToken);
        setTokenInjected(true);
        addLog(`Token injetado em bpmpi_accesstoken ANTES do load do script? SIM (${String(data.accessToken).length} chars, ${ecLabel}).`);

        // Decodifica o payload do JWT (sem assinatura) e exibe os claims.
        const claims = decodeJwtPayload(data.accessToken);
        setTokenClaims(claims);
        if (claims) {
          addLog(`Claims do token (payload, sem assinatura): ${safeStringify(claims)}`);
          const exp = typeof claims.exp === "number" ? claims.exp : undefined;
          if (exp) {
            const expMs = exp * 1000;
            const nowMs = Date.now();
            const expired = expMs <= nowMs;
            addLog(
              `Token exp=${new Date(expMs).toISOString()} | agora=${new Date(nowMs).toISOString()} | ${expired ? "EXPIRADO no init" : `válido (~${Math.round((expMs - nowMs) / 1000)}s restantes)`}`,
            );
          } else {
            addLog("Token sem claim 'exp' numérico (ver payload acima).");
          }
        } else {
          addLog("Não foi possível decodificar o payload do token como JWT.");
        }

        // Popula os demais inputs (fixos + formulário) ANTES do script, para que
        // o init já encontre tudo preenchido no DOM.
        syncStaticInputs();
        syncFormInputs();

        // (4) só agora carrega o script → dispara /v2/3ds/init com o token presente
        if (!document.getElementById(SDK_SCRIPT_ID)) {
          const s = document.createElement("script");
          s.id = SDK_SCRIPT_ID;
          s.src = SDK_SRC;
          s.async = true;
          s.onerror = () => addLog("ERRO: falha ao carregar o SDK BP.Mpi.3ds20.");
          document.body.appendChild(s);
          addLog("Script BP.Mpi.3ds20 anexado ao DOM (depois do token).");
        }
      } catch (err) {
        setTokenInjected(false);
        addLog(`Token injetado ANTES do load? NÃO — erro de rede ao obter token: ${(err as Error)?.message || "erro"}`);
      }
    })();
  }, []);

  // Campos fixos (estabelecimento + billto de teste). Não mudam com o formulário;
  // setados no load (antes do script) e reforçados no authenticate.
  function syncStaticInputs() {
    setInput("bpmpi_merchant_url", MERCHANT_URL);
    setInput("bpmpi_order_productcode", ORDER_PRODUCTCODE);
    setInput("bpmpi_transaction_mode", TRANSACTION_MODE);
    setInput("bpmpi_billto_name", BILLTO.name);
    setInput("bpmpi_billto_email", BILLTO.email);
    setInput("bpmpi_billto_phonenumber", BILLTO.phonenumber);
    setInput("bpmpi_billto_street1", BILLTO.street1);
    setInput("bpmpi_billto_city", BILLTO.city);
    setInput("bpmpi_billto_state", BILLTO.state);
    setInput("bpmpi_billto_country", BILLTO.country);
    setInput("bpmpi_billto_zipcode", BILLTO.zipcode);
  }

  // Sincroniza os DADOS do formulário com os inputs bpmpi_* usando os valores
  // ATUAIS. Não toca no token (esse é da sessão do load).
  function syncFormInputs() {
    const [m = "", y = ""] = expiration.split("/").map((s) => s.trim());
    setInput("bpmpi_ordernumber", orderId);
    setInput("bpmpi_currency", "BRL");
    setInput("bpmpi_totalamount", String(amount));
    setInput("bpmpi_installments", String(installments));
    setInput("bpmpi_paymentmethod", "credit");
    setInput("bpmpi_cardnumber", cardNumber);
    setInput("bpmpi_cardexpirationmonth", m);
    setInput("bpmpi_cardexpirationyear", y);
  }

  function authenticate() {
    if (!sdkReady) return;
    setResult(null);
    syncStaticInputs();
    syncFormInputs();
    addLog(`Autenticando com cartão …${cardNumber.slice(-4)}, valor ${amount}, order ${orderId}.`);
    if (typeof window.bpmpi_authenticate === "function") {
      window.bpmpi_authenticate();
    } else {
      addLog("SDK ainda não carregado (window.bpmpi_authenticate indisponível).");
    }
  }

  // Monta o texto de diagnóstico p/ enviar à Braspag e copia para o clipboard.
  function buildDiagnostic(): string {
    return [
      "=== Diagnóstico 3DS Braspag (MPI900 / 401 no /v2/3ds/init) ===",
      `Gerado em: ${new Date().toISOString()}`,
      `Environment: SDB (sandbox)`,
      `EstablishmentCode: ${establishmentCode}`,
      `URL do init: POST ${INIT_URL}`,
      "",
      "--- Token access (payload JWT decodificado, SEM assinatura) ---",
      tokenClaims ? safeStringify(tokenClaims) : "(sem claims — token não decodificado)",
      "",
      "--- onError retornado pelo SDK no init ---",
      errorObj !== null ? safeStringify(errorObj) : "(nenhum onError capturado até agora)",
    ].join("\n");
  }

  async function copyDiagnostic() {
    const text = buildDiagnostic();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      addLog("Diagnóstico copiado para a área de transferência.");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      addLog("Falha ao copiar automaticamente — texto do diagnóstico impresso no log abaixo:");
      addLog(text);
    }
  }

  const labelCls = "block text-sm font-medium text-gray-700 mb-1";
  const inputCls = "w-full rounded border border-gray-300 px-3 py-2 text-sm";

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-semibold mb-2">Teste 3DS 2.0 — Braspag (sandbox)</h1>
      <p className="text-sm text-gray-600 mb-2">
        Página isolada. Apenas autentica (3DS completo, com desafio) e exibe o resultado. Não
        autoriza, não faz parte do checkout real.
      </p>
      <p className="text-sm font-medium text-amber-700 mb-4">
        Para testar com um token fresco, RECARREGUE a página. Cada carregamento busca um token novo
        e refaz o init do SDK (o token MPI é de curta duração).
      </p>

      <div className="mb-4 text-sm space-y-1">
        <div>
          Token injetado antes do script:{" "}
          {tokenInjected === null ? (
            <span className="text-gray-500">carregando…</span>
          ) : tokenInjected ? (
            <span className="text-green-700">sim</span>
          ) : (
            <span className="text-red-700">não</span>
          )}
        </div>
        <div>
          SDK: {sdkReady ? <span className="text-green-700">pronto (onReady)</span> : <span className="text-gray-500">carregando…</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="col-span-2">
          <label className={labelCls}>Cartão</label>
          <input className={inputCls} value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className={labelCls}>Portador</label>
          <input className={inputCls} value={holder} onChange={(e) => setHolder(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Validade (MM/AAAA)</label>
          <input className={inputCls} value={expiration} onChange={(e) => setExpiration(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>CVV</label>
          <input className={inputCls} value={cvv} onChange={(e) => setCvv(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Valor (centavos)</label>
          <input
            className={inputCls}
            type="number"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        </div>
        <div>
          <label className={labelCls}>Parcelas</label>
          <input
            className={inputCls}
            type="number"
            value={installments}
            onChange={(e) => setInstallments(Number(e.target.value))}
          />
        </div>
        <div className="col-span-2">
          <label className={labelCls}>OrderId</label>
          <input className={inputCls} value={orderId} onChange={(e) => setOrderId(e.target.value)} />
        </div>
      </div>

      {/* ===================================================================
          Inputs lidos pelo SDK por classe bpmpi_*. Mantidos ocultos.
          - bpmpi_auth = true → autenticação habilitada (3DS completo).
          - bpmpi_auth_notifyonly = false → NÃO suprimir desafio (não é Data Only).
          - bpmpi_accesstoken é injetado no LOAD, antes do script (init).
          - Os demais são sincronizados do formulário a cada clique em Autenticar.
          - CVV NÃO tem classe bpmpi_* — é dado de autorização (1C).
          - O desafio é renderizado pelo próprio SDK; não há container nomeado.
         =================================================================== */}
      <div ref={hiddenRef} style={{ display: "none" }} aria-hidden>
        <input type="hidden" className="bpmpi_auth" defaultValue="true" />
        <input type="hidden" className="bpmpi_auth_notifyonly" defaultValue="false" />

        <input type="hidden" className="bpmpi_accesstoken" defaultValue="" />
        <input type="hidden" className="bpmpi_ordernumber" defaultValue="" />
        <input type="hidden" className="bpmpi_currency" defaultValue="BRL" />
        <input type="hidden" className="bpmpi_totalamount" defaultValue="" />
        <input type="hidden" className="bpmpi_installments" defaultValue="" />
        <input type="hidden" className="bpmpi_paymentmethod" defaultValue="credit" />

        <input type="hidden" className="bpmpi_cardnumber" defaultValue="" />
        <input type="hidden" className="bpmpi_cardexpirationmonth" defaultValue="" />
        <input type="hidden" className="bpmpi_cardexpirationyear" defaultValue="" />

        {/* Campos do exemplo oficial (estabelecimento + billto de teste).
            Valores setados via setInput (atributo + propriedade) em syncStaticInputs. */}
        <input type="hidden" className="bpmpi_merchant_url" defaultValue="" />
        <input type="hidden" className="bpmpi_order_productcode" defaultValue="" />
        <input type="hidden" className="bpmpi_transaction_mode" defaultValue="" />
        <input type="hidden" className="bpmpi_billto_name" defaultValue="" />
        <input type="hidden" className="bpmpi_billto_email" defaultValue="" />
        <input type="hidden" className="bpmpi_billto_phonenumber" defaultValue="" />
        <input type="hidden" className="bpmpi_billto_street1" defaultValue="" />
        <input type="hidden" className="bpmpi_billto_city" defaultValue="" />
        <input type="hidden" className="bpmpi_billto_state" defaultValue="" />
        <input type="hidden" className="bpmpi_billto_country" defaultValue="" />
        <input type="hidden" className="bpmpi_billto_zipcode" defaultValue="" />
      </div>

      <div className="flex gap-3">
        <button
          onClick={authenticate}
          disabled={!sdkReady}
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Autenticar
        </button>
        <button
          onClick={copyDiagnostic}
          className="rounded border border-gray-400 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
        >
          {copied ? "Copiado!" : "Copiar diagnóstico"}
        </button>
      </div>

      {result && (
        <div className="mt-6 rounded border border-gray-300 p-4">
          <div className="mb-2 text-sm font-semibold">
            Callback disparado: <span className="font-mono">{result.event}</span>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {Object.entries(result.fields).map(([k, v]) => (
                <tr key={k} className="border-t border-gray-100">
                  <td className="py-1 pr-4 font-medium text-gray-600">{k}</td>
                  <td className="py-1 font-mono break-all">{v === undefined || v === null ? "—" : String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Log visível na página: confirma a ORDEM (token antes do script) */}
      <div className="mt-6">
        <div className="mb-1 text-sm font-semibold">Log da sessão</div>
        <div className="rounded border border-gray-200 bg-gray-50 p-3 text-xs font-mono text-gray-700 max-h-56 overflow-auto">
          {logs.length === 0 ? (
            <div className="text-gray-400">sem eventos ainda…</div>
          ) : (
            logs.map((l, i) => <div key={i}>{l}</div>)
          )}
        </div>
      </div>
    </div>
  );
}
