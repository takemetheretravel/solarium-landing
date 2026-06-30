"use client";

import { useEffect, useRef, useState } from "react";

// =============================================================================
// 1B — Página de teste ISOLADA do 3DS 2.0 (browser SDK da Braspag).
// NÃO faz parte do checkout real. Não linkada em nenhum menu/navegação.
// Objetivo: provar a mecânica do SDK e capturar o resultado da AUTENTICAÇÃO
// (Cavv, Eci, Xid, Version, ReferenceId). NÃO autoriza (isso é 1C).
//
// Mecânica do SDK (doc/exemplo oficial Braspag/Cielo):
//  - window.bpmpi_config() é lido pelo script para obter Environment/Debug e
//    os callbacks de resultado. Deve existir ANTES de o script carregar.
//  - Os DADOS da transação são lidos do HTML por classes "bpmpi_*" nos inputs.
//  - window.bpmpi_authenticate() dispara o fluxo; o desafio é renderizado pelo
//    PRÓPRIO SDK (não exige container nomeado — confirmado no exemplo oficial).
//  - 3DS completo (com desafio): bpmpi_auth=true e bpmpi_auth_notifyonly AUSENTE
//    (notifyonly só é exigido em Data Only; presença pode suprimir desafio).
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
  const [sdkReady, setSdkReady] = useState(false);
  const [result, setResult] = useState<AuthResult | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Formulário mínimo
  const [cardNumber, setCardNumber] = useState("4000000000002503");
  const [holder, setHolder] = useState("TESTE SOLARIUM");
  const [expiration, setExpiration] = useState("12/2030"); // MM/AAAA
  const [cvv, setCvv] = useState("123");
  const [amount, setAmount] = useState(1000); // centavos → R$ 10,00
  const [orderId, setOrderId] = useState("");
  const [installments, setInstallments] = useState(1);

  const configuredRef = useRef(false);
  // Container dos inputs bpmpi_*. Sincronizamos TODOS imperativamente a cada
  // clique, a partir do estado atual do formulário — sem depender do flush do
  // React, garantindo que o SDK leia exatamente o que está na tela agora.
  const hiddenRef = useRef<HTMLDivElement>(null);

  function addLog(msg: string) {
    const ts = new Date().toLocaleTimeString("pt-BR");
    setLogs((prev) => [`[${ts}] ${msg}`, ...prev].slice(0, 20));
  }

  // orderId default gerado no cliente (evita mismatch de hidratação)
  useEffect(() => {
    if (!orderId) setOrderId(`3ds-test-${Date.now()}`);
  }, [orderId]);

  // Define window.bpmpi_config ANTES do script e carrega o SDK
  useEffect(() => {
    if (configuredRef.current) return;
    configuredRef.current = true;

    window.bpmpi_config = function () {
      return {
        Debug: true,
        Environment: "SDB", // sandbox
        onReady: function () {
          setSdkReady(true);
          addLog("SDK pronto (onReady).");
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
      s.onerror = () => addLog("ERRO: falha ao carregar o SDK BP.Mpi.3ds20.");
      document.body.appendChild(s);
    }
  }, []);

  // Sincroniza os inputs bpmpi_* com os valores ATUAIS do formulário + token
  // recém-buscado, lendo o estado vigente neste clique e escrevendo direto no
  // DOM (o SDK lê os inputs por classe no momento do authenticate).
  function syncHiddenInputs(token: string) {
    const root = hiddenRef.current;
    if (!root) return;
    const set = (cls: string, val: string) => {
      const el = root.querySelector<HTMLInputElement>(`.${cls}`);
      if (el) el.value = val;
    };
    const [m = "", y = ""] = expiration.split("/").map((s) => s.trim());
    set("bpmpi_accesstoken", token);
    set("bpmpi_ordernumber", orderId);
    set("bpmpi_currency", "BRL");
    set("bpmpi_totalamount", String(amount));
    set("bpmpi_installments", String(installments));
    set("bpmpi_paymentmethod", "credit");
    set("bpmpi_cardnumber", cardNumber);
    set("bpmpi_cardexpirationmonth", m);
    set("bpmpi_cardexpirationyear", y);
  }

  // Busca SEMPRE um token novo nesta tentativa (token MPI é de curta duração),
  // sincroniza os inputs com o formulário atual e só então dispara o SDK.
  async function authenticate() {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/payments/braspag/3ds-session", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      const ecLabel = `EstablishmentCode=${data.establishmentCode ?? "(não setado)"}`;
      if (!res.ok || !data.accessToken) {
        const detail =
          data.mpiStatus !== undefined
            ? `MPI ${data.mpiStatus}: ${JSON.stringify(data.mpiBody)}`
            : data.error || "sem accessToken";
        addLog(`Token NÃO obtido nesta tentativa (HTTP ${res.status}). ${ecLabel}. ${detail}`);
        setBusy(false);
        return;
      }
      syncHiddenInputs(data.accessToken);
      addLog(
        `Token obtido (${String(data.accessToken).length} chars), ${ecLabel}, inputs sincronizados: cartão …${cardNumber.slice(-4)}, valor ${amount}, order ${orderId}.`,
      );
    } catch (err) {
      addLog(`Token NÃO obtido (erro de rede): ${(err as Error)?.message || "erro"}`);
      setBusy(false);
      return;
    }

    if (typeof window.bpmpi_authenticate === "function") {
      addLog("Disparando window.bpmpi_authenticate()…");
      window.bpmpi_authenticate();
    } else {
      addLog("SDK ainda não carregado (window.bpmpi_authenticate indisponível).");
    }
    setBusy(false);
  }

  const labelCls = "block text-sm font-medium text-gray-700 mb-1";
  const inputCls = "w-full rounded border border-gray-300 px-3 py-2 text-sm";

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-semibold mb-2">Teste 3DS 2.0 — Braspag (sandbox)</h1>
      <p className="text-sm text-gray-600 mb-4">
        Página isolada. Apenas autentica (3DS completo, com desafio) e exibe o resultado. Não
        autoriza, não faz parte do checkout real. Token é buscado a cada clique em “Autenticar”.
      </p>

      <div className="mb-4 text-sm">
        SDK: {sdkReady ? <span className="text-green-700">pronto (onReady)</span> : <span className="text-gray-500">carregando…</span>}
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
          - bpmpi_auth = true  → autenticação habilitada (3DS completo).
          - bpmpi_auth_notifyonly INTENCIONALMENTE AUSENTE: ele só é exigido em
            Data Only e sua presença pode suprimir o desafio. O exemplo oficial
            da Braspag também o omite.
          - O token é injetado por ref no momento do clique (vida curta).
          - CVV NÃO tem classe bpmpi_* — é dado de autorização (1C).
          - O desafio é renderizado pelo próprio SDK; não há container nomeado.
         =================================================================== */}
      <div ref={hiddenRef} style={{ display: "none" }} aria-hidden>
        <input type="hidden" className="bpmpi_auth" defaultValue="true" />

        <input type="hidden" className="bpmpi_accesstoken" defaultValue="" />
        <input type="hidden" className="bpmpi_ordernumber" defaultValue="" />
        <input type="hidden" className="bpmpi_currency" defaultValue="BRL" />
        <input type="hidden" className="bpmpi_totalamount" defaultValue="" />
        <input type="hidden" className="bpmpi_installments" defaultValue="" />
        <input type="hidden" className="bpmpi_paymentmethod" defaultValue="credit" />

        <input type="hidden" className="bpmpi_cardnumber" defaultValue="" />
        <input type="hidden" className="bpmpi_cardexpirationmonth" defaultValue="" />
        <input type="hidden" className="bpmpi_cardexpirationyear" defaultValue="" />
      </div>

      <button
        onClick={authenticate}
        disabled={!sdkReady || busy}
        className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        {busy ? "Autenticando…" : "Autenticar"}
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

      {/* Log visível na página: ajuda a descartar token expirado entre tentativas */}
      <div className="mt-6">
        <div className="mb-1 text-sm font-semibold">Log da sessão</div>
        <div className="rounded border border-gray-200 bg-gray-50 p-3 text-xs font-mono text-gray-700 max-h-48 overflow-auto">
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
