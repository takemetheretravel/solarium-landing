import { waitUntil } from "@vercel/functions";
import {
  removerFinalizacaoHostaway,
  registrarFalhaFinalizacao,
  type FinalizacaoHostaway,
} from "@/lib/kv-store";
import { listarCobrancasHostaway, registrarPagamentoHostaway } from "@/lib/hostaway";

/**
 * Camada 1 da finalização: tentativa IMEDIATA, em segundo plano.
 *
 * O cron sozinho não resolve o problema real. O hóspede abre o portal minutos
 * depois de reservar e vê "não pago" — mesmo um cron de 5 minutos deixaria essa
 * janela aberta. Aqui a marcação é tentada em 10s, 30s e 60s, tempo que cobre o
 * lag normal da Hostaway, **sem segurar a resposta ao hóspede**: `waitUntil`
 * mantém a função viva depois que a resposta já saiu. (`after()` do Next só
 * existe da versão 15 em diante; aqui é o `waitUntil` da Vercel.)
 *
 * A fila (camada 2) continua sendo a rede de segurança. Se estas tentativas
 * falharem, ou se a função for encerrada antes delas terminarem, a entrada
 * segue na fila e o cron pega. Por isso nada aqui é crítico: desistir em
 * silêncio é um desfecho aceitável.
 */

/** 10s, 30s, 60s. Somados, cabem no limite de duração da função. */
const ESPERAS_MS = [10_000, 30_000, 60_000];

/** Margem para não ser cortado no meio de uma chamada HTTP. */
const ORCAMENTO_TOTAL_MS = 90_000;

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Uma tentativa. `true` = marcado (ou já existia). `false` = tenta de novo.
 *
 * A idempotência é a mesma do cron: consulta antes de registrar, e se a
 * consulta falhar NÃO registra — cobrança duplicada na contabilidade exige
 * estorno e conversa com o hóspede; marcação pendente só espera.
 */
async function tentarUmaVez(item: {
  reservation_id: number;
  amount: number;
  currency: string;
  payment_method: FinalizacaoHostaway["payment_method"];
}): Promise<boolean> {
  const existentes = await listarCobrancasHostaway(item.reservation_id);
  if (existentes === null) return false; // consulta falhou: não registra às cegas

  const jaTem = existentes.some(
    (c) => typeof c.amount === "number" && Math.abs(c.amount - item.amount) < 0.01,
  );
  if (jaTem) {
    await removerFinalizacaoHostaway(item.reservation_id);
    console.log(
      `[Hostaway:imediato] cobrança já existe reservation_id=${item.reservation_id} — fila liberada`,
    );
    return true;
  }

  const r = await registrarPagamentoHostaway({
    reservationId: item.reservation_id,
    amount: item.amount,
    currency: item.currency,
    paymentMethod: item.payment_method,
  });
  if (r.ok) {
    await removerFinalizacaoHostaway(item.reservation_id);
    console.log(`[Hostaway:imediato] marcada como paga reservation_id=${item.reservation_id}`);
    return true;
  }
  await registrarFalhaFinalizacao(item.reservation_id, r.erro || `HTTP ${r.status}`);
  return false;
}

/**
 * Agenda as tentativas para depois da resposta. Retorna na hora — o hóspede
 * nunca espera por isto.
 *
 * Chamar SEMPRE depois de `enfileirarFinalizacaoHostaway`: a fila é o registro
 * durável, isto é só a aceleração.
 */
export function finalizarPagamentoEmSegundoPlano(item: {
  reservation_id: number;
  amount: number;
  currency?: string;
  payment_method: FinalizacaoHostaway["payment_method"];
}): void {
  if (!item.reservation_id || item.reservation_id <= 0) return;

  const dados = {
    reservation_id: item.reservation_id,
    amount: item.amount,
    currency: item.currency || "BRL",
    payment_method: item.payment_method,
  };

  try {
    waitUntil(
      (async () => {
        const inicio = Date.now();
        for (const espera of ESPERAS_MS) {
          // Estourou o orçamento: para aqui. A fila cobre o resto — insistir
          // arriscaria ser cortado no meio de um POST de cobrança.
          if (Date.now() - inicio + espera > ORCAMENTO_TOTAL_MS) {
            console.log(
              `[Hostaway:imediato] orçamento esgotado reservation_id=${dados.reservation_id} — fila assume`,
            );
            return;
          }
          await dormir(espera);
          try {
            if (await tentarUmaVez(dados)) return;
          } catch (err) {
            // Nunca propaga: isto roda fora do ciclo da resposta.
            console.log(
              `[Hostaway:imediato] tentativa falhou reservation_id=${dados.reservation_id}: ${(err as Error)?.message}`,
            );
          }
        }
        console.log(
          `[Hostaway:imediato] 3 tentativas sem sucesso reservation_id=${dados.reservation_id} — fila assume`,
        );
      })(),
    );
  } catch (err) {
    // `waitUntil` indisponível no runtime: a fila continua valendo.
    console.log(
      `[Hostaway:imediato] agendamento indisponível reservation_id=${dados.reservation_id}: ${(err as Error)?.message}`,
    );
  }
}
