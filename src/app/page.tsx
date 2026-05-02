export default function Home() {
  const year = new Date().getFullYear();

  return (
    <main className="relative flex min-h-screen flex-col bg-cream text-charcoal">
      <header className="px-8 pt-10 sm:px-16 sm:pt-12">
        <span className="font-serif text-xl tracking-[0.3em] text-serra sm:text-2xl">
          SOLARIUM
        </span>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center px-8 py-20 text-center sm:px-16">
        <p className="mb-8 text-xs uppercase tracking-[0.4em] text-copper sm:text-sm">
          Serra da Mantiqueira · Brasil
        </p>

        <h1 className="font-serif text-6xl font-light leading-[0.95] tracking-tight text-charcoal text-balance sm:text-8xl md:text-9xl">
          Solarium
          <br />
          <span className="italic text-serra">Mantiqueira</span>
        </h1>

        <p className="mt-10 max-w-xl font-sans text-lg leading-relaxed text-charcoal/80 text-balance sm:text-xl">
          Refúgio de design e experiência na Serra da Mantiqueira.
        </p>

        <div className="mt-16 h-px w-16 bg-copper/60" aria-hidden />

        <p className="mt-10 max-w-md font-sans text-sm uppercase tracking-[0.25em] text-charcoal/60">
          Em breve, nossa nova experiência de reserva direta.
        </p>
      </section>

      <footer className="border-t border-charcoal/10 px-8 py-8 sm:px-16">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 text-xs text-charcoal/60 sm:flex-row">
          <span>© {year} Solarium Mantiqueira</span>
          <span>CNPJ 42.927.255/0001-44 — Take Me There</span>
        </div>
      </footer>
    </main>
  );
}
