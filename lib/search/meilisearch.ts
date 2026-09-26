import http from "node:http";
import https from "node:https";

/**
 * Cliente HTTP mínimo do Meilisearch (sem SDK). Usa apenas endpoints estáveis da API v1:
 * /health, /indexes, /indexes/{uid}/settings, /indexes/{uid}/documents,
 * /indexes/{uid}/documents/delete, /indexes/{uid}/search, /multi-search,
 * /swap-indexes, /tasks/{uid} e /indexes/{uid}/stats.
 *
 * Transporte: node:http(s) com keep-alive. O `fetch` do Node (undici) com keep-alive
 * sofre o atraso de ~40 ms de Nagle + ACK atrasado em respostas de busca (medido no
 * benchmark: 44 ms com fetch × 3 ms com node:http para 2 ms de processamento no servidor).
 * Nos testes, `fetchImpl` substitui o transporte.
 *
 * Falhas viram SearchEngineError tipado. Um disjuntor (circuit breaker) evita que,
 * com o mecanismo fora do ar, cada requisição do usuário espere o timeout antes do fallback.
 */

export type SearchEngineErrorKind =
  | "config"
  | "auth"
  | "timeout"
  | "unavailable"
  | "invalid_request"
  | "not_found"
  | "circuit_open"
  | "task_failed";

export class SearchEngineError extends Error {
  readonly kind: SearchEngineErrorKind;
  readonly status: number | null;
  readonly code: string | null;

  constructor(kind: SearchEngineErrorKind, message: string, options: { status?: number | null; code?: string | null } = {}) {
    super(message);
    this.name = "SearchEngineError";
    this.kind = kind;
    this.status = options.status ?? null;
    this.code = options.code ?? null;
  }
}

/**
 * Checagem estrutural (e não só `instanceof`): o módulo pode ser carregado em mais de
 * uma instância (ESM/CJS no runner de testes, scripts), e o erro continua reconhecível.
 */
export function isSearchEngineError(error: unknown): error is SearchEngineError {
  return (
    error instanceof SearchEngineError ||
    (error instanceof Error && error.name === "SearchEngineError" && typeof (error as { kind?: unknown }).kind === "string")
  );
}

type BreakerState = { failures: number; openUntil: number };
const BREAKER_THRESHOLD = 3;
const BREAKER_OPEN_MS = 30_000;
const breakers = new Map<string, BreakerState>();

function breakerFor(url: string) {
  let state = breakers.get(url);
  if (!state) {
    state = { failures: 0, openUntil: 0 };
    breakers.set(url, state);
  }
  return state;
}

/** Somente para testes. */
export function resetSearchEngineCircuitBreakers() {
  breakers.clear();
}

export type MeiliTask = {
  taskUid?: number;
  uid?: number;
  status: "enqueued" | "processing" | "succeeded" | "failed" | "canceled";
  type?: string;
  error?: { message?: string; code?: string } | null;
  duration?: string | null;
  details?: Record<string, unknown> | null;
};

export type MeiliClientOptions = {
  url: string;
  apiKey: string;
  timeoutMs?: number;
  /** Substitui o transporte (testes). */
  fetchImpl?: typeof fetch;
  now?: () => number;
};

type TransportInit = { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal };
type TransportResponse = { status: number; text: string };
type Transport = (url: string, init: TransportInit) => Promise<TransportResponse>;

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 32 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 32 });

const nodeTransport: Transport = (url, init) =>
  new Promise<TransportResponse>((resolve, reject) => {
    const target = new URL(url);
    const secure = target.protocol === "https:";
    const request = (secure ? https : http).request(
      target,
      {
        method: init.method,
        headers: { ...init.headers, ...(init.body ? { "Content-Length": String(Buffer.byteLength(init.body)) } : {}) },
        agent: secure ? httpsAgent : httpAgent,
        signal: init.signal
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
        response.on("error", reject);
      }
    );
    request.setNoDelay(true);
    request.on("error", reject);
    request.end(init.body);
  });

function fetchTransport(fetchImpl: typeof fetch): Transport {
  return async (url, init) => {
    const response = await fetchImpl(url, { ...init, cache: "no-store" });
    return { status: response.status, text: await response.text().catch(() => "") };
  };
}

export type MeiliClient = ReturnType<typeof createMeiliClient>;

