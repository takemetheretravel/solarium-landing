"use client";

import { useEffect, useRef, useState } from "react";

// =============================================================================
// 1B — Página de teste ISOLADA do 3DS 2.0 (browser SDK da Braspag).
// NÃO faz parte do checkout real. Não linkada em nenhum menu/navegação.
// Objetivo: provar a mecânica do SDK e capturar o resultado da AUTENTICAÇÃO
// (Cavv, Eci, Xid, Version, ReferenceId). NÃO autoriza (isso é 1C).
//
// Mecânica do SDK (doc oficial Cielo/Braspag):
//  - window.bpmpi_config() é lido pelo script para obter Environment/Debug e
//    os callbacks de resultado. Deve existir ANTES de o script carregar.
//  - Os DADOS da transação são lidos do HTML por classes "bpmpi_*" nos inputs.
//  - window.bpmpi_authenticate() dispara o fluxo (desafio no navegador).
//  - Sandbox: Environment "SDB" + script mpisandbox.braspag.com.br.
// =============================================================================

const SDK_SRC = "https://mpisandbox.braspag.com.br/Scripts/BP.Mpi.3ds20.min.js";
const SDK_SCRIPT_ID = "bpmpi-3ds20-sdk";

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

export default function Braspag3dsTestPage() {
  const [accessToken, setAccessToken] = useState("");
  const [tokenError, setTokenError] = useState("");
  const [sdkReady, setSdkReady] = useState(false);
  const [result, setResult] = useState<AuthResult | null>(null);

  // Formulário mínimo
  const [cardNumber, setCardNumber] = useState("4551870000000183");
  const [holder, setHolder] = useState("TESTE SOLARIUM");
  const [expiration, setExpiration] = useState("12/2030"); // MM/AAAA
  const [cvv, setCvv] = useState("123");
  const [amount, setAmount] = useState(1000); // centavos → R$ 10,00
  const [orderId, setOrderId] = useState("");
  const [installments, setInstallments] = useState(1);

  const configuredRef = useRef(false);

  // orderId default gerado no cliente (evita mismatch de hidratação)
  useEffect(() => {
    if (!orderId) setOrderId(`3ds-test-${Date.now()}`);
  }, [orderId]);

  // 1) Busca o access token da sessão 3DS
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/payments/braspag/3ds-session", { method: "POST" });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.accessToken) {
          setTokenError(data.error || `HTTP ${res.status}`);
          return;
        }
        setAccessToken(data.accessToken);
      } catch (err) {
        if (!cancelled) setTokenError((err as Error)?.message || "erro de rede");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 2) Define window.bpmpi_config ANTES do script e carrega o SDK
  useEffect(() => {
    if (configuredRef.current) return;
    configuredRef.current = true;

    window.bpmpi_config = function () {
      return {
        Debug: true,
        Environment: "SDB", // sandbox
        onReady: function () {
          setSdkReady(true);
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
        },
        onUnsupportedBrand: function (e: unknown) {
          setResult({ event: "onUnsupportedBrand", fields: pick(e) });
        },
      };
    };

    // Carrega o script só DEPOIS de bpmpi_config estar definido
    if (!document.getElementById(SDK_SCRIPT_ID)) {
      const s = document.createElement("script");
      s.id = SDK_SCRIPT_ID;
      s.src = SDK_SRC;
      s.async = true;
      s.onerror = () => setTokenError("Falha ao carregar o SDK BP.Mpi.3ds20.");
      document.body.appendChild(s);
    }
  }, []);

  const [expMonth, expYear] = (() => {
    const [m = "", y = ""] = expiration.split("/");
    return [m.trim(), y.trim()];
  })();

  function authenticate() {
    setResult(null);
    if (typeof window.bpmpi_authenticate === "function") {
      window.bpmpi_authenticate();
    } else {
      setTokenError("SDK ainda não carregado (window.bpmpi_authenticate indisponível).");
    }
  }

  const labelCls = "block text-sm font-medium text-gray-700 mb-1";
  const inputCls = "w-full rounded border border-gray-300 px-3 py-2 text-sm";

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-semibold mb-2">Teste 3DS 2.0 — Braspag (sandbox)</h1>
      <p className="text-sm text-gray-600 mb-4">
        Página isolada. Apenas autentica (3DS completo) e exibe o resultado. Não autoriza, não faz
        parte do checkout real.
      </p>

      <div className="mb-4 text-sm">
        <div>
          Access token:{" "}
          {accessToken ? (
            <span className="text-green-700">obtido ({accessToken.length} chars)</span>
          ) : tokenError ? (
            <span className="text-red-700">erro: {tokenError}</span>
          ) : (
            <span className="text-gray-500">carregando…</span>
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
          Mapeamento conforme doc oficial (implementando-script / manual 3ds).
          CVV NÃO tem classe bpmpi_* — é dado de autorização (1C), não de
          autenticação; fica só no formulário.
         =================================================================== */}
      <div style={{ display: "none" }} aria-hidden>
        {/* Modo de autenticação: 3DS completo (não Data Only) */}
        <input type="hidden" className="bpmpi_auth" value="true" readOnly />
        <input type="hidden" className="bpmpi_auth_notifyonly" value="false" readOnly />

        <input type="hidden" className="bpmpi_accesstoken" value={accessToken} readOnly />
        <input type="hidden" className="bpmpi_ordernumber" value={orderId} readOnly />
        <input type="hidden" className="bpmpi_currency" value="BRL" readOnly />
        <input type="hidden" className="bpmpi_totalamount" value={String(amount)} readOnly />
        <input type="hidden" className="bpmpi_installments" value={String(installments)} readOnly />
        <input type="hidden" className="bpmpi_paymentmethod" value="credit" readOnly />

        <input type="hidden" className="bpmpi_cardnumber" value={cardNumber} readOnly />
        <input type="hidden" className="bpmpi_cardexpirationmonth" value={expMonth} readOnly />
        <input type="hidden" className="bpmpi_cardexpirationyear" value={expYear} readOnly />
      </div>

      <button
        onClick={authenticate}
        disabled={!accessToken || !sdkReady}
        className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        Autenticar
      </button>

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
    </div>
  );
}
