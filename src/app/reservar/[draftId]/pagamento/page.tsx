"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Container from "@/components/ui/Container";
import Heading from "@/components/ui/Heading";
import Kicker from "@/components/ui/Kicker";
import { formatBRLPrecise } from "@/lib/cn";
import { PROPERTIES } from "@/config/properties";
import { COUPONS } from "@/config/coupons";
import type { ReservationDraft } from "@/lib/kv-store";

const TAXA_MENSAL = 1.99; // estimativa típica Cielo (% ao mês)

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

function formatExpiration(value: string) {
  return value.replace(/\D/g, "").replace(/(\d{2})(\d)/, "$1/$2").slice(0, 7);
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

  useEffect(() => {
    fetch(`/api/reservations/draft?id=${params.draftId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.draft) setDraft(data.draft);
        else setLoadError("Sessão expirada. Por favor, volte e refaça a reserva.");
      })
      .catch(() => setLoadError("Erro ao carregar reserva."));
  }, [params.draftId]);

  useEffect(() => {
    if (!draft || draft.paymentMethod !== "pix" || pixStarted) return;
    setPixStarted(true);

    fetch("/api/payments/pix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId: params.draftId }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setPixData({ qrCodeBase64: data.qrCodeBase64, qrCodeString: data.qrCodeString });
        setPixStatus("pending");
      })
      .catch((err) => {
        setPixStatus("failed");
        setPixError((err as Error).message || "Erro ao gerar QR Code Pix.");
      });
  }, [draft, params.draftId, pixStarted]);

  useEffect(() => {
    if (pixStatus !== "pending") return;
    let intervalId: ReturnType<typeof setInterval>;

    async function checkStatus() {
      try {
        const res = await fetch(`/api/payments/pix/status?draftId=${params.draftId}`);
        const data = await res.json();
        if (data.status === "paid") {
          clearInterval(intervalId);
          router.push(`/reservar/${params.draftId}/confirmacao`);
        } else if (data.status === "failed") {
          setPixStatus("failed");
          clearInterval(intervalId);
        }
      } catch {}
    }

    intervalId = setInterval(checkStatus, 5000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") checkStatus();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [pixStatus, params.draftId, router]);

  useEffect(() => {
    if (pixStatus !== "pending") return;
    const timer = setTimeout(() => setShowManualCheck(true), 30000);
    return () => clearTimeout(timer);
  }, [pixStatus]);

  async function handleManualCheck() {
    setManualChecking(true);
    try {
      const res = await fetch(`/api/payments/pix/status?draftId=${params.draftId}`);
      const data = await res.json();
      if (data.status === "paid") {
        router.push(`/reservar/${params.draftId}/confirmacao`);
      } else if (data.status === "pending") {
        alert("Pagamento ainda não confirmado. Aguarde alguns instantes e tente novamente.");
      } else {
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
    try {
      const res = await fetch("/api/payments/credit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: params.draftId,
          cardNumber,
          cardHolder,
          cardExpiration,
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
      setCardError((err as Error)?.message || "Erro de conexão. Verifique sua internet e tente novamente.");
    } finally {
      setCardProcessing(false);
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
            <div className="flex justify-between text-charcoal/70">
              <span>Subtotal</span>
              <span>{formatBRLPrecise(draft!.totalPrice)}</span>
            </div>
            {draft!.couponDiscount > 0 && (
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
                    Escaneie o QR Code abaixo ou copie o código Pix. Após o pagamento, a confirmação é automática.
                  </p>
                  <div className="mb-6 flex justify-center">
                    <img
                      src={`data:image/png;base64,${pixData.qrCodeBase64}`}
                      alt="QR Code Pix"
                      className="h-56 w-56 border border-charcoal/10 p-2"
                    />
                  </div>
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
  const valorACobrar = opcaoSelecionada?.totalCobrado ?? totalAVista;

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

              <button
                onClick={handleCardSubmit}
                disabled={!cardNumber || !cardHolder || !cardExpiration || !cardCvv || cardProcessing}
                className="w-full bg-copper py-4 font-sans text-xs uppercase tracking-[0.25em] text-cream transition-colors hover:bg-copper/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {cardProcessing ? "Processando..." : `Pagar ${formatBRLPrecise(valorACobrar)}`}
              </button>

              <p className="text-center font-sans text-[0.65rem] text-charcoal/40">
                Pagamento processado com segurança pela Cielo. Seus dados estão protegidos.
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
