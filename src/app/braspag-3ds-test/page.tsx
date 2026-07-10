"use client";

import { useEffect, useRef, useState } from "react";
import {
  initBraspagFingerprint,
  initBraspag3ds,
  authenticate3ds,
  type ThreeDSResult,
} from "@/lib/braspag-3ds-client";

// =============================================================================
// Página de teste ISOLADA do gateway Braspag (3DS + antifraude + captura + Pix +
// fluxo real A1). NÃO faz parte do checkout e não é linkada em navegação.
// A lógica de 3DS/FingerPrint/authenticate vem do MÓDULO COMPARTILHADO
// src/lib/braspag-3ds-client.ts — o MESMO usado no checkout real (sem fork).
// =============================================================================

type AuthResult = { event: string; fields: Record<string, unknown> };

function toFields(r: ThreeDSResult): Record<string, unknown> {
  return {
    Cavv: r.Cavv,
    Eci: r.Eci,
    Xid: r.Xid,
    Version: r.Version,
    ReferenceId: r.ReferenceId,
    ReturnCode: r.ReturnCode,
    ReturnMessage: r.ReturnMessage,
  };
}

function pixStatusLabel(status?: number): string {
  switch (status) {
    case 12:
      return "Pendente (aguardando pagamento)";
    case 1:
      return "Autorizado";
    case 2:
      return "Pago";
    case 10:
      return "Cancelado (Void)";
    case 13:
      return "Abortado";
    default:
      return status === undefined ? "—" : `código ${status}`;
  }
}

function fraudLabel(status?: number): string {
  switch (status) {
    case 0: return "Unknown";
    case 1: return "Accept";
    case 2: return "Reject";
    case 3: return "Review";
    case 4: return "Aborted";
    case 5: return "Unfinished";
    default: return "—";
  }
}

