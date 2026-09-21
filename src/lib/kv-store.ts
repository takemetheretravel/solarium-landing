import { Redis } from "@upstash/redis";
import { FRAUD_STATUS_NOMES, type FraudStatusNome, type ResumoAntifraude } from "@/lib/braspag";

if (!process.env.KV_REST_API_URL && !process.env.UPSTASH_REDIS_REST_URL) {
  console.error("[kv-store] Nenhuma variável Redis configurada (KV_REST_API_URL ou UPSTASH_REDIS_REST_URL)");
}

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
    if (!url || !token) {
      throw new Error("[kv-store] Redis não configurado — defina KV_REST_API_URL e KV_REST_API_TOKEN");
    }
    _redis = new Redis({ url, token });
  }
  return _redis;
}

const DRAFT_TTL = 60 * 60 * 2; // 2 horas
/**
 * Draft em análise do antifraude. A revisão manual da Cybersource leva até 4h e
 * a reconciliação manual (A3) pode vir depois disso: com 2h o draft sumiria
 * antes da decisão, levando junto a lista de noites a desbloquear.
 */
export const DRAFT_TTL_ANALISE = 60 * 60 * 72; // 72 horas

function ttlDoDraft(draft: Pick<ReservationDraft, "status">): number {
  return draft.status === "aguardando_analise" ? DRAFT_TTL_ANALISE : DRAFT_TTL;
}

/** Noite segurada no Hostaway enquanto o pagamento está em análise. */
export type BloqueioAnalise = { listingId: number; noite: string };

/** Autorização viva à espera da decisão do antifraude. Sem dado do hóspede. */
export type AnaliseAntifraude = {
  paymentId: string;
  merchantOrderId: string;
  entrouEm: string;
  /** Em reais, como finalTotal. */
  valorAutorizado: number;
  valorAutorizadoCentavos: number;
  parcelas: number;
  /** Exatamente o que foi bloqueado — é isso que se desbloqueia depois. */
  bloqueios: BloqueioAnalise[];
  /** Tentativas de captura que falharam depois do Accept (A3). */
  tentativasCaptura?: { em: string; origem: string; statusCode: number | null; returnCode: string | null }[];
  /** Como a espera terminou (A3). */
  desfecho?: { resultado: "aceito" | "recusado"; em: string; origem: string };
};

export type ReservationDraft = {
  id: string;
  propertyId: string;
  propertyName: string;
  checkin: string;
  checkout: string;
  guests: number;
  nights: number;
  totalPrice: number;
  subtotal?: number; // valor antes do desconto (= totalPrice; alias semântico)
  pixDiscount: number;
  couponCode?: string;
  couponDiscount: number;
  discountAmount?: number; // valor descontado total (cupom + pix)
  finalTotal: number;
  paymentMethod: "pix" | "card";
  packageSlug?: string;
  packageName?: string;
  extrasTotal?: number;
  extrasList?: string[];
  shortNotice?: boolean; // pacote com check-in < 3 dias: acionar parceiros com urgência
  serviceExtras?: { id: string; label: string; qty: number; price: number }[];
  opExtras?: { type: string; label: string; price: number; blockedNight: string }[];
  // --- Pacotes V2 ---
  /** Id do pacote V2. Sua presença bloqueia cupom no recálculo server-side. */
  pacoteId?: string;
  pacoteNome?: string;
  /** Linhas de preço do pacote, já revalidadas server-side. */
  pacoteItens?: {
    extraId: string;
    nome: string;
    qtd: number;
    precoUnitario: number;
    total: number;
    entraNaBase: boolean;
    incluso: boolean;
  }[];
  /** Base sobre a qual o progressivo incidiu (Hostaway + operacionais). */
  baseDesconto?: number;
  descontoProgressivo?: number;
  bonusSaida?: number;
  /** Economia frente à contratação avulsa dos mesmos itens, em reais. */
  economiaVsAvulso?: number;
  /** Data-limite de cancelamento dos extras com reembolso integral (ISO). */
  dataLimiteCancelamentoExtras?: string;
  /** Reserva criada a partir do preview de teste. */
  reservaTeste?: boolean;
  guestFirstName: string;
  guestLastName: string;
  guestEmail: string;
  guestPhone: string;
  guestCpf: string;
  guestNotes?: string;
  /**
   * `aguardando_analise`: cartão autorizado, antifraude em Review, noites
   * seguradas. Não é pago: a confirmação e a reconciliação de Pix não tratam
   * este draft como reserva.
   */
  status: "pending" | "paid" | "failed" | "expired" | "aguardando_analise";
  analise?: AnaliseAntifraude;
  cieloPaymentId?: string;
  braspagPaymentId?: string;
  /** ProviderIdentifier do fingerprint Cybersource da última tentativa (rastreio com a Braspag). */
  fingerprintId?: string;
  hostawayReservationId?: number;
  createdAt: string;
  expiresAt: string;
};