export function createMeiliClient(options: MeiliClientOptions) {
  const baseUrl = options.url.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 800;
  const transport = options.fetchImpl ? fetchTransport(options.fetchImpl) : nodeTransport;
  const now = options.now ?? Date.now;
  if (!baseUrl) throw new SearchEngineError("config", "MEILISEARCH_URL não configurada.");

  async function request<T>(
    path: string,
    init: { method?: string; body?: unknown; timeoutMs?: number; signal?: AbortSignal | null } = {}
  ): Promise<T> {
    const breaker = breakerFor(baseUrl);
    if (breaker.openUntil > now()) {
      throw new SearchEngineError("circuit_open", "Mecanismo de busca temporariamente desativado após falhas consecutivas.");
    }

    const controller = new AbortController();
    const effectiveTimeout = init.timeoutMs ?? timeoutMs;
    const timer = setTimeout(() => controller.abort(), effectiveTimeout);
    const onAbort = () => controller.abort();
    init.signal?.addEventListener("abort", onAbort, { once: true });

    let response: TransportResponse;
    try {
      response = await transport(`${baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers: {
          "Content-Type": "application/json",
          ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {})
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal
      });
    } catch (error) {
      const timedOut = controller.signal.aborted && !init.signal?.aborted;
      recordFailure(breaker);
      throw new SearchEngineError(
        timedOut ? "timeout" : "unavailable",
        timedOut ? `Mecanismo de busca não respondeu em ${effectiveTimeout} ms.` : "Mecanismo de busca indisponível.",
        { code: error instanceof Error ? error.name : null }
      );
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", onAbort);
    }

    let payload: unknown = null;
    if (response.text) {
      try {
        payload = JSON.parse(response.text);
      } catch {
        payload = null;
      }
    }

    if (response.status < 200 || response.status >= 300) {
      const record = (payload && typeof payload === "object" ? payload : {}) as { message?: string; code?: string };
      const status = response.status;
      if (status >= 500) recordFailure(breaker);
      const kind: SearchEngineErrorKind =
        status === 401 || status === 403
          ? "auth"
          : status === 404
            ? "not_found"
            : status >= 500
              ? "unavailable"
              : "invalid_request";
      throw new SearchEngineError(kind, record.message || `Mecanismo de busca respondeu HTTP ${status}.`, {
        status,
        code: record.code ?? null
      });
    }

    breaker.failures = 0;
    breaker.openUntil = 0;
    return payload as T;
  }

  function recordFailure(breaker: BreakerState) {
    breaker.failures += 1;
    if (breaker.failures >= BREAKER_THRESHOLD) {
      breaker.openUntil = now() + BREAKER_OPEN_MS;
      breaker.failures = 0;
    }
  }

  async function waitForTask(taskUid: number, waitOptions: { timeoutMs?: number; intervalMs?: number } = {}) {
    const deadline = now() + (waitOptions.timeoutMs ?? 60_000);
    let interval = waitOptions.intervalMs ?? 50;
    for (;;) {
      const task = await request<MeiliTask>(`/tasks/${taskUid}`, { timeoutMs: 5_000 });
      if (task.status === "succeeded") return task;
      if (task.status === "failed" || task.status === "canceled") {
        throw new SearchEngineError("task_failed", task.error?.message || `Tarefa ${taskUid} falhou no mecanismo de busca.`, {
          code: task.error?.code ?? null
        });
      }
      if (now() > deadline) throw new SearchEngineError("timeout", `Tarefa ${taskUid} não terminou no prazo.`);
      await new Promise((resolve) => setTimeout(resolve, interval));
      interval = Math.min(interval * 2, 1_000);
    }
  }

  async function enqueue(path: string, method: string, body?: unknown) {
    const task = await request<MeiliTask>(path, { method, body, timeoutMs: Math.max(timeoutMs, 30_000) });
    const uid = task.taskUid ?? task.uid;
    if (typeof uid !== "number") throw new SearchEngineError("invalid_request", "Resposta sem identificador de tarefa.");
    return uid;
  }

  return {
    baseUrl,
    request,
    enqueue,
    waitForTask,
    async health() {
      return request<{ status: string }>("/health", { timeoutMs: Math.min(timeoutMs, 2_000) });
    }
  };
}
