import { DiscoveryProvider } from "@/lib/types";
import { BASEMAP_IDS, sanitizeStyleUrl, type BasemapId, type PublicMapConfig } from "@/lib/map/config";

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

/**
 * Janela (horas) em que uma consulta detalhada da Casa dos Dados já salva em
 * establishments é reaproveitada pela pesquisa, sem nova chamada GET /v4/cnpj.
 * 0 desliga o reuso. Padrão: 168h (7 dias).
 */
export function getDiscoveryDetailReuseHours() {
  const raw = getEnv("DISCOVERY_DETAIL_REUSE_HOURS");
  const value = Number(raw === "" ? "168" : raw);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 24 * 90) : 0;
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

/**
 * Server-side apenas. Diretório de CEP usado SOMENTE como complemento territorial
 * (lib/geo/postal-code-directory.ts). Desligado por padrão ("none").
 */
export function getPostalDirectoryConfig() {
  const provider = getEnv("LOCATION_POSTAL_DIRECTORY").toLowerCase();
  return {
    provider: provider === "opencep" ? "opencep" : "none",
    maxLookups: readBoundedInt("LOCATION_POSTAL_DIRECTORY_MAX_LOOKUPS", 20, 0, 200)
  };
}

/** Teto de marcadores enviados ao navegador por busca. */
export function getMapMaxMarkers() {
  return readBoundedInt("MAP_MAX_MARKERS", 10000, 100, 50000);
}

/**
 * Teto do UNIVERSO ANALISADO por busca (Lista, Mapa e Inteligência usam o mesmo).
 * ANALYSIS_MAX_COMPANIES; se vazio, herda MAP_MAX_MARKERS (compatível com a Fase 2).
 */
export function getAnalysisMaxCompanies() {
  if (getEnv("ANALYSIS_MAX_COMPANIES")) return readBoundedInt("ANALYSIS_MAX_COMPANIES", 10000, 100, 50000);
  return getMapMaxMarkers();
}

/** Máximo de municípios convertidos a partir da área visível em "Buscar nesta área". */
export function getMapAreaSearchMaxCities() {
  return readBoundedInt("MAP_AREA_SEARCH_MAX_CITIES", 12, 1, 40);
}

/**
 * Configuração PÚBLICA do mapa (enviada ao navegador). Somente valores que podem
 * ser expostos: o token do Cesium ion e a chave do Google Map Tiles são chaves de
 * navegador e devem ser restritas por domínio no painel de cada fornecedor.
 */
export function getPublicMapConfig(): PublicMapConfig {
  const basemap = getEnv("NEXT_PUBLIC_MAP_BASEMAP").toLowerCase();
  return {
    basemap: (BASEMAP_IDS as readonly string[]).includes(basemap) ? (basemap as BasemapId) : "osm",
    styleUrl: sanitizeStyleUrl(getEnv("NEXT_PUBLIC_MAP_STYLE_URL")),
    cesiumIonToken: getEnv("NEXT_PUBLIC_CESIUM_ION_TOKEN"),
    googleMapTilesKey: getEnv("NEXT_PUBLIC_GOOGLE_MAP_TILES_KEY")
  };
}

/* ---------------------------------------------------------------------------
   IA Empresarial — "Pergunte ao BuscaCNAE" (ver docs/IA_EMPRESARIAL.md)
   --------------------------------------------------------------------------- */

/**
 * Planejador das perguntas: "openai" (padrão quando OPENAI_API_KEY existe) ou "rules"
 * (intérprete determinístico em pt-BR, sem rede). O motor de dados é o mesmo nos dois.
 */
export function getAiAssistantProvider(): "openai" | "rules" {
  const value = getEnv("AI_ASSISTANT_PROVIDER").toLowerCase();
  if (value === "rules") return "rules";
  return getOpenAiApiKey() ? "openai" : "rules";
}

export function getAiAssistantModel() {
  return getEnv("AI_ASSISTANT_MODEL") || getOpenAiModel();
}

/** Tempo máximo de cada chamada ao modelo (ms). Estourou → intérprete por regras. */
export function getAiAssistantTimeoutMs() {
  return readBoundedInt("AI_ASSISTANT_TIMEOUT_MS", 12000, 2000, 30000);
}

/** Interpretação em linguagem natural (2ª chamada ao modelo). "0" desliga. */
export function isAiInterpretationEnabled() {
  return getEnv("AI_ASSISTANT_INTERPRETATION") !== "0";
}

/** Perguntas por usuário a cada 10 minutos. */
export function getAiAssistantRateLimit() {
  return readBoundedInt("AI_ASSISTANT_RATE_LIMIT", 30, 1, 1000);
}
