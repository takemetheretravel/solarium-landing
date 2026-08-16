import type { ReservationDraft } from "@/lib/kv-store";
import { getExtra } from "@/config/precos-e-extras";

/**
 * Campos de pacote que a reserva Hostaway precisa carregar.
 *
 * Existiam no draft e não chegavam à reserva: as duas primeiras reservas de teste
 * saíram com `hostNote` só de "Subtotal | Pagamento | Valor cobrado", `guestNote`
 * vazio e nenhum registro do pacote. A equipe não tinha como saber o que preparar.
 */
export function paramsDePacote(draft: ReservationDraft): {
  pacoteNome?: string;
  pacoteItens?: { extraId: string; nome: string; qtd: number; total: number; incluso: boolean }[];
  dataLimiteCancelamentoExtras?: string;
  subtotalPacote?: number;
  descontoPacote?: number;
} {
  if (!draft.pacoteId) return {};

  return {
    pacoteNome: draft.pacoteNome,
    pacoteItens: (draft.pacoteItens ?? []).map((i) => ({
      extraId: i.extraId,
      nome: i.nome,
      qtd: i.qtd,
      total: i.total,
      incluso: i.incluso,
    })),
    dataLimiteCancelamentoExtras: draft.dataLimiteCancelamentoExtras,
    subtotalPacote: draft.subtotal,
    descontoPacote: draft.discountAmount,
  };
}

/**
 * Bloco `EXTRAS A PROVIDENCIAR` do alerta interno: item, quantidade, data de
 * entrega e prazo do fornecedor.
 *
 * A data de entrega das cestas é a primeira manhã completa; os demais itens ficam
 * prontos no check-in. Um extra pago que a equipe não enxerga é pior que um extra
 * não vendido.
 */
export function extrasProvidenciar(draft: ReservationDraft): {
  nome: string;
  qtd: number;
  dataEntrega?: string;
  prazoFornecedorDias?: number;
  nota?: string;
}[] {
  const itens: ReturnType<typeof extrasProvidenciar> = [];

  for (const i of draft.pacoteItens ?? []) {
    const cfg = getExtra(i.extraId);
    // Operacionais não são "providenciar": viram bloqueio de calendário.
    if (cfg?.entraNaBase) continue;
    itens.push({
      nome: i.nome,
      qtd: i.qtd,
      dataEntrega: dataDeEntrega(i.extraId, draft.checkin),
      prazoFornecedorDias: cfg?.prazoFornecedorDias,
      nota: cfg?.notaInterna,
    });
  }

  for (const e of draft.serviceExtras ?? []) {
    const cfg = getExtra(e.id);
    itens.push({
      nome: e.label,
      qtd: e.qty,
      dataEntrega: dataDeEntrega(e.id, draft.checkin),
      prazoFornecedorDias: cfg?.prazoFornecedorDias,
      nota: cfg?.notaInterna,
    });
  }

  return itens;
}

/** Cesta é servida na primeira manhã completa; o resto fica pronto na chegada. */
function dataDeEntrega(extraId: string, checkin: string): string {
  if (!extraId.startsWith("cesta_")) return checkin;
  const d = new Date(checkin + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
