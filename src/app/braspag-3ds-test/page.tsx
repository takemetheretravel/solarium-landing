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

// Recorte seguro para log: comprimento + 25 primeiros + 25 últimos chars.
// NUNCA logar o valor inteiro (token/Authorization).
function excerpt(s: string): string {
  return `len=${s.length} | inicio="${s.slice(0, 25)}" | fim="${s.slice(-25)}"`;
}

// Status do antifraude Cybersource (Payment.FraudAnalysis.Status).
function fraudLabel(status?: number): string {
  switch (status) {
    case 0:
      return "Unknown";
    case 1:
      return "Accept";
    case 2:
      return "Reject";
    case 3:
      return "Review";
    case 4:
      return "Aborted";
    case 5:
      return "Unfinished";
    default:
      return "—";
  }
}

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

  // 1C — etapa transacional (autorização + captura separada)
  type TxResult = {
    status?: number;
    paymentId?: string;
    returnCode?: string;
    returnMessage?: string;
    statusCode?: number;
    // Antifraude (2B)
    fraudStatus?: number; // 0=Unknown,1=Accept,2=Reject,3=Review,4=Aborted,5=Unfinished
    fraudScore?: number;
    fraudReasonCode?: number;
    fraudProviderReturnCode?: string;
    fraudProviderReturnMessage?: string;
    error?: string;
  };
  const [authResult, setAuthResult] = useState<TxResult | null>(null);
  const [captureResult, setCaptureResult] = useState<TxResult | null>(null);
  const [txBusy, setTxBusy] = useState(false);

  // Camada 2A — FingerPrint Antifraude Cybersource (coleta client-side isolada)
  const [afSessionId, setAfSessionId] = useState<string>("");
  const [afProviderIdentifier, setAfProviderIdentifier] = useState<string>("");
  const [afOrgId, setAfOrgId] = useState<string>("");
  const [afScriptStatus, setAfScriptStatus] = useState<"idle" | "injected" | "loaded" | "error">("idle");
  const afInitRef = useRef(false);

  // Formulário mínimo
  const [cardNumber, setCardNumber] = useState("4000000000002503");
  const [holder, setHolder] = useState("TESTE SOLARIUM");
  const [expiration, setExpiration] = useState("12/2030"); // MM/AAAA
  const [cvv, setCvv] = useState("123");
  const [amount, setAmount] = useState(1000); // centavos → R$ 10,00
  const [orderId, setOrderId] = useState("");
  const [installments, setInstallments] = useState(1);

  const initRef = useRef(false);
  // Container dos inputs bpmpi_*. Os inputs são criados IMPERATIVAMENTE via
  // document.createElement — NUNCA pelo JSX. Motivo (causa raiz do 401 Code 600):
  // inputs renderizados pelo React com defaultValue="" eram recriados/resetados
  // por re-renders entre o appendChild do script e a execução assíncrona dele,
  // e o SDK lia tudo vazio (Authorization "Bearer " len=7, orderNumber="",
  // amount="" no HAR). Além disso o SDK REMOVE o nó bpmpi_accesstoken após ler —
  // nenhuma reconciliação do React pode recriá-lo ou conflitar com isso.
  // O React renderiza apenas o div vazio; nenhum render depende dos filhos.
  const bpmpiContainerRef = useRef<HTMLDivElement>(null);
  // Token da sessão (para comparar com o Authorization interceptado no XHR).
  const sessionTokenRef = useRef<string>("");

  function addLog(msg: string) {
    const ts = new Date().toLocaleTimeString("pt-BR");
    setLogs((prev) => [`[${ts}] ${msg}`, ...prev].slice(0, 30));
  }

  // Atualiza um input imperativo existente no container (propriedade + atributo).
  // NÃO cria nós — criação acontece uma única vez no init.
  function setInput(cls: string, val: string) {
    const el = bpmpiContainerRef.current?.querySelector<HTMLInputElement>(`.${cls}`);
    if (el) {
      el.value = val;
      el.setAttribute("value", val);
    }
  }

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

    // Experimento B: monkey-patch de XMLHttpRequest ANTES do script do SDK,
    // para capturar o Authorization REAL enviado ao /v2/3ds/init. Loga apenas
    // recorte seguro (len + 25 primeiros/últimos) — NUNCA o valor inteiro.
    type PatchedXhr = XMLHttpRequest & { __bpmpiUrl?: string };
    const xhrProto = XMLHttpRequest.prototype;
    const origOpen = xhrProto.open;
    const origSetRequestHeader = xhrProto.setRequestHeader;
    xhrProto.open = function (this: PatchedXhr) {
      // eslint-disable-next-line prefer-rest-params
      const args = arguments as unknown as Parameters<typeof origOpen>;
      this.__bpmpiUrl = String(args[1]);
      return origOpen.apply(this, args);
    } as typeof xhrProto.open;
    xhrProto.setRequestHeader = function (this: PatchedXhr, name: string, value: string) {
      if (this.__bpmpiUrl?.includes("/v2/3ds/init") && name.toLowerCase() === "authorization") {
        addLog(
          `[intercept /v2/3ds/init] Authorization enviado pelo SDK: ${excerpt(value)} ||| accessToken da sessão: ${excerpt(sessionTokenRef.current || "(vazio)")}`,
        );
      }
      return origSetRequestHeader.call(this, name, value);
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

        // (3) cria TODOS os inputs bpmpi_* imperativamente (fora do React) já
        // com os valores preenchidos, e injeta o token. document.createElement +
        // appendChild — o React nunca reconcilia esses nós.
        const container = bpmpiContainerRef.current;
        if (!container) {
          addLog("ERRO: container bpmpi indisponível no DOM.");
          return;
        }
        container.innerHTML = ""; // estado limpo (remount de dev não duplica nós)

        const mk = (cls: string, val: string) => {
          const el = document.createElement("input");
          el.type = "hidden";
          el.className = cls;
          el.value = val;
          container.appendChild(el);
        };

        const generatedOrder = `3ds-test-${Date.now()}`;
        setOrderId(generatedOrder); // espelha no formulário React (só exibição)
        const [expM = "", expY = ""] = expiration.split("/").map((s) => s.trim());

        sessionTokenRef.current = String(data.accessToken);
        mk("bpmpi_accesstoken", String(data.accessToken));
        mk("bpmpi_auth", "true");
        mk("bpmpi_auth_notifyonly", "false");
        mk("bpmpi_ordernumber", generatedOrder);
        mk("bpmpi_currency", "BRL");
        mk("bpmpi_totalamount", String(amount));
        mk("bpmpi_installments", String(installments));
        mk("bpmpi_paymentmethod", "Credit");
        mk("bpmpi_cardnumber", cardNumber);
        mk("bpmpi_cardexpirationmonth", expM);
        mk("bpmpi_cardexpirationyear", expY);
        mk("bpmpi_merchant_url", MERCHANT_URL);
        mk("bpmpi_order_productcode", ORDER_PRODUCTCODE);
        mk("bpmpi_transaction_mode", TRANSACTION_MODE);
        mk("bpmpi_billto_name", BILLTO.name);
        mk("bpmpi_billto_email", BILLTO.email);
        mk("bpmpi_billto_phonenumber", BILLTO.phonenumber);
        mk("bpmpi_billto_street1", BILLTO.street1);
        mk("bpmpi_billto_city", BILLTO.city);
        mk("bpmpi_billto_state", BILLTO.state);
        mk("bpmpi_billto_country", BILLTO.country);
        mk("bpmpi_billto_zipcode", BILLTO.zipcode);

        setTokenInjected(true);
        addLog(`Token injetado em bpmpi_accesstoken ANTES do load do script? SIM (${String(data.accessToken).length} chars, ${ecLabel}). Inputs criados imperativamente (fora do React).`);

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

        // Verificação de duplicidade/vazio: o SDK lê APENAS o .value da PRIMEIRA
        // ocorrência da classe (getElementsByClassName(...)[0].value). Logamos o
        // estado exato do DOM no instante imediatamente anterior ao anexo do script.
        {
          const els = document.getElementsByClassName("bpmpi_accesstoken");
          const firstLen = (els[0] as HTMLInputElement | undefined)?.value?.length ?? 0;
          const expectedLen = String(data.accessToken).length;
          if (els.length !== 1 || firstLen === 0) {
            addLog(
              `⚠️ PROBLEMA PRÉ-SCRIPT: elementos com class bpmpi_accesstoken = ${els.length}; value.length do PRIMEIRO = ${firstLen} (esperado ${expectedLen}). ${els.length > 1 ? "DUPLICIDADE — o SDK lê só o primeiro!" : ""}${firstLen === 0 ? " PRIMEIRO ESTÁ VAZIO — init sairá sem token!" : ""}`,
            );
          } else {
            addLog(
              `Pré-script OK: 1 elemento bpmpi_accesstoken, value.length do primeiro = ${firstLen} (token emitido = ${expectedLen}).`,
            );
          }
        }

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

  // =========================================================================
  // Camada 2A — FingerPrint Antifraude Cybersource (isolado do 3DS/1C).
  // Só coleta device data no navegador. Nada é enviado ao /v2/sales/ (isso é 2B).
  // Formato oficial (doc web-fingerprint):
  //   session_id = ProviderMerchantId + ProviderIdentifier (sem delimitador)
  //   <script src="https://h.online-metrix.net/fp/tags.js?org_id=<OrgId>&session_id=<session_id>">
  //   <noscript><iframe src="https://h.online-metrix.net/fp/tags?org_id=...&session_id=..."></noscript>
  // Na 2B, Customer.BrowserFingerprint recebe SOMENTE o ProviderIdentifier.
  // =========================================================================
  useEffect(() => {
    if (afInitRef.current) return;
    afInitRef.current = true;

    (async () => {
      try {
        const res = await fetch("/api/payments/braspag/af-config");
        const cfg = await res.json().catch(() => ({}));
        const orgId: string = cfg.orgId || "";
        const providerMerchantId: string = cfg.providerMerchantId || "";
        if (!orgId || !providerMerchantId) {
          addLog(`2A FingerPrint: config ausente (orgId="${orgId}", providerMerchantId="${providerMerchantId}"). Verifique BRASPAG_AF_* no env.`);
          setAfScriptStatus("error");
          return;
        }

        // ProviderIdentifier único por carregamento: UUID sem hífens.
        const providerIdentifier = crypto.randomUUID().replace(/-/g, "");
        const sessionId = `${providerMerchantId}${providerIdentifier}`;
        setAfOrgId(orgId);
        setAfProviderIdentifier(providerIdentifier);
        setAfSessionId(sessionId);
        addLog(`2A FingerPrint: sessionId=${sessionId} (orgId=${orgId}, providerIdentifier=${providerIdentifier}).`);

        // Injeta o script de coleta conforme a doc (device fingerprint).
        const src = `https://h.online-metrix.net/fp/tags.js?org_id=${encodeURIComponent(orgId)}&session_id=${encodeURIComponent(sessionId)}`;
        const s = document.createElement("script");
        s.type = "text/javascript";
        s.src = src;
        s.async = true;
        s.onload = () => {
          setAfScriptStatus("loaded");
          addLog("2A FingerPrint: script de coleta carregado (h.online-metrix.net).");
        };
        s.onerror = () => {
          setAfScriptStatus("error");
          addLog("2A FingerPrint: ERRO ao carregar o script de coleta.");
        };
        document.head.appendChild(s);
        setAfScriptStatus("injected");
        addLog("2A FingerPrint: script de coleta injetado no <head>.");
      } catch (err) {
        setAfScriptStatus("error");
        addLog(`2A FingerPrint: erro ao obter config/injetar — ${(err as Error)?.message || "erro"}`);
      }
    })();
  }, []);

  // Campos fixos (estabelecimento + billto de teste). Criados no init; aqui
  // apenas reescreve os valores nos nós imperativos existentes (não cria nada).
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

  // Sincroniza os nós imperativos com os valores ATUAIS do formulário React.
  // NÃO toca no token: o SDK REMOVE o nó bpmpi_accesstoken após ler (comportamento
  // normal dele) e não devemos recriá-lo no clique.
  function syncFormInputs() {
    const [m = "", y = ""] = expiration.split("/").map((s) => s.trim());
    setInput("bpmpi_ordernumber", orderId);
    setInput("bpmpi_currency", "BRL");
    setInput("bpmpi_totalamount", String(amount));
    setInput("bpmpi_installments", String(installments));
    setInput("bpmpi_paymentmethod", "Credit");
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

  // 1C — Autorização no Pagador com ExternalAuthentication (resultado do 3DS).
  // NOTA: o Provider Simulado decide aprovação pelo NÚMERO do cartão, não pelo
  // 3DS. Se a autorização vier negada com o cartão usado na autenticação, edite
  // o número do cartão no formulário e reautorize — em sandbox o
  // ExternalAuthentication não é invalidado pela troca do número.
  async function authorize() {
    if (!result || result.event !== "onSuccess" || txBusy) return;
    // O antifraude (2B) depende do ProviderIdentifier da 2A.
    if (!afProviderIdentifier) {
      addLog("2B: não é possível autorizar — FingerPrint da 2A ainda não gerou o ProviderIdentifier. Recarregue.");
      return;
    }
    setTxBusy(true);
    setAuthResult(null);
    setCaptureResult(null);
    const f = result.fields;
    addLog(`2B: autorizando+antifraude order ${orderId}, valor ${amount}, cartão ****${cardNumber.slice(-4)}, fp=${afProviderIdentifier.slice(0, 8)}…`);
    try {
      const res = await fetch("/api/payments/braspag/authorize-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          amount,
          installments,
          browserFingerprint: afProviderIdentifier, // ProviderIdentifier da 2A
          card: {
            number: cardNumber,
            holder,
            expiration,
            cvv,
            brand: "Visa", // cartões de teste em uso são Visa
          },
          externalAuthentication: {
            Cavv: f.Cavv,
            Xid: f.Xid,
            Eci: f.Eci,
            Version: f.Version,
            ReferenceId: f.ReferenceId,
          },
        }),
      });
      const data: TxResult = await res.json().catch(() => ({ error: "resposta inválida" }));
      setAuthResult(data);
      addLog(
        `2B autorização: HTTP ${res.status} | Payment.Status=${data.statusCode ?? "-"} | PaymentId=${data.paymentId ?? "-"} | ReturnCode=${data.returnCode ?? "-"} | ReturnMessage=${data.returnMessage ?? data.error ?? "-"}`,
      );
      addLog(
        `2B antifraude: Status=${data.fraudStatus ?? "-"} (${fraudLabel(data.fraudStatus)}) | Score=${data.fraudScore ?? "-"} | ReasonCode=${data.fraudReasonCode ?? "-"} | ${data.fraudProviderReturnMessage ?? ""}`,
      );
    } catch (err) {
      const msg = (err as Error)?.message || "erro";
      setAuthResult({ error: msg });
      addLog(`2B autorização: erro de rede — ${msg}`);
    }
    setTxBusy(false);
  }

  // 1C — Captura SEPARADA (nunca Capture:true no fluxo real).
  async function capture() {
    if (!authResult?.paymentId || authResult.statusCode !== 1 || txBusy) return;
    setTxBusy(true);
    setCaptureResult(null);
    addLog(`1C: capturando PaymentId ${authResult.paymentId}, valor ${amount}…`);
    try {
      const res = await fetch("/api/payments/braspag/capture-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId: authResult.paymentId, amount }),
      });
      const data: TxResult = await res.json().catch(() => ({ error: "resposta inválida" }));
      setCaptureResult(data);
      addLog(
        `1C captura: HTTP ${res.status} | Status=${data.statusCode ?? "-"} (esperado 2=capturado) | ReturnCode=${data.returnCode ?? "-"} | ReturnMessage=${data.returnMessage ?? data.error ?? "-"}`,
      );
    } catch (err) {
      const msg = (err as Error)?.message || "erro";
      setCaptureResult({ error: msg });
      addLog(`1C captura: erro de rede — ${msg}`);
    }
    setTxBusy(false);
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
          Container dos inputs bpmpi_*. O React renderiza APENAS este div vazio.
          Os inputs são criados imperativamente (document.createElement) no init,
          já preenchidos, ANTES do load do script — assim nenhum re-render do
          React recria/reseta os nós, e a remoção do bpmpi_accesstoken pelo SDK
          (comportamento normal após a leitura) não conflita com reconciliação.
         =================================================================== */}
      <div ref={bpmpiContainerRef} style={{ display: "none" }} />

      {/* ===================================================================
          Camada 2A — FingerPrint (Antifraude Cybersource). Seção separada do
          3DS: apenas coleta device data no navegador. Nada enviado ao /v2/sales.
         =================================================================== */}
      <div className="mt-2 mb-6 rounded border border-purple-300 bg-purple-50 p-4">
        <div className="mb-2 text-sm font-semibold">Camada 2A — FingerPrint (Antifraude)</div>
        <div className="text-xs text-gray-700 space-y-1">
          <div>
            OrgID:{" "}
            <span className="font-mono">{afOrgId || "(carregando…)"}</span>
          </div>
          <div>
            sessionId:{" "}
            <span className="font-mono break-all">{afSessionId || "(gerando…)"}</span>
          </div>
          <div>
            ProviderIdentifier (irá em Customer.BrowserFingerprint na 2B):{" "}
            <span className="font-mono break-all">{afProviderIdentifier || "—"}</span>
          </div>
          <div>
            Script de coleta:{" "}
            <span
              className={
                afScriptStatus === "loaded"
                  ? "text-green-700"
                  : afScriptStatus === "error"
                    ? "text-red-700"
                    : "text-gray-600"
              }
            >
              {afScriptStatus === "idle"
                ? "aguardando…"
                : afScriptStatus === "injected"
                  ? "injetado (carregando…)"
                  : afScriptStatus === "loaded"
                    ? "carregado ✓"
                    : "erro"}
            </span>
          </div>
        </div>
        {/* Fallback sem JS conforme a doc (device fingerprint Cybersource). */}
        {afSessionId && afOrgId && (
          <noscript>
            <iframe
              title="cybersource-fp"
              style={{ width: 100, height: 100, border: 0, position: "absolute", top: -5000 }}
              src={`https://h.online-metrix.net/fp/tags?org_id=${afOrgId}&session_id=${afSessionId}`}
            />
          </noscript>
        )}
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

      {/* 1C — etapa transacional: autorização com ExternalAuthentication + captura separada */}
      {result?.event === "onSuccess" && (
        <div className="mt-6 rounded border border-blue-300 bg-blue-50 p-4">
          <div className="mb-2 text-sm font-semibold">1C/2B — Autorização + antifraude + captura separada</div>
          <p className="mb-3 text-xs text-gray-600">
            Usa o resultado 3DS acima (Cavv/Xid/Eci/Version/ReferenceId) no bloco
            ExternalAuthentication e o FingerPrint da 2A no bloco FraudAnalysis (Cybersource). O
            Provider Simulado aprova/nega pelo número do cartão — se a autorização for negada, edite
            o número no formulário e reautorize.
          </p>
          <p className="mb-3 text-xs font-medium text-amber-700">
            Captura SEPARADA: a análise antifraude roda ANTES (AnalyseFirst) e nada é capturado
            automaticamente. A decisão de clicar “Capturar” deve considerar o resultado do antifraude
            (Accept/Reject/Review) — se vier Reject/Review, avalie antes de capturar.
          </p>
          <div className="flex gap-3">
            <button
              onClick={authorize}
              disabled={txBusy}
              className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {txBusy && !authResult ? "Autorizando…" : "Autorizar (2B)"}
            </button>
            <button
              onClick={capture}
              disabled={txBusy || authResult?.statusCode !== 1 || !authResult?.paymentId}
              className="rounded bg-green-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {txBusy && authResult ? "Capturando…" : "Capturar"}
            </button>
          </div>

          {authResult && (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div className="text-sm">
                <div className="font-semibold">Autorização</div>
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-t border-gray-200">
                      <td className="py-1 pr-4 font-medium text-gray-600">Payment.Status</td>
                      <td className="py-1 font-mono">
                        {authResult.statusCode ?? "—"}{" "}
                        {authResult.statusCode === 1
                          ? "(autorizado)"
                          : authResult.statusCode === 3
                            ? "(negado)"
                            : ""}
                      </td>
                    </tr>
                    <tr className="border-t border-gray-200">
                      <td className="py-1 pr-4 font-medium text-gray-600">PaymentId</td>
                      <td className="py-1 font-mono break-all">{authResult.paymentId ?? "—"}</td>
                    </tr>
                    <tr className="border-t border-gray-200">
                      <td className="py-1 pr-4 font-medium text-gray-600">ReturnCode</td>
                      <td className="py-1 font-mono">{authResult.returnCode ?? "—"}</td>
                    </tr>
                    <tr className="border-t border-gray-200">
                      <td className="py-1 pr-4 font-medium text-gray-600">ReturnMessage</td>
                      <td className="py-1 font-mono">{authResult.returnMessage ?? authResult.error ?? "—"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="text-sm">
                <div className="font-semibold">Antifraude (Cybersource)</div>
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-t border-gray-200">
                      <td className="py-1 pr-4 font-medium text-gray-600">Status</td>
                      <td className="py-1 font-mono">
                        {authResult.fraudStatus ?? "—"}{" "}
                        <span
                          className={
                            authResult.fraudStatus === 1
                              ? "text-green-700"
                              : authResult.fraudStatus === 2
                                ? "text-red-700"
                                : authResult.fraudStatus === 3
                                  ? "text-amber-700"
                                  : "text-gray-600"
                          }
                        >
                          ({fraudLabel(authResult.fraudStatus)})
                        </span>
                      </td>
                    </tr>
                    <tr className="border-t border-gray-200">
                      <td className="py-1 pr-4 font-medium text-gray-600">Score</td>
                      <td className="py-1 font-mono">{authResult.fraudScore ?? "—"}</td>
                    </tr>
                    <tr className="border-t border-gray-200">
                      <td className="py-1 pr-4 font-medium text-gray-600">ReasonCode</td>
                      <td className="py-1 font-mono">{authResult.fraudReasonCode ?? "—"}</td>
                    </tr>
                    <tr className="border-t border-gray-200">
                      <td className="py-1 pr-4 font-medium text-gray-600">Provider</td>
                      <td className="py-1 font-mono break-all">
                        {authResult.fraudProviderReturnCode ?? "—"}
                        {authResult.fraudProviderReturnMessage
                          ? ` — ${authResult.fraudProviderReturnMessage}`
                          : ""}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {captureResult && (
            <div className="mt-3 text-sm">
              <div className="font-semibold">Captura (separada)</div>
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-t border-gray-200">
                    <td className="py-1 pr-4 font-medium text-gray-600">Status final</td>
                    <td className="py-1 font-mono">
                      {captureResult.statusCode ?? "—"}{" "}
                      {captureResult.statusCode === 2 ? "(capturado ✓)" : "(esperado 2=capturado)"}
                    </td>
                  </tr>
                  <tr className="border-t border-gray-200">
                    <td className="py-1 pr-4 font-medium text-gray-600">ReturnCode</td>
                    <td className="py-1 font-mono">{captureResult.returnCode ?? "—"}</td>
                  </tr>
                  <tr className="border-t border-gray-200">
                    <td className="py-1 pr-4 font-medium text-gray-600">ReturnMessage</td>
                    <td className="py-1 font-mono">{captureResult.returnMessage ?? captureResult.error ?? "—"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
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
