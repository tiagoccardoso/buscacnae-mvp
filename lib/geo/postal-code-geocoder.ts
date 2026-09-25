import { createDbClient } from "@/lib/db-client";
import { getMapGeocodingConfig } from "@/lib/env";
import { isFiniteCoordinate, isWithinBrazil, parseCoordinate } from "@/lib/map/geo";

/**
 * Geocodificação CONTROLADA de CEP (somente servidor).
 *
 * - Geocodifica CEPs (poucos por busca), nunca empresa a empresa.
 * - Desligada por padrão: MAP_GEOCODING_PROVIDER=none. Com "brasilapi" usa o
 *   endpoint público e gratuito https://brasilapi.com.br/api/cep/v2/{cep}.
 * - No máximo MAP_GEOCODING_MAX_LOOKUPS consultas novas por requisição, com
 *   concorrência baixa, timeout curto e orçamento total de tempo.
 * - Todo resultado (inclusive "não encontrado") é gravado na tabela
 *   postal_code_locations e em cache de memória: o mesmo CEP não é consultado de novo.
 * - Falhas nunca impedem o mapa: a empresa cai para a sede do município.
 */
export type PostalCodePoint = { latitude: number; longitude: number };

export type PostalCodeGeocoder = {
  id: string;
  geocode(cep: string, signal: AbortSignal): Promise<PostalCodePoint | null>;
};

type CacheEntry = { point: PostalCodePoint | null; expiresAt: number };

const MEMORY_TTL_MS = 6 * 60 * 60 * 1000;
const MEMORY_MAX_ENTRIES = 20_000;
const NOT_FOUND_RETRY_DAYS = 30;
const memoryCache = new Map<string, CacheEntry>();

function rememberInMemory(cep: string, point: PostalCodePoint | null) {
  if (memoryCache.size >= MEMORY_MAX_ENTRIES) {
    const oldest = memoryCache.keys().next().value;
    if (oldest !== undefined) memoryCache.delete(oldest);
  }
  memoryCache.set(cep, { point, expiresAt: Date.now() + MEMORY_TTL_MS });
}

function readMemory(cep: string): CacheEntry | null {
  const entry = memoryCache.get(cep);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryCache.delete(cep);
    return null;
  }
  return entry;
}

