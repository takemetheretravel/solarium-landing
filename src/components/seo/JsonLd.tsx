import { serializarJsonLd, type JsonLdObjeto } from "@/lib/json-ld";

/** Único ponto do site que emite `application/ld+json` (há teste para isso). */
export default function JsonLd({ dados }: { dados: JsonLdObjeto }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializarJsonLd(dados) }}
    />
  );
}