export async function saveDraft(draft: ReservationDraft): Promise<void> {
  try {
    await getRedis().set(`draft:${draft.id}`, JSON.stringify(draft), { ex: ttlDoDraft(draft) });
  } catch (err) {
    console.error("[kv-store:saveDraft] Failed:", err);
    throw err;
  }
}

export async function getDraft(id: string): Promise<ReservationDraft | null> {
  try {
    const raw = await getRedis().get<string>(`draft:${id}`);
    if (!raw) return null;
    return typeof raw === "string" ? (JSON.parse(raw) as ReservationDraft) : (raw as unknown as ReservationDraft);
  } catch (err) {
    console.error("[kv-store:getDraft] Failed:", err);
    return null;
  }
}

// Varre todos os drafts vivos no Redis (SCAN draft:*). Como o TTL do draft é
// 2h, isso cobre com folga a janela de reconciliação de Pix pendente — não há
// draft com mais de 2h no store. Usado pelo pix-reconcile.
export async function scanAllDrafts(): Promise<ReservationDraft[]> {
  try {
    const redis = getRedis();
    const keys: string[] = [];
    let cursor = 0;
    do {
      const [next, batch] = await redis.scan(cursor, { match: "draft:*", count: 100 });
      cursor = Number(next);
      keys.push(...batch);
    } while (cursor !== 0);
    if (keys.length === 0) return [];

    const values = await redis.mget<(string | ReservationDraft | null)[]>(...keys);
    const drafts: ReservationDraft[] = [];
    for (const raw of values) {
      if (!raw) continue;
      try {
        drafts.push(typeof raw === "string" ? (JSON.parse(raw) as ReservationDraft) : (raw as ReservationDraft));
      } catch {
        // entrada corrompida: ignora
      }
    }
    return drafts;
  } catch (err) {
    console.error("[kv-store:scanAllDrafts] Failed:", err);
    return [];
  }
}

// Encontra um draft cujo braspagPaymentId == id (ignora vazio). Usado pelo
// webhook Cielo para detectar notificações que são, na verdade, de Pix Braspag
// (a URL cadastrada no portal Braspag de produção é o endpoint /webhooks/cielo).
export async function findDraftByBraspagPaymentId(id: string): Promise<ReservationDraft | null> {
  const needle = (id || "").trim();
  if (!needle) return null;
  const drafts = await scanAllDrafts();
  return drafts.find((d) => d.braspagPaymentId === needle) ?? null;
}

// ---------------------------------------------------------------------------
// Órfãos: pagamento CONFIRMADO cuja reserva no Hostaway falhou. Persistidos p/
// a reconciliação reprocessar (recriar a reserva). Chave braspag:pix-orfao:<id>.
// TTL 30 dias (bem além do TTL do draft — o pagamento já existe e não pode
// ficar sem reserva). O record carrega tudo p/ recriar sem depender do draft.
const ORPHAN_PREFIX = "braspag:pix-orfao:";
const ORPHAN_TTL = 60 * 60 * 24 * 30; // 30 dias

export async function saveOrphanReservation(paymentId: string, record: unknown): Promise<void> {
  try {
    await getRedis().set(`${ORPHAN_PREFIX}${paymentId}`, JSON.stringify(record), { ex: ORPHAN_TTL });
  } catch (err) {
    console.error("[kv-store:saveOrphanReservation] Failed:", err);
  }
}