export const brasilApiGeocoder: PostalCodeGeocoder = {
  id: "brasilapi",
  async geocode(cep, signal) {
    const response = await fetch(`https://brasilapi.com.br/api/cep/v2/${cep}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`geocoder_http_${response.status}`);
    const body = (await response.json()) as { location?: { coordinates?: { latitude?: unknown; longitude?: unknown } } };
    const latitude = parseCoordinate(body.location?.coordinates?.latitude);
    const longitude = parseCoordinate(body.location?.coordinates?.longitude);
    if (latitude === null || longitude === null) return null;
    if (!isFiniteCoordinate(latitude, longitude) || !isWithinBrazil(latitude, longitude)) return null;
    return { latitude, longitude };
  }
};

export function resolvePostalCodeGeocoder(providerId: string): PostalCodeGeocoder | null {
  if (providerId === "brasilapi") return brasilApiGeocoder;
  return null;
}

/** Lê o cache persistente. Se a tabela não existir, segue apenas com memória. */
async function readPersistentCache(ceps: string[]) {
  const found = new Map<string, PostalCodePoint | null>();
  if (ceps.length === 0) return found;
  try {
    const db = createDbClient();
    const { data, error } = await db
      .from("postal_code_locations")
      .select("cep, latitude, longitude, status, fetched_at")
      .in("cep", ceps);
    if (error || !data) return found;

    const retryBefore = Date.now() - NOT_FOUND_RETRY_DAYS * 24 * 60 * 60 * 1000;
    for (const row of data as Array<Record<string, unknown>>) {
      const cep = String(row.cep ?? "");
      if (row.status === "found") {
        const latitude = parseCoordinate(row.latitude);
        const longitude = parseCoordinate(row.longitude);
        if (latitude !== null && longitude !== null) found.set(cep, { latitude, longitude });
      } else {
        const fetchedAt = Date.parse(String(row.fetched_at ?? ""));
        if (Number.isFinite(fetchedAt) && fetchedAt > retryBefore) found.set(cep, null);
      }
    }
  } catch {
    // Tabela ausente ou banco indisponível: o mapa continua com fallback por município.
  }
  return found;
}

async function writePersistentCache(rows: Array<{ cep: string; point: PostalCodePoint | null; source: string }>) {
  if (rows.length === 0) return;
  try {
    const db = createDbClient();
    await db.from("postal_code_locations").upsert(
      rows.map((row) => ({
        cep: row.cep,
        latitude: row.point?.latitude ?? null,
        longitude: row.point?.longitude ?? null,
        status: row.point ? "found" : "not_found",
        source: row.source,
        fetched_at: new Date().toISOString()
      })),
      { onConflict: "cep" }
    );
  } catch {
    // Cache é otimização; nunca derruba a requisição.
  }
}

export type PostalCodeResolution = {
  points: Map<string, PostalCodePoint>;
  /** CEPs ainda sem coordenada que poderão ser resolvidos em próximas aberturas. */
  pending: number;
  enabled: boolean;
};

export async function resolvePostalCodes(
  ceps: string[],
  options: {
    geocoder?: PostalCodeGeocoder | null;
    maxLookups?: number;
    concurrency?: number;
    timeoutMs?: number;
    budgetMs?: number;
    readCache?: typeof readPersistentCache;
    writeCache?: typeof writePersistentCache;
  } = {}
): Promise<PostalCodeResolution> {
  const config = getMapGeocodingConfig();
  const geocoder = options.geocoder === undefined ? resolvePostalCodeGeocoder(config.provider) : options.geocoder;
  const maxLookups = Math.max(0, options.maxLookups ?? config.maxLookups);
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const timeoutMs = options.timeoutMs ?? 3500;
  const budgetMs = options.budgetMs ?? 6000;
  const readCache = options.readCache ?? readPersistentCache;
  const writeCache = options.writeCache ?? writePersistentCache;

  const unique = Array.from(new Set(ceps.filter((cep) => /^\d{8}$/.test(cep))));
  const points = new Map<string, PostalCodePoint>();
  const unresolved: string[] = [];

  for (const cep of unique) {
    const cached = readMemory(cep);
    if (cached) {
      if (cached.point) points.set(cep, cached.point);
    } else {
      unresolved.push(cep);
    }
  }

  const persistent = await readCache(unresolved);
  const toLookup: string[] = [];
  for (const cep of unresolved) {
    if (persistent.has(cep)) {
      const point = persistent.get(cep) ?? null;
      rememberInMemory(cep, point);
      if (point) points.set(cep, point);
    } else {
      toLookup.push(cep);
    }
  }

  if (!geocoder || maxLookups === 0 || toLookup.length === 0) {
    return { points, pending: toLookup.length, enabled: Boolean(geocoder) };
  }

  const batch = toLookup.slice(0, maxLookups);
  const deadline = Date.now() + budgetMs;
  const written: Array<{ cep: string; point: PostalCodePoint | null; source: string }> = [];
  let cursor = 0;
  let halted = false;

  async function worker() {
    while (cursor < batch.length && !halted && Date.now() < deadline) {
      const cep = batch[cursor];
      cursor += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, Math.max(250, deadline - Date.now())));
      try {
        const point = await geocoder!.geocode(cep, controller.signal);
        rememberInMemory(cep, point);
        written.push({ cep, point, source: geocoder!.id });
        if (point) points.set(cep, point);
      } catch (error) {
        // 429/5xx: interrompe o lote (circuit breaker) para não insistir no serviço.
        if (error instanceof Error && /geocoder_http_(429|5\d\d)/.test(error.message)) halted = true;
      } finally {
        clearTimeout(timer);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, batch.length) }, () => worker()));
  await writeCache(written);

  const resolvedNow = new Set(written.map((item) => item.cep));
  return { points, pending: toLookup.filter((cep) => !resolvedNow.has(cep)).length, enabled: true };
}

/** Apenas para testes. */
export function __resetPostalCodeMemoryCache() {
  memoryCache.clear();
}
