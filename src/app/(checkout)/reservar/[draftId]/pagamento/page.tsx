"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Container from "@/components/ui/Container";
import Heading from "@/components/ui/Heading";
import Kicker from "@/components/ui/Kicker";
import { formatBRLPrecise } from "@/lib/cn";
import { PROPERTIES } from "@/config/properties";
import { COUPONS } from "@/config/coupons";
import type { ReservationDraft } from "@/lib/kv-store";
import {
  initBraspagFingerprint,
  initBraspag3ds,
  authenticate3ds,
  resetBraspag3ds,
  type ThreeDSResult,
} from "@/lib/braspag-3ds-client";
import { emitirTelemetria, TIMEOUT_3DS_MS as TELEMETRIA_TIMEOUT_3DS_MS } from "@/lib/telemetria-pagamento";

const MSG_3DS_FALHOU =
  "Não foi possível validar seu cartão com o banco emissor. Nenhum valor foi cobrado — tente novamente, use outro cartão ou pague via Pix.";

const TAXA_MENSAL = 1.99; // estimativa típica Cielo (% ao mês)

// Prazo máximo de espera pelo callback do 3DS. Cobre challenge com senha, app
// do banco e SMS; passou disso, tratamos como falha e devolvemos o botão.
const TIMEOUT_3DS_MS = 5 * 60 * 1000;

function calcTotalComJuros(valor: number, n: number): number {
  if (n <= 1) return valor;
  const i = TAXA_MENSAL / 100;
  const parcela = (valor * (i * Math.pow(1 + i, n))) / (Math.pow(1 + i, n) - 1);
  return Math.round(parcela * n * 100) / 100;
}

function formatBR(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function formatCardNumber(value: string) {
  return value.replace(/\D/g, "").replace(/(\d{4})(?=\d)/g, "$1 ").slice(0, 19);
}

function formatExpiration(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 6); // máx 6 dígitos (MMAAAA)
  if (digits.length <= 2) return digits;
  return digits.slice(0, 2) + "/" + digits.slice(2);
}

/**
 * Aceita MM/AA ou MM/AAAA e normaliza para MM/AAAA (formato exigido pela Cielo).
 * "25" → "2025" (assume século atual).
 */
function normalizeExpiration(value: string): string {
  const parts = value.split("/");
  if (parts.length !== 2) return value;
  const [month, year] = parts;
  if (year.length === 2) {
    return `${month}/20${year}`;
  }
  return value;
}