export async function scanOrphanReservations<T = unknown>(): Promise<T[]> {
  try {
    const keys = await scanKeys(`${ORPHAN_PREFIX}*`);
    if (keys.length === 0) return [];
    const values = await getRedis().mget<(string | T | null)[]>(...keys);
    const out: T[] = [];
    for (const raw of values) {
      if (!raw) continue;
      try {
        out.push(typeof raw === "string" ? (JSON.parse(raw) as T) : (raw as T));
      } catch {
        // ignora corrompido
      }
    }
    return out;
  } catch (err) {
    console.error("[kv-store:scanOrphanReservations] Failed:", err);
    return [];
  }
}

export async function deleteOrphanReservation(paymentId: string): Promise<void> {
  try {
    await getRedis().del(`${ORPHAN_PREFIX}${paymentId}`);
  } catch (err) {
    console.error("[kv-store:deleteOrphanReservation] Failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Deduplicação de eventos de webhook (a mesma notificação chega/reprocessa 2x).
// claimWebhookEventOnce: atômico via SET NX. Retorna true se é a PRIMEIRA vez
// (deve processar); false se já visto na janela de TTL (ignorar). Em falha de
// Redis, "fail-open" (retorna true) — melhor processar que perder um pagamento.
// releaseWebhookEvent: libera a claim (chamar no catch, p/ o retry reprocessar).
const WEBHOOK_SEEN_PREFIX = "braspag:webhook-seen:";
export async function claimWebhookEventOnce(key: string, ttlSeconds = 600): Promise<boolean> {
  try {
    const res = await getRedis().set(`${WEBHOOK_SEEN_PREFIX}${key}`, "1", { nx: true, ex: ttlSeconds });
    return res !== null; // "OK" quando setou (novo); null quando já existia
  } catch (err) {
    console.error("[kv-store:claimWebhookEventOnce] Failed (fail-open):", err);
    return true;
  }
}
export async function releaseWebhookEvent(key: string): Promise<void> {
  try {
    await getRedis().del(`${WEBHOOK_SEEN_PREFIX}${key}`);
  } catch (err) {
    console.error("[kv-store:releaseWebhookEvent] Failed:", err);
  }
}

// Varredura genérica de chaves por padrão (SCAN). Usada por reconcile e authlog.
async function scanKeys(match: string): Promise<string[]> {
  const redis = getRedis();
  const keys: string[] = [];
  let cursor = 0;
  do {
    const [next, batch] = await redis.scan(cursor, { match, count: 100 });
    cursor = Number(next);
    keys.push(...batch);
  } while (cursor !== 0);
  return keys;
}

// ---------------------------------------------------------------------------
// Log de autorizações Braspag persistido no KV (diagnóstico sem depender dos
// logs da Vercel). Chave braspag:authlog:<ts>-<rand>, TTL 7 dias, máx 20 (os
// mais antigos são removidos). NUNCA gravar PAN/CVV/validade — só BIN/últimos 4.
const AUTHLOG_PREFIX = "braspag:authlog:";
const AUTHLOG_TTL = 60 * 60 * 24 * 7; // 7 dias
// Elevado para o lançamento com a flag ligada: com tráfego real, 20 entradas
// rotacionam em horas e uma recusa some antes de alguém investigar.
const AUTHLOG_MAX = 200;

export async function pushAuthLog(entry: Record<string, unknown>): Promise<void> {
  try {
    const redis = getRedis();
    const ts = Date.now();
    const key = `${AUTHLOG_PREFIX}${ts}-${Math.random().toString(36).slice(2, 8)}`;
    await redis.set(key, JSON.stringify({ ...entry, _ts: ts }), { ex: AUTHLOG_TTL });
    // Cap: mantém no máximo AUTHLOG_MAX (remove os mais antigos). O timestamp no
    // prefixo tem largura fixa (13 dígitos) → sort de string = ordem cronológica.
    const keys = await scanKeys(`${AUTHLOG_PREFIX}*`);
    if (keys.length > AUTHLOG_MAX) {
      const oldest = keys.sort().slice(0, keys.length - AUTHLOG_MAX);
      if (oldest.length) await redis.del(...oldest);
    }
  } catch (err) {
    console.error("[kv-store:pushAuthLog] Failed:", err);
  }
}

export async function readAuthLog(): Promise<Record<string, unknown>[]> {
  try {
    const redis = getRedis();
    const keys = await scanKeys(`${AUTHLOG_PREFIX}*`);
    if (keys.length === 0) return [];
    const values = await redis.mget<(string | Record<string, unknown> | null)[]>(...keys);
    const entries: Record<string, unknown>[] = [];
    for (const raw of values) {
      if (!raw) continue;
      try {
        entries.push(typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, unknown>));
      } catch {
        // ignora entrada corrompida
      }
    }
    // Mais recente primeiro.
    return entries.sort((a, b) => Number(b._ts ?? 0) - Number(a._ts ?? 0));
  } catch (err) {
    console.error("[kv-store:readAuthLog] Failed:", err);
    return [];
  }
}

export async function updateDraft(id: string, updates: Partial<ReservationDraft>): Promise<void> {
  try {
    const existing = await getDraft(id);
    if (!existing) return;
    const updated = { ...existing, ...updates };
    // TTL pelo status resultante: um draft em análise não pode voltar a 2h só
    // porque outro campo foi atualizado.
    await getRedis().set(`draft:${id}`, JSON.stringify(updated), { ex: ttlDoDraft(updated) });
  } catch (err) {
    console.error("[kv-store:updateDraft] Failed:", err);
    throw err;
  }
}


/**
 * Recupera o `draftId` a partir do `MerchantOrderId` enviado ao gateway.
 *
 * Cada TENTATIVA de pagamento leva um MerchantOrderId novo (`<draftId>-<sufixo>`)
 * para que três cartões no mesmo draft não cheguem à Braspag com o mesmo número
 * de pedido. Os webhooks continuam precisando do draft, então desfazem o sufixo
 * aqui. Formatos antigos, sem sufixo, seguem funcionando.
 */
export function draftIdDeOrderId(orderId: string): string {
  const i = (orderId || "").lastIndexOf("-");
  if (i <= 0) return orderId;
  // UUID do draft tem 36 caracteres; o sufixo de tentativa vem depois dele.
  return orderId.length > 36 ? orderId.slice(0, 36) : orderId;
}

// ---------------------------------------------------------------------------
// Observabilidade do antifraude (rodada A1). Só registra: nenhuma decisão de
// pagamento lê estas chaves.
//
// Chaves próprias, todas sob `af:`, sem tocar em draft:*, authlog ou órfãos:
//   af:contagem:<AAAA-MM-DDTHH>   hash por hora (UTC), TTL 8 dias
//     campos: status:<0..5> · webhook:<ChangeType> · void_sem_sucesso
//   af:eventos                    lista, últimos 200 resultados do antifraude
//   af:webhooks-nao-tratados      lista, últimos 100 payloads ignorados
//   af:voids-sem-sucesso          lista, últimos 100 voids não confirmados
//
// Toda escrita engole a própria falha: um Redis fora do ar não pode derrubar
// uma cobrança.
const AF_CONTAGEM_PREFIX = "af:contagem:";
const AF_CONTAGEM_TTL = 60 * 60 * 24 * 8;
const AF_LISTA_TTL = 60 * 60 * 24 * 30;
const AF_EVENTOS_KEY = "af:eventos";
const AF_WEBHOOKS_KEY = "af:webhooks-nao-tratados";
const AF_VOIDS_KEY = "af:voids-sem-sucesso";
const AF_EVENTOS_MAX = 200;
const AF_WEBHOOKS_MAX = 100;
const AF_VOIDS_MAX = 100;

function chaveContagemHora(ts: number): string {
  return `${AF_CONTAGEM_PREFIX}${new Date(ts).toISOString().slice(0, 13)}`;
}

async function registrarNaLista(chave: string, max: number, entrada: unknown, campoContagem: string, ts: number) {
  const redis = getRedis();
  const hora = chaveContagemHora(ts);
  const p = redis.pipeline();
  p.lpush(chave, JSON.stringify(entrada));
  p.ltrim(chave, 0, max - 1);
  p.expire(chave, AF_LISTA_TTL);
  p.hincrby(hora, campoContagem, 1);
  p.expire(hora, AF_CONTAGEM_TTL);
  await p.exec();
}

export type EventoAntifraude = ResumoAntifraude & { ts: string };

export async function registrarResultadoAntifraude(resumo: ResumoAntifraude, agora = Date.now()): Promise<void> {
  try {
    const evento: EventoAntifraude = { ...resumo, ts: new Date(agora).toISOString() };
    await registrarNaLista(AF_EVENTOS_KEY, AF_EVENTOS_MAX, evento, `status:${resumo.fraudStatus}`, agora);
  } catch (err) {
    console.error("[kv-store:registrarResultadoAntifraude] Failed:", err);
  }
}

export type WebhookNaoTratado = {
  ts: string;
  changeType: unknown;
  paymentId: string | null;
  motivo: string;
  corpo: unknown;
  headers: Record<string, string>;
};

/** Normaliza o ChangeType para campo de contagem (`webhook:3`, `webhook:ausente`). */
export function campoContagemWebhook(changeType: unknown): string {
  if (changeType === undefined || changeType === null || changeType === "") return "webhook:ausente";
  return `webhook:${String(changeType).trim().slice(0, 20)}`;
}

export async function registrarWebhookNaoTratado(
  entrada: Omit<WebhookNaoTratado, "ts">,
  agora = Date.now(),
): Promise<void> {
  try {
    const registro: WebhookNaoTratado = { ...entrada, ts: new Date(agora).toISOString() };
    await registrarNaLista(AF_WEBHOOKS_KEY, AF_WEBHOOKS_MAX, registro, campoContagemWebhook(entrada.changeType), agora);
  } catch (err) {
    console.error("[kv-store:registrarWebhookNaoTratado] Failed:", err);
  }
}

export type VoidSemSucesso = {
  ts: string;
  paymentId: string | null;
  merchantOrderId: string;
  contexto: "antifraude" | "captura-falhou";
  httpStatus: number | null;
  statusCode: number | null;
  returnCode: string | null;
  erro: string | null;
};

export async function registrarVoidSemSucesso(entrada: Omit<VoidSemSucesso, "ts">, agora = Date.now()): Promise<void> {
  try {
    const registro: VoidSemSucesso = { ...entrada, ts: new Date(agora).toISOString() };
    await registrarNaLista(AF_VOIDS_KEY, AF_VOIDS_MAX, registro, "void_sem_sucesso", agora);
  } catch (err) {
    console.error("[kv-store:registrarVoidSemSucesso] Failed:", err);
  }
}

export type JanelaAntifraude = {
  antifraude: Record<FraudStatusNome, number>;
  webhooksNaoTratados: Record<string, number>;
  voidsSemSucesso: number;
};

function janelaVazia(): JanelaAntifraude {
  return {
    antifraude: Object.fromEntries(FRAUD_STATUS_NOMES.map((n) => [n, 0])) as Record<FraudStatusNome, number>,
    webhooksNaoTratados: {},
    voidsSemSucesso: 0,
  };
}

function somarNaJanela(janela: JanelaAntifraude, hash: Record<string, unknown> | null) {
  if (!hash) return;
  for (const [campo, valor] of Object.entries(hash)) {
    const n = Number(valor);
    if (!Number.isFinite(n)) continue;
    if (campo.startsWith("status:")) {
      const idx = Number(campo.slice("status:".length));
      const nome = FRAUD_STATUS_NOMES[idx];
      if (nome) janela.antifraude[nome] += n;
    } else if (campo.startsWith("webhook:")) {
      const tipo = campo.slice("webhook:".length);
      janela.webhooksNaoTratados[tipo] = (janela.webhooksNaoTratados[tipo] ?? 0) + n;
    } else if (campo === "void_sem_sucesso") {
      janela.voidsSemSucesso += n;
    }
  }
}

async function lerLista(chave: string, limite: number): Promise<unknown[]> {
  const itens = await getRedis().lrange(chave, 0, limite - 1);
  const saida: unknown[] = [];
  for (const item of itens) {
    try {
      saida.push(typeof item === "string" ? JSON.parse(item) : item);
    } catch {
      // entrada corrompida: ignora
    }
  }
  return saida;
}

/**
 * Leitura para a rota admin. 24h = as 24 horas-balde mais recentes (inclui a
 * hora corrente); 7d = as 168 mais recentes.
 */
export async function lerObservabilidadeAntifraude(agora = Date.now()) {
  const redis = getRedis();
  const horas = Array.from({ length: 168 }, (_, i) => chaveContagemHora(agora - i * 3600_000));
  const p = redis.pipeline();
  for (const h of horas) p.hgetall(h);
  const hashes = (await p.exec()) as (Record<string, unknown> | null)[];

  const janela24h = janelaVazia();
  const janela7d = janelaVazia();
  hashes.forEach((hash, i) => {
    if (i < 24) somarNaJanela(janela24h, hash);
    somarNaJanela(janela7d, hash);
  });

  const [ultimosEventos, ultimosWebhooksNaoTratados, ultimosVoidsSemSucesso] = await Promise.all([
    lerLista(AF_EVENTOS_KEY, 50),
    lerLista(AF_WEBHOOKS_KEY, AF_WEBHOOKS_MAX),
    lerLista(AF_VOIDS_KEY, AF_VOIDS_MAX),
  ]);

  return { geradoEm: new Date(agora).toISOString(), janela24h, janela7d, ultimosEventos, ultimosWebhooksNaoTratados, ultimosVoidsSemSucesso };
}

// ---------------------------------------------------------------------------
// Envio único (rodada A2b). SET NX com TTL: true = esta chamada é a dona e deve
// enviar; false = alguém já enviou na janela. Em falha de Redis, fail-open
// (true): um e-mail repetido incomoda, um hóspede sem notícia do pagamento
// autorizado é pior.
export async function reservarEnvioUnico(chave: string, ttlSeconds: number): Promise<boolean> {
  try {
    const res = await getRedis().set(`envio-unico:${chave}`, new Date().toISOString(), { nx: true, ex: ttlSeconds });
    return res !== null;
  } catch (err) {
    console.error("[kv-store:reservarEnvioUnico] Failed (fail-open):", err);
    return true;
  }
}

/** Libera a trava quando o envio falhou, para a próxima chamada tentar de novo. */
export async function liberarEnvioUnico(chave: string): Promise<void> {
  try {
    await getRedis().del(`envio-unico:${chave}`);
  } catch (err) {
    console.error("[kv-store:liberarEnvioUnico] Failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Reconciliação do Review (rodada A3).
//
// Diferente do envio único, estas travas são FAIL-CLOSED: capturar duas vezes
// ou criar duas reservas é o pior defeito possível aqui. Redis fora do ar
// significa "não sei", e "não sei" não autoriza efeito colateral.

export type ResultadoTrava = "adquirida" | "ocupada" | "erro";

export async function adquirirTravaExclusiva(chave: string, ttlSeconds: number): Promise<ResultadoTrava> {
  try {
    const res = await getRedis().set(`trava:${chave}`, new Date().toISOString(), { nx: true, ex: ttlSeconds });
    return res !== null ? "adquirida" : "ocupada";
  } catch (err) {
    console.error("[kv-store:adquirirTravaExclusiva] Failed (fail-closed):", err);
    return "erro";
  }
}

export async function liberarTravaExclusiva(chave: string): Promise<void> {
  try {
    await getRedis().del(`trava:${chave}`);
  } catch (err) {
    console.error("[kv-store:liberarTravaExclusiva] Failed:", err);
  }
}

/** Valor gravado numa trava (ex.: o desfecho já aplicado), ou null. Lança em falha de Redis. */
export async function lerTravaExclusiva(chave: string): Promise<string | null> {
  const v = await getRedis().get<string>(`trava:${chave}`);
  return v === null || v === undefined ? null : String(v);
}

/** Grava um marcador definitivo (sem NX). Devolve false em falha de Redis. */
export async function gravarMarcador(chave: string, valor: string, ttlSeconds: number): Promise<boolean> {
  try {
    await getRedis().set(`trava:${chave}`, valor, { ex: ttlSeconds });
    return true;
  } catch (err) {
    console.error("[kv-store:gravarMarcador] Failed:", err);
    return false;
  }
}

/**
 * Draft em `aguardando_analise` cuja autorização é este PaymentId. Varre os
 * drafts vivos (volume de cartão baixo); não depende do MerchantOrderId nem de
 * consultar a Braspag, então serve de filtro barato antes de qualquer consulta.
 */
export async function findDraftEmAnalisePorPaymentId(paymentId: string): Promise<ReservationDraft | null> {
  const alvo = (paymentId || "").trim().toLowerCase();
  if (!alvo) return null;
  const drafts = await scanAllDrafts();
  return (
    drafts.find((d) => d.status === "aguardando_analise" && d.analise?.paymentId?.toLowerCase() === alvo) ?? null
  );
}
