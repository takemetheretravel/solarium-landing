"use client";

import { useState, FormEvent, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";

type Props = {
  propertySlug: string;
  checkin: string;
  checkout: string;
  guests: number;
  nights?: number;
  paymentMethod: "card" | "pix";
  onPaymentMethodChange: (pm: "card" | "pix") => void;
  couponCode?: string;
};

function maskCPF(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

function validEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function validCPF(raw: string): boolean {
  const cpf = raw.replace(/\D/g, "");
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (slice: number) => {
    let sum = 0;
    for (let i = 0; i < slice; i++) sum += parseInt(cpf.charAt(i)) * (slice + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(9) === parseInt(cpf.charAt(9)) && calc(10) === parseInt(cpf.charAt(10));
}

function validPhone(raw: string): boolean {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("55")) d = d.slice(2);
  return d.length >= 10 && d.length <= 11;
}

export default function GuestForm(props: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [cpf, setCpf] = useState("");
  const [phone, setPhone] = useState("+55 ");
  const [notes, setNotes] = useState("");
  const paymentMethod = props.paymentMethod;
  const setPaymentMethod = props.onPaymentMethodChange;
  const isSingleNight = props.nights === 1;
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const valid = useMemo(
    () =>
      name.trim().length >= 3 &&
      validEmail(email) &&
      validCPF(cpf) &&
      validPhone(phone) &&
      acceptedTerms,
    [name, email, cpf, phone, acceptedTerms],
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/reservations/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertySlug: props.propertySlug,
          checkin: props.checkin,
          checkout: props.checkout,
          guests: props.guests,
          paymentMethod,
          couponCode: props.couponCode,
          guest: { name, email, cpf, phone, notes },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.error || `Erro (${res.status}). Tente novamente.`);
        setSubmitting(false);
        return;
      }
      const data = (await res.json()) as { draftId: string };
      router.push(`/reservar/${data.draftId}/pagamento`);
    } catch {
      setErrorMsg("Falha de conexão. Tente novamente.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8" noValidate>
      <div>
        <span className="block font-sans text-[0.65rem] uppercase tracking-[0.3em] text-copper">
          Hóspede principal
        </span>

        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
              Nome completo *
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="mt-1 w-full border-b border-charcoal/20 bg-transparent py-2 font-serif text-lg text-charcoal outline-none focus:border-copper"
            />
          </label>

          <label className="block">
            <span className="block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
              E-mail *
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 w-full border-b border-charcoal/20 bg-transparent py-2 font-serif text-lg text-charcoal outline-none focus:border-copper"
            />
            {email && !validEmail(email) && (
              <span className="mt-1 block font-sans text-xs text-red-600">E-mail inválido.</span>
            )}
          </label>

          <label className="block">
            <span className="block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
              CPF *
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={cpf}
              onChange={(e) => setCpf(maskCPF(e.target.value))}
              required
              placeholder="000.000.000-00"
              className="mt-1 w-full border-b border-charcoal/20 bg-transparent py-2 font-serif text-lg text-charcoal outline-none focus:border-copper"
            />
            {cpf && !validCPF(cpf) && (
              <span className="mt-1 block font-sans text-xs text-red-600">CPF inválido.</span>
            )}
          </label>

          <label className="block">
            <span className="block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
              Telefone *
            </span>
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              placeholder="+55 (35) 98407-5652"
              className="mt-1 w-full border-b border-charcoal/20 bg-transparent py-2 font-serif text-lg text-charcoal outline-none focus:border-copper"
            />
            {phone && !validPhone(phone) && (
              <span className="mt-1 block font-sans text-xs text-red-600">Telefone inválido.</span>
            )}
          </label>
        </div>

        <label className="mt-5 block">
          <span className="block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
            Observações para o anfitrião
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Opcional — celebrações, restrições alimentares, horário de chegada, pets…"
            className="mt-1 w-full border border-charcoal/15 bg-transparent p-3 font-sans text-sm text-charcoal outline-none focus:border-copper"
          />
        </label>
      </div>

      <div>
        <span className="block font-sans text-[0.65rem] uppercase tracking-[0.3em] text-copper">
          Forma de pagamento
        </span>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setPaymentMethod("pix")}
            className={`border p-5 text-left transition-all ${paymentMethod === "pix" ? "border-serra bg-serra/5" : "border-charcoal/15 hover:border-charcoal/30"}`}
          >
            <span className="block font-serif text-xl text-charcoal">Pix</span>
            <span className="mt-1 block font-sans text-xs text-serra">3% de desconto automático</span>
          </button>
          <button
            type="button"
            onClick={() => setPaymentMethod("card")}
            className={`border p-5 text-left transition-all ${paymentMethod === "card" ? "border-charcoal bg-charcoal/5" : "border-charcoal/15 hover:border-charcoal/30"}`}
          >
            <span className="block font-serif text-xl text-charcoal">Cartão de Crédito</span>
            <span className="mt-1 block font-sans text-xs text-charcoal/60">
              {isSingleNight ? "À vista (1 noite)" : "Em até 12x"}
            </span>
          </button>
        </div>
      </div>

      <label className="flex items-start gap-3 border-t border-charcoal/10 pt-6">
        <input
          type="checkbox"
          checked={acceptedTerms}
          onChange={(e) => setAcceptedTerms(e.target.checked)}
          required
          className="mt-1 h-4 w-4 flex-shrink-0 accent-serra"
        />
        <span className="font-sans text-sm leading-relaxed text-charcoal/80">
          Li e concordo com os{" "}
          <a
            href="/termos"
            target="_blank"
            rel="noopener noreferrer"
            className="text-copper underline underline-offset-4 hover:text-charcoal"
          >
            Termos e Condições
          </a>{" "}
          e a{" "}
          <a
            href="/privacidade"
            target="_blank"
            rel="noopener noreferrer"
            className="text-copper underline underline-offset-4 hover:text-charcoal"
          >
            Política de Privacidade
          </a>
          .
        </span>
      </label>

      {errorMsg && (
        <div className="border border-red-300 bg-red-50 p-4 font-sans text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      <button
        type="submit"
        disabled={!valid || submitting}
        className="flex w-full items-center justify-center gap-2 bg-copper py-5 font-sans text-xs uppercase tracking-[0.3em] text-cream transition-colors hover:bg-copper/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Processando…" : "Continuar para pagamento"}
        <ArrowRight className="h-4 w-4" />
      </button>
    </form>
  );
}