export default function Braspag3dsTestPage() {
  const [sdkReady, setSdkReady] = useState(false);
  const [result, setResult] = useState<AuthResult | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  // Camada 2A — FingerPrint
  const [afSessionId, setAfSessionId] = useState("");
  const [afProviderIdentifier, setAfProviderIdentifier] = useState("");

  // 1C/2B — transacional
  type TxResult = {
    status?: number;
    paymentId?: string;
    returnCode?: string;
    returnMessage?: string;
    statusCode?: number;
    fraudStatus?: number;
    fraudScore?: number;
    fraudReasonCode?: number;
    fraudProviderReturnCode?: string;
    fraudProviderReturnMessage?: string;
    fingerprintField?: string;
    fingerprintValue?: string;
    error?: string;
  };
  const [authResult, setAuthResult] = useState<TxResult | null>(null);
  const [captureResult, setCaptureResult] = useState<TxResult | null>(null);
  const [txBusy, setTxBusy] = useState(false);

  // A1 — fluxo real
  const [a1DraftId, setA1DraftId] = useState("");
  const [a1Busy, setA1Busy] = useState(false);
  const [a1Result, setA1Result] = useState<Record<string, unknown> | null>(null);

  // Camada 3 — Pix
  type PixResult = {
    status?: number;
    providerUsed?: string;
    paymentId?: string;
    statusCode?: number;
    qrCodeBase64Image?: string;
    qrCodeString?: string;
    qrFieldsDiagnostic?: string;
    returnCode?: string;
    returnMessage?: string;
    errorCode?: number;
    errorMessage?: string;
    foundAt?: string;
    rawKeys?: string;
    error?: string;
  };
  const [pixAmount, setPixAmount] = useState(1000);
  const [pixOrderId, setPixOrderId] = useState("");
  const [pixProvider, setPixProvider] = useState("");
  const [pixLocalQr, setPixLocalQr] = useState("");
  const [pixResult, setPixResult] = useState<PixResult | null>(null);
  const [pixStatusCode, setPixStatusCode] = useState<number | undefined>(undefined);
  const [pixBusy, setPixBusy] = useState(false);
  const [pixPolling, setPixPolling] = useState(false);
  const pixPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Formulário do cartão
  const [cardNumber, setCardNumber] = useState("4000000000002503");
  const [holder, setHolder] = useState("TESTE SOLARIUM");
  const [expiration, setExpiration] = useState("12/2030");
  const [cvv, setCvv] = useState("123");
  const [amount, setAmount] = useState(1000);
  const [orderId, setOrderId] = useState("");
  const [installments, setInstallments] = useState(1);

  const initRef = useRef(false);
  const threeDSResolverRef = useRef<((r: ThreeDSResult) => void) | null>(null);

  function addLog(msg: string) {
    const ts = new Date().toLocaleTimeString("pt-BR");
    setLogs((prev) => [`[${ts}] ${msg}`, ...prev].slice(0, 30));
  }

  useEffect(() => {
    if (!orderId) setOrderId(`3ds-test-${Date.now()}`);
  }, [orderId]);

  useEffect(() => {
    if (!pixOrderId) setPixOrderId(`pix-test-${Date.now()}`);
  }, [pixOrderId]);

  // Inicialização via módulo compartilhado (fingerprint + 3DS).
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const generatedOrder = `3ds-test-${Date.now()}`;
    setOrderId(generatedOrder);

    (async () => {
      try {
        const fp = await initBraspagFingerprint();
        setAfProviderIdentifier(fp.providerIdentifier);
        setAfSessionId(fp.sessionId);
        addLog(`2A FingerPrint: sessionId=${fp.sessionId} (providerIdentifier=${fp.providerIdentifier}).`);
      } catch (e) {
        addLog(`2A FingerPrint: ${(e as Error)?.message || "erro"}`);
      }
      try {
        await initBraspag3ds({
          orderNumber: generatedOrder,
          amountCentavos: amount,
          installments,
          debug: true,
          onReady: () => {
            setSdkReady(true);
            addLog("SDK 3DS pronto (onReady) — init OK.");
          },
          onResult: (r) => {
            setResult({ event: r.event, fields: toFields(r) });
            addLog(`3DS callback: ${r.event}`);
            threeDSResolverRef.current?.(r);
          },
        });
        addLog("3DS: token obtido, inputs criados e script anexado (via módulo).");
      } catch (e) {
        addLog(`3DS init: ${(e as Error)?.message || "erro"}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function authenticate() {
    if (!sdkReady) return;
    setResult(null);
    const ok = authenticate3ds({
      card: { number: cardNumber, holder, expirationMMYYYY: expiration },
      amountCentavos: amount,
      orderNumber: orderId,
      installments,
    });
    addLog(ok ? `Autenticando cartão …${cardNumber.slice(-4)}…` : "SDK ainda não pronto.");
  }

  // ---- 1C/2B — Autorização + antifraude ----
  async function authorize() {
    if (!result || result.event !== "onSuccess" || txBusy) return;
    if (!afProviderIdentifier) {
      addLog("2B: FingerPrint da 2A não pronto. Recarregue.");
      return;
    }
    setTxBusy(true);
    setAuthResult(null);
    setCaptureResult(null);
    const f = result.fields;
    addLog(`2B: autorizando order ${orderId}, valor ${amount}, fp=${afProviderIdentifier.slice(0, 8)}…`);
    try {
      const res = await fetch("/api/payments/braspag/authorize-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          amount,
          installments,
          browserFingerprint: afProviderIdentifier,
          card: { number: cardNumber, holder, expiration, cvv, brand: "Visa" },
          externalAuthentication: { Cavv: f.Cavv, Xid: f.Xid, Eci: f.Eci, Version: f.Version, ReferenceId: f.ReferenceId },
        }),
      });
      const data: TxResult = await res.json().catch(() => ({ error: "resposta inválida" }));
      setAuthResult(data);
      addLog(`2B autorização: HTTP ${res.status} | Payment.Status=${data.statusCode ?? "-"} | PaymentId=${data.paymentId ?? "-"} | ${data.returnMessage ?? data.error ?? ""}`);
      addLog(`2B antifraude: Status=${data.fraudStatus ?? "-"} (${fraudLabel(data.fraudStatus)}) | Score=${data.fraudScore ?? "-"}`);
      addLog(`2B fingerprint enviado: ${data.fingerprintField ?? "?"} = "${data.fingerprintValue ?? "?"}"`);
    } catch (err) {
      const msg = (err as Error)?.message || "erro";
      setAuthResult({ error: msg });
      addLog(`2B autorização: erro — ${msg}`);
    }
    setTxBusy(false);
  }

  async function capture() {
    if (!authResult?.paymentId || authResult.statusCode !== 1 || txBusy) return;
    setTxBusy(true);
    setCaptureResult(null);
    addLog(`Captura: PaymentId ${authResult.paymentId}, valor ${amount}…`);
    try {
      const res = await fetch("/api/payments/braspag/capture-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId: authResult.paymentId, amount }),
      });
      const data: TxResult = await res.json().catch(() => ({ error: "resposta inválida" }));
      setCaptureResult(data);
      addLog(`Captura: HTTP ${res.status} | Status=${data.statusCode ?? "-"} (esperado 2) | ${data.returnMessage ?? data.error ?? ""}`);
    } catch (err) {
      const msg = (err as Error)?.message || "erro";
      setCaptureResult({ error: msg });
      addLog(`Captura: erro — ${msg}`);
    }
    setTxBusy(false);
  }

  // ---- A1 — fluxo real (server) ----
  async function runA1RealFlow() {
    if (a1Busy) return;
    if (!a1DraftId.trim()) { addLog("A1: informe um draftId real do staging."); return; }
    if (!result || result.event !== "onSuccess") { addLog("A1: autentique o 3DS acima (onSuccess)."); return; }
    if (!afProviderIdentifier) { addLog("A1: FingerPrint da 2A não pronto."); return; }
    setA1Busy(true);
    setA1Result(null);
    const f = result.fields;
    addLog(`A1: POST /api/payments/braspag/credit draft=${a1DraftId.trim()}…`);
    try {
      const res = await fetch("/api/payments/braspag/credit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: a1DraftId.trim(),
          cardNumber,
          cardHolder: holder,
          cardExpiration: expiration,
          cardCvv: cvv,
          installments,
          browserFingerprint: afProviderIdentifier,
          externalAuthentication: { Cavv: f.Cavv, Xid: f.Xid, Eci: f.Eci, Version: f.Version, ReferenceId: f.ReferenceId },
          billing: {
            street: "Rua das Flores", number: "100", complement: "Casa",
            neighborhood: "Centro", city: "Itanhandu", state: "MG", zipCode: "37464000",
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      setA1Result({ httpStatus: res.status, ...data });
      addLog(`A1: HTTP ${res.status} | approved=${data.approved} | ${data.redirectTo ?? data.returnMessage ?? data.error ?? ""}`);
    } catch (err) {
      setA1Result({ error: (err as Error)?.message || "erro" });
    }
    setA1Busy(false);
  }

  // ---- Camada 3 — Pix ----
  useEffect(() => () => { if (pixPollRef.current) clearInterval(pixPollRef.current); }, []);

  async function generatePix() {
    if (pixBusy) return;
    setPixBusy(true);
    setPixResult(null);
    setPixStatusCode(undefined);
    setPixLocalQr("");
    stopPixPolling();
    const qs = pixProvider.trim() ? `?provider=${encodeURIComponent(pixProvider.trim())}` : "";
    addLog(`Pix: gerando order ${pixOrderId}, valor ${pixAmount}, provider=${pixProvider.trim() || "(default)"}…`);
    try {
      const res = await fetch(`/api/payments/braspag/pix-test${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: pixOrderId, amount: pixAmount }),
      });
      const data: PixResult = await res.json().catch(() => ({ error: "resposta inválida" }));
      setPixResult(data);
      setPixStatusCode(data.statusCode);
      const errPart = data.errorCode !== undefined ? `ERRO Braspag ${data.errorCode}: ${data.errorMessage}` : "";
      addLog(`Pix: HTTP ${res.status} | provider=${data.providerUsed ?? "-"} | Status=${data.statusCode ?? "-"} (${pixStatusLabel(data.statusCode)}) | ${errPart || data.returnMessage || data.error || ""}`);
      if (data.qrFieldsDiagnostic) addLog(`Pix campos de QR: ${data.qrFieldsDiagnostic}`);
      if (!data.qrCodeBase64Image && data.qrCodeString) {
        try {
          const QR = (await import("qrcode")).default;
          setPixLocalQr(await QR.toDataURL(data.qrCodeString, { margin: 1, width: 192 }));
          addLog("Pix: imagem ausente — QR gerado localmente a partir do copia-e-cola.");
        } catch (e) {
          addLog(`Pix: falha ao gerar QR local — ${(e as Error)?.message || "erro"}`);
        }
      }
    } catch (err) {
      setPixResult({ error: (err as Error)?.message || "erro" });
    }
    setPixBusy(false);
  }

  async function consultPixStatus() {
    if (!pixResult?.paymentId) return;
    try {
      const res = await fetch(`/api/payments/braspag/pix-status?paymentId=${encodeURIComponent(pixResult.paymentId)}`);
      const data = await res.json().catch(() => ({}));
      setPixStatusCode(data.statusCode);
      addLog(`Pix consulta: Status=${data.statusCode ?? "-"} (${pixStatusLabel(data.statusCode)}) | foundAt=${data.foundAt ?? "?"}${data.statusCode === undefined ? ` | rawKeys=${data.rawKeys ?? "?"}` : ""}`);
      return data.statusCode as number | undefined;
    } catch (err) {
      addLog(`Pix consulta: erro — ${(err as Error)?.message || "erro"}`);
      return undefined;
    }
  }

  function startPixPolling() {
    if (!pixResult?.paymentId || pixPolling) return;
    setPixPolling(true);
    addLog("Pix: polling iniciado (5s, até 60s).");
    const startedAt = Date.now();
    pixPollRef.current = setInterval(async () => {
      const st = await consultPixStatus();
      if (st === 2 || Date.now() - startedAt >= 60000) {
        stopPixPolling();
        addLog(st === 2 ? "Pix: PAGO — polling encerrado." : "Pix: 60s sem confirmação — polling encerrado.");
      }
    }, 5000);
  }

  function stopPixPolling() {
    if (pixPollRef.current) { clearInterval(pixPollRef.current); pixPollRef.current = null; }
    setPixPolling(false);
  }

  const labelCls = "block text-sm font-medium text-gray-700 mb-1";
  const inputCls = "w-full rounded border border-gray-300 px-3 py-2 text-sm";

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-semibold mb-2">Teste gateway Braspag (sandbox)</h1>
      <p className="text-sm text-gray-600 mb-4">
        Página isolada. Usa o módulo compartilhado braspag-3ds-client (o mesmo do checkout real).
      </p>

      <div className="mb-4 text-sm space-y-1">
        <div>SDK 3DS: {sdkReady ? <span className="text-green-700">pronto (onReady)</span> : <span className="text-gray-500">carregando…</span>}</div>
        <div>2A FingerPrint sessionId: <span className="font-mono break-all">{afSessionId || "(gerando…)"}</span></div>
        <div>ProviderIdentifier (→ Payment.FraudAnalysis.FingerPrintId): <span className="font-mono break-all">{afProviderIdentifier || "—"}</span></div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="col-span-2"><label className={labelCls}>Cartão</label><input className={inputCls} value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} /></div>
        <div className="col-span-2"><label className={labelCls}>Portador</label><input className={inputCls} value={holder} onChange={(e) => setHolder(e.target.value)} /></div>
        <div><label className={labelCls}>Validade (MM/AAAA)</label><input className={inputCls} value={expiration} onChange={(e) => setExpiration(e.target.value)} /></div>
        <div><label className={labelCls}>CVV</label><input className={inputCls} value={cvv} onChange={(e) => setCvv(e.target.value)} /></div>
        <div><label className={labelCls}>Valor (centavos)</label><input className={inputCls} type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></div>
        <div><label className={labelCls}>Parcelas</label><input className={inputCls} type="number" value={installments} onChange={(e) => setInstallments(Number(e.target.value))} /></div>
        <div className="col-span-2"><label className={labelCls}>OrderId</label><input className={inputCls} value={orderId} onChange={(e) => setOrderId(e.target.value)} /></div>
      </div>

      <button onClick={authenticate} disabled={!sdkReady} className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
        Autenticar (3DS)
      </button>

      {result && (
        <div className="mt-6 rounded border border-gray-300 p-4">
          <div className="mb-2 text-sm font-semibold">Callback 3DS: <span className="font-mono">{result.event}</span></div>
          <table className="w-full text-sm"><tbody>
            {Object.entries(result.fields).map(([k, v]) => (
              <tr key={k} className="border-t border-gray-100">
                <td className="py-1 pr-4 font-medium text-gray-600">{k}</td>
                <td className="py-1 font-mono break-all">{v === undefined || v === null ? "—" : String(v)}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}

      {result?.event === "onSuccess" && (
        <div className="mt-6 rounded border border-blue-300 bg-blue-50 p-4">
          <div className="mb-2 text-sm font-semibold">1C/2B — Autorização + antifraude + captura separada</div>
          <div className="flex gap-3">
            <button onClick={authorize} disabled={txBusy} className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
              {txBusy && !authResult ? "Autorizando…" : "Autorizar (2B)"}
            </button>
            <button onClick={capture} disabled={txBusy || authResult?.statusCode !== 1 || !authResult?.paymentId} className="rounded bg-green-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
              {txBusy && authResult ? "Capturando…" : "Capturar"}
            </button>
          </div>
          {authResult && (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div className="text-sm">
                <div className="font-semibold">Autorização</div>
                <div className="font-mono text-xs">Status={authResult.statusCode ?? "—"} · PaymentId={authResult.paymentId ?? "—"} · {authResult.returnMessage ?? authResult.error ?? ""}</div>
              </div>
              <div className="text-sm">
                <div className="font-semibold">Antifraude</div>
                <div className="font-mono text-xs">Status={authResult.fraudStatus ?? "—"} ({fraudLabel(authResult.fraudStatus)}) · Score={authResult.fraudScore ?? "—"}</div>
                <div className="font-mono text-xs break-all">{authResult.fingerprintField} = {authResult.fingerprintValue}</div>
              </div>
            </div>
          )}
          {captureResult && (
            <div className="mt-3 text-sm font-mono text-xs">Captura: Status={captureResult.statusCode ?? "—"} {captureResult.statusCode === 2 ? "(capturado ✓)" : ""} · {captureResult.returnMessage ?? captureResult.error ?? ""}</div>
          )}
        </div>
      )}

      {/* A1 — fluxo real (server) */}
      <div className="mt-8 rounded border border-indigo-300 bg-indigo-50 p-4">
        <div className="mb-2 text-sm font-semibold">A1 — Fluxo real (server)</div>
        <p className="mb-3 text-xs text-gray-600">
          Crie um draft no staging, cole o draftId, autentique o 3DS acima (onSuccess) e clique.
        </p>
        <div className="mb-3"><label className={labelCls}>draftId (real)</label><input className={inputCls} value={a1DraftId} onChange={(e) => setA1DraftId(e.target.value)} /></div>
        <button onClick={runA1RealFlow} disabled={a1Busy || result?.event !== "onSuccess"} className="rounded bg-indigo-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
          {a1Busy ? "Processando…" : "Rodar fluxo real (A1)"}
        </button>
        {a1Result && <pre className="mt-3 overflow-auto rounded border border-gray-300 bg-white p-3 text-xs">{JSON.stringify(a1Result, null, 2)}</pre>}
      </div>

      {/* Camada 3 — Pix */}
      <div className="mt-8 rounded border border-teal-300 bg-teal-50 p-4">
        <div className="mb-2 text-sm font-semibold">Camada 3 — Pix</div>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Valor (centavos)</label><input className={inputCls} type="number" value={pixAmount} onChange={(e) => setPixAmount(Number(e.target.value))} /></div>
          <div><label className={labelCls}>OrderId</label><input className={inputCls} value={pixOrderId} onChange={(e) => setPixOrderId(e.target.value)} /></div>
          <div className="col-span-2"><label className={labelCls}>Provider (teste) — vazio usa o default do server (Simulado)</label><input className={inputCls} value={pixProvider} onChange={(e) => setPixProvider(e.target.value)} placeholder="ex.: Simulado, Cielo30…" /></div>
        </div>
        <div className="flex flex-wrap gap-3">
          <button onClick={generatePix} disabled={pixBusy} className="rounded bg-teal-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">{pixBusy ? "Gerando…" : "Gerar Pix"}</button>
          <button onClick={consultPixStatus} disabled={!pixResult?.paymentId} className="rounded border border-gray-400 px-4 py-2 text-sm font-medium text-gray-800 disabled:opacity-40">Consultar status</button>
          {!pixPolling ? (
            <button onClick={startPixPolling} disabled={!pixResult?.paymentId} className="rounded border border-teal-400 px-4 py-2 text-sm font-medium text-teal-800 disabled:opacity-40">Polling (5s/60s)</button>
          ) : (
            <button onClick={stopPixPolling} className="rounded border border-red-400 px-4 py-2 text-sm font-medium text-red-700">Parar polling</button>
          )}
        </div>
        {pixResult && (
          <div className="mt-4 text-sm">
            <div className="font-mono text-xs">
              Provider usado={pixResult.providerUsed ?? "—"} · Status={pixStatusCode ?? pixResult.statusCode ?? "—"} ({pixStatusLabel(pixStatusCode ?? pixResult.statusCode)}) · PaymentId={pixResult.paymentId ?? "—"}
              {pixResult.errorCode !== undefined && <span className="text-red-700"> · Erro {pixResult.errorCode}: {pixResult.errorMessage}</span>}
            </div>
            {(pixResult.qrCodeBase64Image || pixLocalQr) && (
              <div className="mt-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="QR Code Pix" src={pixResult.qrCodeBase64Image ? `data:image/png;base64,${pixResult.qrCodeBase64Image}` : pixLocalQr} className="h-48 w-48 border border-gray-300 bg-white" />
                {!pixResult.qrCodeBase64Image && pixLocalQr && <p className="mt-1 text-xs text-amber-700">QR gerado localmente a partir do copia-e-cola.</p>}
              </div>
            )}
            {pixResult.qrCodeString && (
              <textarea readOnly value={pixResult.qrCodeString} rows={3} className="mt-3 w-full rounded border border-gray-300 p-2 text-xs font-mono" onFocus={(e) => e.currentTarget.select()} />
            )}
            {pixResult.qrFieldsDiagnostic && <p className="mt-2 text-xs text-gray-500 break-all">Campos de QR: {pixResult.qrFieldsDiagnostic}</p>}
          </div>
        )}
      </div>

      <div className="mt-6">
        <div className="mb-1 text-sm font-semibold">Log da sessão</div>
        <div className="rounded border border-gray-200 bg-gray-50 p-3 text-xs font-mono text-gray-700 max-h-56 overflow-auto">
          {logs.length === 0 ? <div className="text-gray-400">sem eventos ainda…</div> : logs.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </div>
    </div>
  );
}