export default function PagamentoPage({ params }: { params: { draftId: string } }) {
  const router = useRouter();
  const [draft, setDraft] = useState<ReservationDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [pixData, setPixData] = useState<{ qrCodeBase64: string; qrCodeString: string } | null>(null);
  const [pixStatus, setPixStatus] = useState<"loading" | "pending" | "paid" | "failed">("loading");
  const [pixCopied, setPixCopied] = useState(false);
  const [pixError, setPixError] = useState<string | null>(null);
  const [pixStarted, setPixStarted] = useState(false);
  const [showManualCheck, setShowManualCheck] = useState(false);
  const [manualChecking, setManualChecking] = useState(false);

  const [cardNumber, setCardNumber] = useState("");
  const [cardHolder, setCardHolder] = useState("");
  const [cardExpiration, setCardExpiration] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [installments, setInstallments] = useState(1);
  const [cardProcessing, setCardProcessing] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  // Telemetria: `pagina_abandonada` só faz sentido entre o 3DS ter começado e a
  // cobrança ter sido pedida. Refs, não estado — mudar isto não pode rerenderizar
  // a tela de pagamento.
  const marcou3dsRef = useRef(false);
  const marcouSubmitRef = useRef(false);

  // ---- Caminho Braspag (só quando PAYMENT_PROVIDER=braspag) ----
  // Enquanto não carrega, assume "cielo" → comportamento idêntico ao atual.
  const [provider, setProvider] = useState<"cielo" | "braspag">("cielo");
  const [providerLoaded, setProviderLoaded] = useState(false); // flag respondeu
  const [sandbox, setSandbox] = useState(false); // habilita o checkbox de teste
  const [testOverride, setTestOverride] = useState(false); // bypass de sandbox
  const [braspagReady, setBraspagReady] = useState(false); // 3DS onReady
  // QR do Pix Braspag gerado localmente quando a API não retorna a imagem
  const [pixQrLocalSrc, setPixQrLocalSrc] = useState("");
  // Após a janela de polling (15min) sem confirmação: mensagem tranquilizadora
  // (a confirmação pode levar alguns minutos e a reserva nasce automaticamente).
  const [pixWaitLong, setPixWaitLong] = useState(false);
  const providerIdRef = useRef<string>(""); // ProviderIdentifier do fingerprint
  // Chave da sessao 3DS ja inicializada: "<centavos>:<parcelas>".
  // Era um booleano, e por isso a sessao nascia com `installments: 1` e valor do
  // draft, enquanto a autenticacao usava o valor e as parcelas REAIS. No avulso a
  // vista os dois coincidiam; num pacote em 6x, nao. Cavv gerado para um par
  // (valor, parcelas) e usado para outro.
  const braspagInitRef = useRef<string>("");
  // Reexecuta o efeito de init do 3DS.
  //
  // Zerar `braspagInitRef` e chamar `setBraspagReady(false)` NÃO fazia o efeito
  // rodar de novo: um ref não é dependência e nenhuma das deps mudava. Depois de
  // um 3DS malsucedido a sessão nunca era recriada e o botão de pagar ficava
  // desabilitado até o hóspede recarregar a página — a trava relatada.
  const [reinit3ds, setReinit3ds] = useState(0);
  // Fingerprint efetivamente coletado. Sem ele, nao enviamos transacao.
  const [fingerprintPronto, setFingerprintPronto] = useState(false);
  const threeDSResultRef = useRef<ThreeDSResult | null>(null);
  const threeDSResolverRef = useRef<((r: ThreeDSResult) => void) | null>(null);

  // Endereço de cobrança (exigido pelo antifraude no fluxo Braspag)
  const [billCep, setBillCep] = useState("");
  const [billStreet, setBillStreet] = useState("");
  const [billNumber, setBillNumber] = useState("");
  const [billComplement, setBillComplement] = useState("");
  const [billNeighborhood, setBillNeighborhood] = useState("");
  const [billCity, setBillCity] = useState("");
  const [billUf, setBillUf] = useState("");
  const [cepLoading, setCepLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/reservations/draft?id=${params.draftId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.draft) setDraft(data.draft);
        else setLoadError("Sessão expirada. Por favor, volte e refaça a reserva.");
      })
      .catch(() => setLoadError("Erro ao carregar reserva."));
  }, [params.draftId]);

  // add_payment_info NÃO é disparado aqui.
  //
  // Esta rota é isolada de scripts de terceiro (ver AnalyticsScripts e a CSP do
  // middleware): ela renderiza os campos bpmpi_* com dados de cartão no DOM.
  // O método de pagamento já viaja no `begin_checkout` empurrado no GuestForm,
  // que é a etapa imediatamente anterior e tem o GTM carregado.

  // Descobre o provider (flag). Default "cielo" até responder → sem efeito no
  // modo cielo. NENHUM script Braspag é tocado aqui.
  // `trocouParaCielo` reexecuta este efeito depois do fallback: a rota devolve
  // o `provider_forcado` gravado no draft, e a tela se remonta apontando para a
  // Cielo sem que o hóspede recomece a reserva.
  const [trocouParaCielo, setTrocouParaCielo] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // `draftId` faz a rota respeitar o `provider_forcado` deste draft.
    fetch(`/api/payments/provider?draftId=${encodeURIComponent(params.draftId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        // Explícito nos dois sentidos: sem isto, o fallback devolveria "cielo"
        // e o estado continuaria em "braspag", porque só havia o `if` de subida.
        if (d?.provider === "braspag") setProvider("braspag");
        else if (d?.provider === "cielo") setProvider("cielo");
        if (d?.sandbox === true) setSandbox(true);
        setProviderLoaded(true);
      })
      .catch(() => setProviderLoaded(true)); // falhou = segue como cielo (default)
    return () => {
      cancelled = true;
    };
  }, [params.draftId, trocouParaCielo]);

  // Valor efetivamente cobrado, calculado junto dos demais hooks para que a
  // sessao 3DS possa nascer com ele. Espelha exatamente a lista de parcelas
  // exibida abaixo — uma fonte so, para init e autenticacao nao divergirem.
  const valorACobrar = useMemo(() => {
    if (!draft) return 0;
    const aVista = draft.finalTotal;
    const cupom = draft.couponCode ? COUPONS.find((c) => c.code === draft.couponCode) || null : null;
    const semJuros = cupom?.installmentsWithoutInterest ?? 6;
    if (installments <= 1 || draft.nights === 1) return aVista;
    if (installments <= semJuros) return aVista;
    return calcTotalComJuros(aVista, installments);
  }, [draft, installments]);

  // Caminho Braspag: prepara FingerPrint + 3DS APENAS quando provider=braspag e
  // for pagamento com cartão. No modo cielo este efeito não faz absolutamente
  // nada (early return), então nenhum fetch/af-config/3ds-session/script roda.
  useEffect(() => {
    if (provider !== "braspag") return;
    if (!draft || draft.paymentMethod !== "card") return;

    // A sessao 3DS precisa nascer com o MESMO valor e as MESMAS parcelas que a
    // autenticacao vai usar. Se qualquer um dos dois muda, a sessao e refeita.
    const centavos = Math.round(valorACobrar * 100);
    const chave = `${centavos}:${installments}`;
    if (braspagInitRef.current === chave) return;
    braspagInitRef.current = chave;

    let cancelado = false;
    setBraspagReady(false);

    (async () => {
      try {
        const fp = await initBraspagFingerprint();
        if (cancelado) return;
        providerIdRef.current = fp.providerIdentifier;
        setFingerprintPronto(Boolean(fp.providerIdentifier));
      } catch (e) {
        console.error("[Braspag:checkout] fingerprint:", e);
        setFingerprintPronto(false);
      }
      try {
        resetBraspag3ds();
        await initBraspag3ds({
          orderNumber: params.draftId,
          amountCentavos: centavos,
          installments,
          onReady: () => {
            if (!cancelado) setBraspagReady(true);
            // A sessao 3DS existe. Daqui ate `submit_iniciado` fica o trecho que
            // era invisivel: em 02/09 nasceram 8 sessoes e zero cobrancas foram
            // pedidas, sem uma linha de log.
            marcou3dsRef.current = true;
            emitirTelemetria({ draftId: params.draftId, provider: "braspag", etapa: "3ds_iniciado" });
          },
          onResult: (r) => {
            threeDSResultRef.current = r;
            threeDSResolverRef.current?.(r);
          },
        });
      } catch (e) {
        console.error("[Braspag:checkout] 3ds init:", e);
        // Libera a chave: sem isso, a falha trava o botao para sempre e so
        // recarregar a pagina resolve — foi o sintoma relatado.
        braspagInitRef.current = "";
        setCardError("Não foi possível preparar o pagamento seguro. Tente novamente ou pague via Pix.");
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [provider, draft, params.draftId, valorACobrar, installments, reinit3ds]);

  useEffect(() => {
    if (!draft || draft.paymentMethod !== "pix" || pixStarted) return;
    // Aguarda a flag do provider responder antes de gerar a cobrança — evita
    // gerar o Pix no gateway errado. No modo cielo o endpoint e o fluxo são os
    // mesmos de sempre (apenas aguarda 1 fetch rápido).
    if (!providerLoaded) return;
    setPixStarted(true);

    // provider=braspag → Pix Braspag (reserva só nasce na confirmação).
    // provider=cielo → fluxo atual intacto. VALIDAR EM PRODUÇÃO (braspag):
    // em sandbox o Pix Braspag nunca muda de status.
    const pixEndpoint = provider === "braspag" ? "/api/payments/braspag/pix" : "/api/payments/pix";

    fetch(pixEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId: params.draftId }),
    })
      .then(async (r) => {
        const data = await r.json();
        if (data.error) throw new Error(data.error);
        setPixData({ qrCodeBase64: data.qrCodeBase64, qrCodeString: data.qrCodeString });
        // Braspag (Simulado/algumas versões) pode não retornar a imagem: gera o
        // QR localmente a partir do copia-e-cola (mesma técnica validada na
        // página de teste).
        if (provider === "braspag" && !data.qrCodeBase64 && data.qrCodeString) {
          try {
            const QR = (await import("qrcode")).default;
            setPixQrLocalSrc(await QR.toDataURL(data.qrCodeString, { margin: 1, width: 224 }));
          } catch {
            // sem imagem local: copia-e-cola continua funcionando
          }
        }
        setPixStatus("pending");
      })
      .catch((err) => {
        setPixStatus("failed");
        setPixError((err as Error).message || "Erro ao gerar QR Code Pix.");
      });
  }, [draft, params.draftId, pixStarted, provider, providerLoaded]);

  useEffect(() => {
    if (pixStatus !== "pending") return;
    let timeoutId: ReturnType<typeof setTimeout>;
    let stopped = false;

    // braspag: polling reconsulta a Braspag e confirma (reserva nasce lá).
    // cielo: rota atual intacta. VALIDAR EM PRODUÇÃO (braspag).
    const statusUrl =
      provider === "braspag"
        ? `/api/payments/braspag/pix/status?draftId=${params.draftId}`
        : `/api/payments/pix/status?draftId=${params.draftId}`;

    // Cronograma: 5s nos primeiros 2min, depois 10s até 15min totais. Um hóspede
    // real leva 2-5min para pagar — a janela curta anterior (60s) perdia isso.
    const startedAt = Date.now();
    const FAST_UNTIL = 2 * 60 * 1000; // 2 min a 5s
    const TOTAL_WINDOW = 15 * 60 * 1000; // 15 min totais

    async function checkStatus() {
      try {
        const res = await fetch(statusUrl);
        const data = await res.json();
        if (data.status === "paid") {
          stopped = true;
          router.push(`/reservar/${params.draftId}/confirmacao`);
          return;
        }
        if (data.status === "failed" || data.status === "expired") {
          if (data.status === "expired") setPixError("O prazo para pagamento deste Pix expirou. Gere uma nova reserva ou fale com o concierge.");
          setPixStatus("failed");
          stopped = true;
          return;
        }
      } catch {}
      if (stopped) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= TOTAL_WINDOW) {
        // Encerra o polling ativo, mas SEM sugerir falha: a confirmação pode
        // chegar depois (webhook/cron) e a reserva nasce automaticamente.
        setPixWaitLong(true);
        return;
      }
      const nextDelay = elapsed < FAST_UNTIL ? 5000 : 10000;
      timeoutId = setTimeout(checkStatus, nextDelay);
    }

    timeoutId = setTimeout(checkStatus, 5000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && !stopped) checkStatus();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopped = true;
      clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [pixStatus, params.draftId, router, provider]);

  // Abandono entre o 3DS e a cobrança.
  //
  // É a assinatura do incidente de 02/09: sessão 3DS criada, nenhuma cobrança
  // pedida, hóspede sumiu. Efeito PRÓPRIO, com handler próprio — o handler de
  // `visibilitychange` do polling do Pix continua exatamente como está.
  useEffect(() => {
    const aoEsconder = () => {
      if (document.visibilityState !== "hidden") return;
      if (!marcou3dsRef.current || marcouSubmitRef.current) return;
      // Uma vez por página: reaparecer e sair de novo não é um novo abandono.
      marcou3dsRef.current = false;
      emitirTelemetria({
        draftId: params.draftId,
        provider: provider || "desconhecido",
        etapa: "pagina_abandonada",
        detalhe: "saiu entre 3ds_iniciado e submit_iniciado",
      });
    };
    document.addEventListener("visibilitychange", aoEsconder);
    return () => document.removeEventListener("visibilitychange", aoEsconder);
  }, [params.draftId, provider]);

  useEffect(() => {
    if (pixStatus !== "pending") return;
    const timer = setTimeout(() => setShowManualCheck(true), 30000);
    return () => clearTimeout(timer);
  }, [pixStatus]);

  async function handleManualCheck() {
    setManualChecking(true);
    try {
      const statusUrl =
        provider === "braspag"
          ? `/api/payments/braspag/pix/status?draftId=${params.draftId}`
          : `/api/payments/pix/status?draftId=${params.draftId}`;
      const res = await fetch(statusUrl);
      const data = await res.json();
      if (data.status === "paid") {
        router.push(`/reservar/${params.draftId}/confirmacao`);
      } else if (data.status === "pending") {
        alert("Pagamento ainda não confirmado. Aguarde alguns instantes e tente novamente.");
      } else {
        if (data.status === "expired") setPixError("O prazo para pagamento deste Pix expirou. Gere uma nova reserva ou fale com o concierge.");
        setPixStatus("failed");
      }
    } catch {
      alert("Erro ao verificar. Tente novamente.");
    } finally {
      setManualChecking(false);
    }
  }

  async function handleCardSubmit() {
    if (!draft) return;
    setCardProcessing(true);
    setCardError(null);

    // Normaliza MM/AA → MM/AAAA (Cielo só aceita ano com 4 dígitos)
    const normalizedExpiration = normalizeExpiration(cardExpiration);
    const expParts = normalizedExpiration.split("/");
    if (expParts.length !== 2 || expParts[0].length !== 2 || expParts[1].length !== 4) {
      setCardError("Data de validade inválida. Use o formato MM/AAAA (ex: 01/2028).");
      setCardProcessing(false);
      return;
    }

    try {
      marcouSubmitRef.current = true;
      emitirTelemetria({ draftId: params.draftId, provider: "cielo", etapa: "submit_iniciado" });
      const res = await fetch("/api/payments/credit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: params.draftId,
          cardNumber: cardNumber.replace(/\s/g, ""),
          cardHolder,
          cardExpiration: normalizedExpiration,
          cardCvv,
          installments,
          amountOverride: valorACobrar,
        }),
      });
      const data = await res.json();
      if (data.approved) {
        router.push(`/reservar/${params.draftId}/confirmacao`);
      } else {
        setCardError(data.returnMessage || data.error || "Pagamento não aprovado. Verifique os dados e tente novamente.");
      }
    } catch (err) {
      // O `fetch` rejeitou ANTES de haver resposta HTTP: rede caiu, DNS, CORS.
      // É o desfecho que some do log do servidor — ele nunca soube da tentativa.
      emitirTelemetria({
        draftId: params.draftId,
        provider: "cielo",
        etapa: "submit_erro_rede",
        detalhe: (err as Error)?.name || "erro de rede",
      });
      setCardError((err as Error)?.message || "Erro de conexão. Verifique sua internet e tente novamente.");
    } finally {
      setCardProcessing(false);
    }
  }

  // ViaCEP: autopreenche cidade/UF/rua/bairro (campos seguem editáveis).
  async function lookupCep(rawCep: string) {
    const cep = rawCep.replace(/\D/g, "");
    if (cep.length !== 8) return;
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await res.json();
      if (!data.erro) {
        if (data.logradouro) setBillStreet(data.logradouro);
        if (data.bairro) setBillNeighborhood(data.bairro);
        if (data.localidade) setBillCity(data.localidade);
        if (data.uf) setBillUf(data.uf);
      }
    } catch {
      // silencioso: usuário pode preencher manualmente
    } finally {
      setCepLoading(false);
    }
  }

  // Espera o resultado do 3DS (um dos callbacks do SDK) após authenticate.
  //
  // COM PRAZO. Se a SDK não chamar nenhum callback — script barrado, rede caída,
  // erro interno dela — a promessa ficaria pendente para sempre e o botão de
  // pagar nunca destravaria. O estouro do prazo resolve como falha, que é o
  // caminho que exibe a mensagem e libera nova tentativa.
  function aguardarResultado3ds(): Promise<ThreeDSResult> {
    return new Promise((resolve) => {
      let resolvido = false;
      const concluir = (r: ThreeDSResult) => {
        if (resolvido) return;
        resolvido = true;
        clearTimeout(prazo);
        threeDSResolverRef.current = null;
        resolve(r);
      };
      // Folga generosa: o challenge do emissor pode exigir senha, app e SMS.
      const prazo = setTimeout(() => {
        console.warn("[Braspag:checkout] 3DS sem resposta dentro do prazo");
        concluir({ event: "onError", ReturnMessage: "timeout" });
      }, TIMEOUT_3DS_MS);
      threeDSResolverRef.current = concluir;
    });
  }

  // SUBMIT do caminho Braspag (substitui o handler APENAS quando provider=braspag).
  async function handleCardSubmitBraspag() {
    if (!draft) return;
    setCardError(null);

    const normalizedExpiration = normalizeExpiration(cardExpiration);
    const expParts = normalizedExpiration.split("/");
    if (expParts.length !== 2 || expParts[0].length !== 2 || expParts[1].length !== 4) {
      setCardError("Data de validade inválida. Use o formato MM/AAAA (ex: 01/2028).");
      return;
    }
    if (billCep.replace(/\D/g, "").length !== 8) {
      setCardError("CEP inválido. Informe os 8 dígitos do CEP de cobrança.");
      return;
    }
    if (!billNumber.trim()) {
      setCardError("Informe o número do endereço de cobrança.");
      return;
    }
    if (!braspagReady) {
      setCardError("Estamos preparando o pagamento seguro. Aguarde um instante e tente novamente.");
      return;
    }
    // Fingerprint ausente = rejeicao automatica no antifraude, independente do
    // score. Melhor falhar aqui, com mensagem clara, do que enviar a transacao
    // sem dado de dispositivo e colher uma recusa sem causa aparente.
    if (!fingerprintPronto || !providerIdRef.current) {
      setCardError(
        "Não conseguimos identificar seu dispositivo para a análise de segurança. Recarregue a página e tente de novo, ou pague via Pix.",
      );
      return;
    }

    // A partir daqui o botão fica travado. TODA saída passa pelo `finally`, que
    // o devolve: uma ramificação de erro que esqueça de destravar deixa o
    // hóspede sem conseguir tentar de novo, com a reserva parada.
    setCardProcessing(true);
    try {
      const billing = {
        street: billStreet,
        number: billNumber,
        complement: billComplement,
        neighborhood: billNeighborhood,
        city: billCity,
        state: billUf,
        zipCode: billCep.replace(/\D/g, ""),
      };

      // 1) Autenticação 3DS no navegador.
      const resultadoPromise = aguardarResultado3ds();
      const disparou = authenticate3ds({
        card: { number: cardNumber, holder: cardHolder, expirationMMYYYY: normalizedExpiration },
        amountCentavos: Math.round(valorACobrar * 100),
        orderNumber: params.draftId,
        installments,
        billing: { zipcode: billing.zipCode, street1: billStreet, city: billCity, state: billUf },
      });
      if (!disparou) {
        setCardError("Pagamento seguro ainda não pronto. Aguarde e tente novamente.");
        return;
      }
      // O desafio foi despachado ao SDK. A partir daqui corre o relógio da
      // telemetria (120s), que é SÓ observação: o prazo funcional do fluxo
      // continua sendo o `TIMEOUT_3DS_MS` de 5 min, intocado.
      emitirTelemetria({
        draftId: params.draftId,
        provider: "braspag",
        etapa: "3ds_desafio_exibido",
      });
      let avisouTimeout = false;
      const relogioTelemetria = setTimeout(() => {
        avisouTimeout = true;
        emitirTelemetria({
          draftId: params.draftId,
          provider: "braspag",
          etapa: "3ds_timeout",
          detalhe: "sem retorno do SDK em 120s",
        });
      }, TELEMETRIA_TIMEOUT_3DS_MS);

      const r3ds = await resultadoPromise;
      clearTimeout(relogioTelemetria);

      emitirTelemetria({
        draftId: params.draftId,
        provider: "braspag",
        etapa: r3ds.event === "onSuccess" ? "3ds_retorno_sucesso" : "3ds_retorno_falha",
        detalhe: `${r3ds.event}${avisouTimeout ? " (apos aviso de 120s)" : ""}`,
      });

      // 2) Só o onSuccess segue para a cobrança. Demais = falha amigável + retry.
      if (r3ds.event !== "onSuccess") {
        console.warn("[Braspag:checkout] 3DS não-sucesso:", r3ds.event, r3ds.ReturnCode);
        setCardError(MSG_3DS_FALHOU);
        // Novo token para a próxima tentativa.
        // Limpar a chave faz o efeito de init rodar de novo, com o valor e as
        // parcelas ATUAIS. Antes havia uma segunda init aqui, com `installments: 1`
        // e o total do draft — reintroduzindo a divergencia que causou o problema.
        resetBraspag3ds();
        setBraspagReady(false);
        braspagInitRef.current = "";
        setReinit3ds((n) => n + 1);
        return;
      }

      // 3) Cobrança real (autoriza + antifraude + captura separada no servidor).
      marcouSubmitRef.current = true;
      emitirTelemetria({ draftId: params.draftId, provider: "braspag", etapa: "submit_iniciado" });
      const res = await fetch("/api/payments/braspag/credit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: params.draftId,
          cardNumber: cardNumber.replace(/\s/g, ""),
          cardHolder,
          cardExpiration: normalizedExpiration,
          cardCvv,
          installments,
          amountOverride: valorACobrar,
          browserFingerprint: providerIdRef.current,
          externalAuthentication: {
            Cavv: r3ds.Cavv,
            Xid: r3ds.Xid,
            Eci: r3ds.Eci,
            Version: r3ds.Version,
            ReferenceId: r3ds.ReferenceId,
          },
          billing,
          // Só é enviado (e só surte efeito) em sandbox; o servidor ignora em produção.
          testAuthCardOverride: sandbox && testOverride,
        }),
      });
      const data = await res.json();
      if (data.approved) {
        router.push(`/reservar/${params.draftId}/confirmacao`);
      } else {
        setCardError(data.returnMessage || data.error || "Pagamento não aprovado. Verifique os dados e tente novamente.");

        // FALLBACK: o servidor já marcou o draft para a Cielo. Reconsultar o
        // provider remonta a tela no outro caminho, com os dados do cartão que
        // o hóspede acabou de digitar ainda no formulário — ele só reenvia.
        //
        // Nenhum dado de cartão trafega para lugar novo: o formulário é o mesmo
        // e o próximo POST vai para `/api/payments/credit`, que já revalida
        // preço e disponibilidade e já dispara conversão server-side.
        if (data.fallbackDisponivel === true) {
          console.warn("[Braspag:checkout] fallback para Cielo acionado pelo servidor");
          setTrocouParaCielo((n) => n + 1);
        }
      }
    } catch (err) {
      // Rejeição antes de haver resposta HTTP. O servidor nunca soube da
      // tentativa — sem esta linha, ela não existe em lugar nenhum.
      emitirTelemetria({
        draftId: params.draftId,
        provider: "braspag",
        etapa: "submit_erro_rede",
        detalhe: (err as Error)?.name || "erro de rede",
      });
      setCardError((err as Error)?.message || "Erro de conexão. Verifique sua internet e tente novamente.");
    } finally {
      // Único ponto que destrava o botão. Vale inclusive no caminho aprovado:
      // a navegação já saiu, e destravar não tem efeito colateral.
      setCardProcessing(false);
    }
  }

  // Dispatcher do botão Pagar: cielo = fluxo atual intacto; braspag = novo fluxo.
  function onPayClick() {
    if (provider === "braspag") {
      void handleCardSubmitBraspag();
    } else {
      void handleCardSubmit();
    }
  }

  const property = draft ? PROPERTIES.find((p) => p.slug === draft.propertyId) : null;

  if (!draft && !loadError) {
    return (
      <main className="min-h-screen bg-cream pt-32 pb-20">
        <Container>
          <p className="text-center font-sans text-charcoal/60">Carregando reserva...</p>
        </Container>
      </main>
    );
  }

  if (loadError || !draft) {
    return (
      <main className="min-h-screen bg-cream pt-32 pb-20">
        <Container>
          <div className="mx-auto max-w-lg text-center">
            <Heading level={2} className="text-3xl">Sessão expirada</Heading>
            <p className="mt-4 font-sans text-charcoal/70">{loadError}</p>
            <div className="mt-8 flex flex-col items-center gap-4">
              <a href="/" className="bg-copper px-8 py-4 font-sans text-xs uppercase tracking-widest text-cream hover:bg-copper/90">
                Voltar ao início
              </a>
              <a
                href="https://wa.me/5535984075652?text=Ol%C3%A1%21+Tive+um+problema+ao+finalizar+minha+reserva."
                target="_blank"
                rel="noopener noreferrer"
                className="font-sans text-xs text-copper underline"
              >
                Falar com o concierge
              </a>
            </div>
          </div>
        </Container>
      </main>
    );
  }

  function ResumoCard() {
    return (
      <div className="border border-charcoal/10 bg-white">
        {property && (
          <div className="relative aspect-[4/3] overflow-hidden bg-charcoal/5">
            <Image src={property.heroImage} alt={draft!.propertyName} fill sizes="420px" className="object-cover" />
          </div>
        )}
        <div className="p-6">
          {property && <Kicker className="mb-2">{property.badge}</Kicker>}
          <h2 className="font-serif text-2xl text-charcoal">{draft!.propertyName}</h2>
          {draft!.packageSlug && (
            <p className="mt-1 font-sans text-xs uppercase tracking-[0.2em] text-copper">
              Pacote {draft!.packageName}
            </p>
          )}
          <ul className="mt-5 space-y-3 border-y border-charcoal/10 py-5 font-sans text-sm">
            <li className="flex justify-between">
              <span className="text-charcoal/60">Check-in</span>
              <span>{formatBR(draft!.checkin)} às 15h</span>
            </li>
            <li className="flex justify-between">
              <span className="text-charcoal/60">Check-out</span>
              <span>{formatBR(draft!.checkout)} às 11h</span>
            </li>
            <li className="flex justify-between">
              <span className="text-charcoal/60">Hóspedes</span>
              <span>{draft!.guests}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-charcoal/60">Noites</span>
              <span>{draft!.nights}</span>
            </li>
          </ul>
          <div className="mt-5 space-y-2 font-sans text-sm">
            {draft!.packageSlug ? (
              <>
                <div className="flex justify-between text-charcoal/70">
                  <span>Estadia ({draft!.nights} noites) — pacote</span>
                  <span>
                    {formatBRLPrecise(
                      draft!.finalTotal +
                        draft!.pixDiscount -
                        (draft!.extrasTotal ?? 0) -
                        (draft!.serviceExtras ?? []).reduce((s, e) => s + e.price, 0) -
                        (draft!.opExtras ?? []).reduce((s, e) => s + e.price, 0),
                    )}
                  </span>
                </div>
                {(draft!.extrasList ?? []).map((e) => (
                  <div key={e} className="flex justify-between gap-4 text-charcoal/70">
                    <span className="min-w-0">{e}</span>
                  </div>
                ))}
              </>
            ) : (
            <div className="flex justify-between text-charcoal/70">
              <span>Subtotal</span>
              <span>{formatBRLPrecise(draft!.totalPrice)}</span>
            </div>
            )}
            {!draft!.packageSlug && draft!.couponDiscount > 0 && (
              <div className="flex justify-between text-serra">
                <span>Cupom {draft!.couponCode}</span>
                <span>− {formatBRLPrecise(draft!.couponDiscount)}</span>
              </div>
            )}
            {draft!.pixDiscount > 0 && (
              <div className="flex justify-between text-serra">
                <span>Desconto Pix (3%)</span>
                <span>− {formatBRLPrecise(draft!.pixDiscount)}</span>
              </div>
            )}
            {(draft!.serviceExtras ?? []).map((e) => (
              <div key={e.id} className="flex justify-between gap-4 text-charcoal/70">
                <span className="min-w-0">
                  {e.label}
                  {e.qty > 1 ? ` ×${e.qty}` : ""}
                </span>
                <span className="flex-shrink-0">{formatBRLPrecise(e.price)}</span>
              </div>
            ))}
            {(draft!.opExtras ?? []).map((e) => (
              <div key={e.type} className="flex justify-between gap-4 text-charcoal/70">
                <span className="min-w-0">{e.label}</span>
                <span className="flex-shrink-0">{formatBRLPrecise(e.price)}</span>
              </div>
            ))}
            <div className="flex items-baseline justify-between border-t border-charcoal/10 pt-4 font-serif">
              <span className="text-base uppercase tracking-widest text-charcoal/70">Total</span>
              <span className="text-3xl text-charcoal">{formatBRLPrecise(draft!.finalTotal)}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (draft.paymentMethod === "pix") {
    return (
      <main className="bg-cream pt-32 pb-20">
        <Container size="wide">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_420px] lg:gap-12">
            <section>
              <Kicker className="mb-4">Pagamento via Pix</Kicker>
              <Heading level={1} className="mb-8 text-4xl">Pague com Pix</Heading>

              {pixStatus === "loading" && (
                <div className="border border-charcoal/10 p-12 text-center">
                  <p className="font-sans text-charcoal/60">Gerando QR Code...</p>
                </div>
              )}

              {pixStatus === "pending" && pixData && (
                <div className="border border-charcoal/10 p-8">
                  <p className="mb-6 font-sans text-sm text-charcoal/70">
                    {provider === "braspag"
                      ? "Escaneie o QR Code abaixo ou copie o código Pix. Após o pagamento, sua reserva será confirmada automaticamente."
                      : "Escaneie o QR Code abaixo ou copie o código Pix. Após o pagamento, a confirmação é automática."}
                  </p>
                  {(pixData.qrCodeBase64 || pixQrLocalSrc) && (
                    <div className="mb-6 flex justify-center">
                      <img
                        src={pixData.qrCodeBase64 ? `data:image/png;base64,${pixData.qrCodeBase64}` : pixQrLocalSrc}
                        alt="QR Code Pix"
                        className="h-56 w-56 border border-charcoal/10 p-2"
                      />
                    </div>
                  )}
                  <div className="mb-4 rounded-sm bg-charcoal/5 p-4">
                    <p className="mb-2 font-sans text-[0.6rem] uppercase tracking-[0.2em] text-charcoal/60">
                      Pix copia e cola
                    </p>
                    <p className="mb-3 break-all font-mono text-xs text-charcoal">
                      {pixData.qrCodeString.slice(0, 60)}...
                    </p>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(pixData.qrCodeString);
                        setPixCopied(true);
                        setTimeout(() => setPixCopied(false), 3000);
                      }}
                      className="w-full border border-charcoal bg-charcoal py-3 font-sans text-xs uppercase tracking-widest text-cream transition-colors hover:bg-serra"
                    >
                      {pixCopied ? "✓ Copiado!" : "Copiar código Pix"}
                    </button>
                  </div>
                  <div className="flex items-center gap-3 text-charcoal/60">
                    <div className="h-2 w-2 animate-pulse rounded-full bg-copper" />
                    <p className="font-sans text-xs">Aguardando confirmação do pagamento...</p>
                  </div>
                  {pixWaitLong && (
                    <div className="mt-4 border border-copper/30 bg-copper/5 p-4">
                      <p className="font-sans text-xs text-charcoal/80">
                        A confirmação do seu Pix pode levar alguns minutos. Você já pode fechar esta
                        página — assim que o pagamento for confirmado, sua reserva é criada
                        automaticamente e você recebe a confirmação por e-mail. Se preferir, use o
                        botão abaixo para verificar agora.
                      </p>
                    </div>
                  )}
                  {showManualCheck && (
                    <button
                      onClick={handleManualCheck}
                      disabled={manualChecking}
                      className="mt-4 w-full border border-charcoal py-3 font-sans text-xs uppercase tracking-widest text-charcoal transition-colors hover:bg-charcoal hover:text-cream disabled:opacity-50"
                    >
                      {manualChecking ? "Verificando..." : "Já paguei — confirmar pagamento"}
                    </button>
                  )}
                </div>
              )}

              {pixStatus === "failed" && (
                <div className="border border-red-200 bg-red-50 p-8 text-center">
                  <p className="mb-4 font-sans text-sm text-charcoal">
                    {pixError || "Pagamento não confirmado. Tente novamente ou fale com o concierge."}
                  </p>
                  <a
                    href={`https://wa.me/5535984075652?text=${encodeURIComponent(`Olá! Tive um problema ao pagar via Pix minha reserva no ${draft.propertyName}.`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block bg-[#25D366] px-6 py-3 font-sans text-xs uppercase tracking-widest text-white"
                  >
                    Falar com o concierge
                  </a>
                </div>
              )}
            </section>
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <ResumoCard />
            </aside>
          </div>
        </Container>
      </main>
    );
  }

  const totalAVista = draft.finalTotal;
  const isSingleNight = draft.nights === 1;
  const appliedCoupon = draft.couponCode ? COUPONS.find((c) => c.code === draft.couponCode) || null : null;

  const semJurosLimite = appliedCoupon?.installmentsWithoutInterest ?? 6;
  const maxParcelas = appliedCoupon?.maxInstallments ?? 12;

  const opcoesParcelas: { n: number; label: string; totalCobrado: number }[] = [];
  for (let n = 1; n <= maxParcelas; n++) {
    if (n === 1) {
      opcoesParcelas.push({
        n,
        label: `À vista — ${formatBRLPrecise(totalAVista)}`,
        totalCobrado: totalAVista,
      });
    } else if (n <= semJurosLimite) {
      opcoesParcelas.push({
        n,
        label: `${n}x de ${formatBRLPrecise(totalAVista / n)} sem juros`,
        totalCobrado: totalAVista,
      });
    } else {
      const totalComJuros = calcTotalComJuros(totalAVista, n);
      opcoesParcelas.push({
        n,
        label: `${n}x de ${formatBRLPrecise(totalComJuros / n)} (total ${formatBRLPrecise(totalComJuros)})`,
        totalCobrado: totalComJuros,
      });
    }
  }

  const opcoesFiltradas = isSingleNight
    ? opcoesParcelas.filter((o) => o.n === 1)
    : opcoesParcelas;

  const opcaoSelecionada = opcoesParcelas.find((o) => o.n === installments);

  return (
    <main className="bg-cream pt-32 pb-20">
      <Container size="wide">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_420px] lg:gap-12">
          <section>
            <Kicker className="mb-4">Pagamento com Cartão</Kicker>
            <Heading level={1} className="mb-8 text-4xl">Dados do cartão</Heading>

            <div className="space-y-5">
              <div>
                <label className="mb-2 block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
                  Número do cartão
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                  placeholder="0000 0000 0000 0000"
                  maxLength={19}
                  className="w-full border-b border-charcoal/20 bg-transparent pb-2 font-serif text-xl text-charcoal placeholder:text-charcoal/20 focus:border-copper focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
                  Nome impresso no cartão
                </label>
                <input
                  type="text"
                  value={cardHolder}
                  onChange={(e) => setCardHolder(e.target.value.toUpperCase())}
                  placeholder="NOME COMPLETO"
                  className="w-full border-b border-charcoal/20 bg-transparent pb-2 font-serif text-xl text-charcoal placeholder:text-charcoal/20 focus:border-copper focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="mb-2 block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
                    Validade
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={cardExpiration}
                    onChange={(e) => setCardExpiration(formatExpiration(e.target.value))}
                    placeholder="MM/AAAA"
                    maxLength={7}
                    className="w-full border-b border-charcoal/20 bg-transparent pb-2 font-serif text-xl text-charcoal placeholder:text-charcoal/20 focus:border-copper focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-2 block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
                    CVV
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={cardCvv}
                    onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    placeholder="000"
                    maxLength={4}
                    className="w-full border-b border-charcoal/20 bg-transparent pb-2 font-serif text-xl text-charcoal placeholder:text-charcoal/20 focus:border-copper focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
                  Parcelamento
                </label>
                <select
                  value={installments}
                  onChange={(e) => setInstallments(Number(e.target.value))}
                  className="w-full border-b border-charcoal/20 bg-transparent pb-2 font-serif text-base text-charcoal focus:border-copper focus:outline-none md:text-lg"
                >
                  {opcoesFiltradas.map((o) => (
                    <option key={o.n} value={o.n}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 font-sans text-[0.65rem] text-charcoal/40">
                  {appliedCoupon?.installmentsWithoutInterest === 1
                    ? "Cupom à vista — parcelamentos sujeitos a juros embutidos no valor cobrado."
                    : `Parcelamentos acima de ${semJurosLimite}x: juros já inclusos no valor mostrado. Total final cobrado conforme exibido.`}
                </p>
                {isSingleNight && (
                  <p className="mt-2 font-sans text-xs italic text-charcoal/60">
                    Estadias de 1 noite: pagamento à vista. Parcelamento a partir de 2 noites.
                  </p>
                )}
                {appliedCoupon && (
                  <p className="mt-2 font-sans text-xs text-copper">
                    Cupom {appliedCoupon.code}:{" "}
                    {appliedCoupon.installmentsWithoutInterest === 1
                      ? "parcelamento de 2x a 12x com juros aplicáveis"
                      : `parcelamento sem juros em até ${appliedCoupon.installmentsWithoutInterest ?? 6}x`}
                    .
                  </p>
                )}
              </div>

              {provider === "braspag" && (
                <div className="space-y-5 border-t border-charcoal/10 pt-6">
                  <p className="font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
                    Endereço de cobrança
                  </p>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="mb-2 block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
                        CEP {cepLoading && <span className="text-copper">buscando…</span>}
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={billCep}
                        onChange={(e) => {
                          const v = e.target.value.replace(/\D/g, "").slice(0, 8);
                          setBillCep(v);
                          if (v.length === 8) lookupCep(v);
                        }}
                        placeholder="00000000"
                        maxLength={9}
                        className="w-full border-b border-charcoal/20 bg-transparent pb-2 font-serif text-xl text-charcoal placeholder:text-charcoal/20 focus:border-copper focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
                        Número
                      </label>
                      <input
                        type="text"
                        value={billNumber}
                        onChange={(e) => setBillNumber(e.target.value)}
                        placeholder="123"
                        className="w-full border-b border-charcoal/20 bg-transparent pb-2 font-serif text-xl text-charcoal placeholder:text-charcoal/20 focus:border-copper focus:outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-2 block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
                      Rua / Logradouro
                    </label>
                    <input
                      type="text"
                      value={billStreet}
                      onChange={(e) => setBillStreet(e.target.value)}
                      placeholder="Rua, avenida…"
                      className="w-full border-b border-charcoal/20 bg-transparent pb-2 font-serif text-xl text-charcoal placeholder:text-charcoal/20 focus:border-copper focus:outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="mb-2 block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
                        Complemento <span className="normal-case tracking-normal text-charcoal/30">(opcional)</span>
                      </label>
                      <input
                        type="text"
                        value={billComplement}
                        onChange={(e) => setBillComplement(e.target.value)}
                        placeholder="Apto, bloco…"
                        className="w-full border-b border-charcoal/20 bg-transparent pb-2 font-serif text-xl text-charcoal placeholder:text-charcoal/20 focus:border-copper focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
                        Bairro
                      </label>
                      <input
                        type="text"
                        value={billNeighborhood}
                        onChange={(e) => setBillNeighborhood(e.target.value)}
                        placeholder="Bairro"
                        className="w-full border-b border-charcoal/20 bg-transparent pb-2 font-serif text-xl text-charcoal placeholder:text-charcoal/20 focus:border-copper focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-[1fr_100px] gap-6">
                    <div>
                      <label className="mb-2 block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
                        Cidade
                      </label>
                      <input
                        type="text"
                        value={billCity}
                        onChange={(e) => setBillCity(e.target.value)}
                        placeholder="Cidade"
                        className="w-full border-b border-charcoal/20 bg-transparent pb-2 font-serif text-xl text-charcoal placeholder:text-charcoal/20 focus:border-copper focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
                        UF
                      </label>
                      <input
                        type="text"
                        value={billUf}
                        onChange={(e) => setBillUf(e.target.value.toUpperCase().slice(0, 2))}
                        placeholder="UF"
                        maxLength={2}
                        className="w-full border-b border-charcoal/20 bg-transparent pb-2 font-serif text-xl uppercase text-charcoal placeholder:text-charcoal/20 focus:border-copper focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Checkbox de teste: NÃO renderiza fora de sandbox (não aparece no
                  DOM para o hóspede). `sandbox` só é true quando o servidor
                  confirma BRASPAG_ENVIRONMENT != production via /api/payments/provider;
                  default false garante que nada aparece antes/sem essa confirmação. */}
              {provider === "braspag" && sandbox === true && (
                <label className="flex items-start gap-2 text-charcoal/50">
                  <input
                    type="checkbox"
                    checked={testOverride}
                    onChange={(e) => setTestOverride(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="font-sans text-[0.65rem] leading-snug">
                    Modo teste sandbox (usar cartão de autorização na cobrança). Mantém o 3DS do
                    cartão digitado e troca só o número na autorização — exclusivo de sandbox.
                  </span>
                </label>
              )}

              {cardError && (
                <div className="border border-red-200 bg-red-50 p-4">
                  <p className="font-sans text-xs text-red-700">{cardError}</p>
                  <a
                    href={`https://wa.me/5535984075652?text=${encodeURIComponent(`Olá! Tive um problema ao pagar com cartão minha reserva no ${draft.propertyName}.`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block font-sans text-xs text-copper underline"
                  >
                    Falar com o concierge
                  </a>
                </div>
              )}

              {provider === "braspag" && !braspagReady && !cardError && (
                <div className="flex items-center gap-3 text-charcoal/60">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-copper" />
                  <p className="font-sans text-xs">Preparando pagamento seguro…</p>
                </div>
              )}

              <button
                onClick={onPayClick}
                disabled={
                  !cardNumber ||
                  !cardHolder ||
                  !cardExpiration ||
                  !cardCvv ||
                  cardProcessing ||
                  (provider === "braspag" && !braspagReady)
                }
                className="w-full bg-copper py-4 font-sans text-xs uppercase tracking-[0.25em] text-cream transition-colors hover:bg-copper/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {cardProcessing ? "Processando..." : `Pagar ${formatBRLPrecise(valorACobrar)}`}
              </button>

              <p className="text-center font-sans text-[0.65rem] text-charcoal/40">
                {provider === "braspag"
                  ? "Pagamento processado com segurança pela Cielo/Braspag. Seus dados estão protegidos."
                  : "Pagamento processado com segurança pela Cielo. Seus dados estão protegidos."}
              </p>
            </div>
          </section>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <ResumoCard />
          </aside>
        </div>
      </Container>
    </main>
  );
}
