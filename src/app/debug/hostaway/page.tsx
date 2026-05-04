import { notFound } from "next/navigation";
import { getDiagnostic, getListings, getListing } from "@/lib/hostaway";

export const dynamic = "force-dynamic";

const DEBUG_KEY = "lucas2026";

export default async function HostawayDebugPage({
  searchParams,
}: {
  searchParams: { key?: string };
}) {
  if (searchParams?.key !== DEBUG_KEY) notFound();

  const listings = await getListings();
  const detail = listings[0] ? await getListing(listings[0].id) : null;
  const diag = getDiagnostic();

  return (
    <main className="min-h-screen bg-cream pt-32 pb-20">
      <div className="mx-auto max-w-5xl px-6 sm:px-10 lg:px-16">
        <h1 className="font-serif text-4xl text-charcoal">Hostaway — Diagnóstico</h1>
        <p className="mt-2 font-sans text-sm text-charcoal/60">
          Página privada. Não compartilhe a URL com a chave.
        </p>

        <section className="mt-10 border border-charcoal/10 bg-white p-6">
          <h2 className="font-serif text-2xl text-charcoal">Status de autenticação</h2>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-sans text-xs uppercase tracking-widest text-charcoal/50">Credenciais carregadas</dt>
              <dd className="font-mono text-charcoal">{diag.hasCredentials ? "✓ sim" : "✗ não"}</dd>
            </div>
            <div>
              <dt className="font-sans text-xs uppercase tracking-widest text-charcoal/50">Token</dt>
              <dd className="font-mono text-charcoal">
                {diag.tokenStatus === "ok" ? "✓ ok" : diag.tokenStatus === "missing" ? "— ausente" : "✗ erro"}
              </dd>
            </div>
            {diag.tokenObtainedAt && (
              <div>
                <dt className="font-sans text-xs uppercase tracking-widest text-charcoal/50">Obtido em</dt>
                <dd className="font-mono text-xs text-charcoal">{diag.tokenObtainedAt}</dd>
              </div>
            )}
            {diag.tokenExpiresAt && (
              <div>
                <dt className="font-sans text-xs uppercase tracking-widest text-charcoal/50">Expira em</dt>
                <dd className="font-mono text-xs text-charcoal">{diag.tokenExpiresAt}</dd>
              </div>
            )}
            {diag.lastError && (
              <div className="sm:col-span-2">
                <dt className="font-sans text-xs uppercase tracking-widest text-red-600">Último erro</dt>
                <dd className="font-mono text-sm text-red-700">{diag.lastError}</dd>
              </div>
            )}
          </dl>

          <form action="/api/debug/regenerate-token" method="POST" className="mt-6">
            <input type="hidden" name="key" value={DEBUG_KEY} />
            <input type="hidden" name="redirect" value={`/debug/hostaway?key=${DEBUG_KEY}`} />
            <button
              type="submit"
              className="border border-charcoal bg-charcoal px-4 py-2 font-sans text-xs uppercase tracking-widest text-cream hover:bg-serra"
            >
              Forçar regeneração de token
            </button>
          </form>
        </section>

        <section className="mt-10 border border-charcoal/10 bg-white p-6">
          <h2 className="font-serif text-2xl text-charcoal">Listings descobertas</h2>
          <p className="mt-2 font-sans text-sm text-charcoal/70">
            Total: <strong>{listings.length}</strong>
          </p>
          {listings.length > 0 ? (
            <table className="mt-4 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-charcoal/10 text-xs uppercase tracking-widest text-charcoal/50">
                  <th className="py-2 pr-4">ID</th>
                  <th className="py-2 pr-4">Nome</th>
                  <th className="py-2 pr-4">Capacidade</th>
                  <th className="py-2">Preço base</th>
                </tr>
              </thead>
              <tbody className="font-mono text-charcoal">
                {listings.map((l) => (
                  <tr key={l.id} className="border-b border-charcoal/5">
                    <td className="py-2 pr-4">{l.id}</td>
                    <td className="py-2 pr-4">{l.name}</td>
                    <td className="py-2 pr-4">{l.personCapacity}</td>
                    <td className="py-2">
                      {l.price ? `${l.currencyCode} ${l.price}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-4 font-sans text-sm text-red-600">
              Nenhuma listing retornada. Verifique credenciais ou tente regenerar o token.
            </p>
          )}
        </section>

        {detail && (
          <section className="mt-10 border border-charcoal/10 bg-white p-6">
            <h2 className="font-serif text-2xl text-charcoal">
              Primeira listing — JSON (truncado)
            </h2>
            <pre className="mt-4 max-h-96 overflow-auto bg-charcoal/5 p-4 font-mono text-xs text-charcoal">
{JSON.stringify(
  {
    id: detail.id,
    name: detail.name,
    personCapacity: detail.personCapacity,
    bedroomsNumber: detail.bedroomsNumber,
    bathroomsNumber: detail.bathroomsNumber,
    price: detail.price,
    currencyCode: detail.currencyCode,
    cleaningFee: detail.cleaningFee,
    minNights: detail.minNights,
    maxNights: detail.maxNights,
    amenitiesCount: detail.listingAmenities?.length ?? 0,
    imagesCount: detail.listingImages?.length ?? 0,
    firstAmenity: detail.listingAmenities?.[0],
    firstImage: detail.listingImages?.[0],
  },
  null,
  2,
)}
            </pre>
          </section>
        )}
      </div>
    </main>
  );
}
