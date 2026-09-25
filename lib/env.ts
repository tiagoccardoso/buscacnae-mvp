import { DiscoveryProvider } from "@/lib/types";

function getEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function requireEnv(name: string): string {
  const value = getEnv(name);
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

export function getAppName() {
  return getEnv("NEXT_PUBLIC_APP_NAME") || "BuscaCNAE";
}

export function getPublicContactEmail() {
  return getEnv("NEXT_PUBLIC_CONTACT_EMAIL") || "contato@buscacnae.com.br";
}

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function getBaseUrl() {
  const explicit = normalizeUrl(getEnv("NEXT_PUBLIC_SITE_URL"));
  if (explicit) return explicit;

  const vercelUrl = normalizeUrl(getEnv("VERCEL_URL"));
  if (vercelUrl) {
    return vercelUrl;
  }

  return "http://localhost:3000";
}


export function getStripeSecretKey() {
  return requireEnv("STRIPE_SECRET_KEY");
}

export function getStripeWebhookSecret() {
  return requireEnv("STRIPE_WEBHOOK_SECRET");
}

export function getStripePriceIds() {
  return {
    monthly: getEnv("STRIPE_PRICE_PRO_MONTHLY"),
    annual: getEnv("STRIPE_PRICE_PRO_ANNUAL")
  };
}

export function getStripeUrls() {
  return {
    success: getEnv("STRIPE_SUCCESS_URL") || `${getBaseUrl()}/dashboard?checkout=success`,
    cancel: getEnv("STRIPE_CANCEL_URL") || `${getBaseUrl()}/pricing?checkout=cancelled`
  };
}

export function getDiscoveryProvider(): DiscoveryProvider {
  return "casadosdados";
}

/** Server-side apenas: nunca exponha em componentes client. */
export function getCasaDosDadosKey() {
  return requireEnv("CASA_DOS_DADOS_API_KEY");
}

export function getCasaDosDadosTimeoutMs() {
  const value = Number(getEnv("CASA_DOS_DADOS_TIMEOUT_MS") || "15000");
  return Number.isFinite(value) && value >= 1000 ? Math.min(Math.trunc(value), 60000) : 15000;
}

export function getDiscoveryCacheTtlHours() {
  return Number(getEnv("DISCOVERY_CACHE_TTL_HOURS") || "24");
}

export function getDiscoveryMaxResults() {
  return Number(getEnv("DISCOVERY_MAX_RESULTS") || "0");
}

export function getDiscoveryPageSize() {
  return Number(getEnv("DISCOVERY_PAGE_SIZE") || "50");
}

export function getDiscoveryAutoRefinementThreshold() {
  return Number(getEnv("DISCOVERY_AUTO_REFINEMENT_THRESHOLD") || "1500");
}

export function isBillingBypassed() {
  return getEnv("BYPASS_BILLING").toLowerCase() === "true";
}

export function getMinimumCheckoutAmountCents() {
  return Number(getEnv("MINIMUM_CHECKOUT_AMOUNT_CENTS") || "50");
}

export function getAiFormattingPriceCents() {
  // Deprecated: mantenha apenas para compatibilidade retroativa.
  // A regra principal do upgrade com IA agora está em lib/ai-format-pricing.ts.
  return Number(getEnv("AI_FORMATTING_PRICE_CENTS") || "1000");
}

export function getSplineSceneUrl() {
  return getEnv("NEXT_PUBLIC_SPLINE_SCENE_URL");
}

export function getOpenAiApiKey() {
  return getEnv("OPENAI_API_KEY");
}

export function getOpenAiModel() {
  return getEnv("OPENAI_MODEL") || "gpt-4.1-mini";
}

/* ---------------------------------------------------------------------------
   Mapa Empresarial (ver docs/MAPA_EMPRESARIAL.md)
   --------------------------------------------------------------------------- */

function readBoundedInt(name: string, fallback: number, min: number, max: number) {
  const value = Number(getEnv(name) || String(fallback));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Server-side apenas. Geocodificação de CEP desligada por padrão ("none"). */
export function getMapGeocodingConfig() {
  const provider = getEnv("MAP_GEOCODING_PROVIDER").toLowerCase();
  return {
    provider: provider === "brasilapi" ? "brasilapi" : "none",
    maxLookups: readBoundedInt("MAP_GEOCODING_MAX_LOOKUPS", 25, 0, 200)
  };
}

/** Teto de marcadores enviados ao navegador por busca. */
export function getMapMaxMarkers() {
  return readBoundedInt("MAP_MAX_MARKERS", 5000, 100, 20000);
}

/** Máximo de municípios convertidos a partir da área visível em "Buscar nesta área". */
export function getMapAreaSearchMaxCities() {
  return readBoundedInt("MAP_AREA_SEARCH_MAX_CITIES", 12, 1, 40);
}

export type MapBasemapId = "osm" | "carto-light" | "carto-dark" | "ion" | "offline";

/**
 * Configuração PÚBLICA do mapa (enviada ao navegador). Somente valores que podem
 * ser expostos: o token do Cesium ion e a chave do Google Map Tiles são chaves de
 * navegador e devem ser restritas por domínio no painel de cada fornecedor.
 */
export function getPublicMapConfig() {
  const basemap = getEnv("NEXT_PUBLIC_MAP_BASEMAP").toLowerCase();
  const allowed: MapBasemapId[] = ["osm", "carto-light", "carto-dark", "ion", "offline"];
  return {
    basemap: (allowed.includes(basemap as MapBasemapId) ? basemap : "osm") as MapBasemapId,
    cesiumIonToken: getEnv("NEXT_PUBLIC_CESIUM_ION_TOKEN"),
    googleMapTilesKey: getEnv("NEXT_PUBLIC_GOOGLE_MAP_TILES_KEY")
  };
}
