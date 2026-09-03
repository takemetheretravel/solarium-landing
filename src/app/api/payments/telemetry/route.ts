import { NextResponse } from "next/server";
import { ETAPAS_TELEMETRIA, type EtapaTelemetria } from "@/lib/telemetria-pagamento";
import { notificarFalhaTerminal } from "@/lib/notificar-falha";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Telemetria do fluxo de pagamento no navegador.
 *
 * POR QUE EXISTE. Em 02/09, o mesmo dispositivo criou 8 sessões 3DS com sucesso
 * e fez ZERO chamadas a `/api/payments/braspag/credit`. O fluxo morreu no
 * navegador, entre a criação da sessão e a submissão, e não existe uma única
 * linha de log sobre isso — o hóspede tentou por 91 minutos e a operação nunca
 * soube. Sem estes eventos, o buraco entre "sessão criada" e "cobrança pedida"
 * é literalmente invisível.
 *
 * CONTRATO: responde 204 SEMPRE, nunca lança, nunca bloqueia o cliente. Uma
 * medição que atrapalha o pagamento é pior que medição nenhuma.
 *
 * PII: só `draftId`, `provider`, `etapa` e um `detalhe` curto. NUNCA cartão,
 * e-mail, telefone ou nome — este log é o mais fácil de exportar e o mais
 * provável de ser lido por quem não precisa desses dados.
 */

const VAZIO = new NextResponse(null, { status: 204 });

/** Etapas que indicam falha. Vão em `warn`; o resto em `info`. */
const ETAPAS_DE_FALHA: ReadonlySet<string> = new Set([
  "3ds_retorno_falha",
  "3ds_timeout",
  "submit_erro_rede",
]);

const LIMITE_DETALHE = 200;
const LIMITE_CORPO_BYTES = 4 * 1024;

/** Só o que não é PII. `detalhe` é truncado e tem quebra de linha removida. */
function limpar(v: unknown, limite: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\r\n]+/g, " ").trim().slice(0, limite);
}

export async function POST(req: Request) {
  try {
    const texto = await req.text();
    if (!texto || texto.length > LIMITE_CORPO_BYTES) return VAZIO;

    const corpo = JSON.parse(texto) as {
      draftId?: unknown;
      provider?: unknown;
      etapa?: unknown;
      detalhe?: unknown;
      userAgent?: unknown;
    };

    const etapa = limpar(corpo.etapa, 40);
    // Etapa fora da lista é DESCARTADA EM SILÊNCIO, como especificado: o
    // endpoint é público (chamado pelo navegador) e não pode virar um canal
    // para escrever texto arbitrário no log de produção.
    if (!ETAPAS_TELEMETRIA.includes(etapa as EtapaTelemetria)) return VAZIO;

    const draftId = limpar(corpo.draftId, 64);
    const provider = limpar(corpo.provider, 20);
    const detalhe = limpar(corpo.detalhe, LIMITE_DETALHE);
    const userAgent = limpar(corpo.userAgent, 200) || (req.headers.get("user-agent") || "").slice(0, 200);

    const linha =
      `[Telemetria] draftId=${draftId || "(ausente)"} provider=${provider || "(ausente)"} ` +
      `etapa=${etapa} detalhe=${detalhe || "-"} ua=${userAgent}`;

    if (ETAPAS_DE_FALHA.has(etapa)) {
      console.warn(linha);
    } else {
      console.log(linha);
    }

    // `3ds_timeout` e `submit_erro_rede` são falha terminal: o hóspede ficou
    // travado e o servidor nunca soube da tentativa. `3ds_retorno_falha` NÃO
    // entra — ela tem retry automático na tela e notificar cada uma traria de
    // volta a enxurrada que o anti-flood existe para evitar.
    if (etapa === "3ds_timeout" || etapa === "submit_erro_rede") {
      await notificarFalhaTerminal({
        draftId,
        provider: provider || "desconhecido",
        motivo: etapa === "3ds_timeout" ? "3DS sem retorno em 120s" : "erro de rede no envio da cobrança",
        detalhe,
      });
    }
  } catch {
    // Corpo malformado ou qualquer outra coisa: 204 assim mesmo.
  }
  return VAZIO;
}
