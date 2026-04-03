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

export function getSupabaseUrl() {
  return requireEnv("NEXT_PUBLIC_SUPABASE_URL");
}

export function getSupabasePublishableKey() {
  return requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
}

export function getSupabaseServiceRoleKey() {
  return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
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
  const provider = getEnv("DISCOVERY_PROVIDER").toLowerCase();
  if (provider === "casadosdados" || provider === "cnpjws" || provider === "hybrid") {
    return provider;
  }
  return "hybrid";
}

export function getProviderLabel(provider: DiscoveryProvider) {
  if (provider === "hybrid") return "Casa dos Dados + CNPJ.ws";
  return provider === "casadosdados" ? "Casa dos Dados" : "CNPJ.ws";
}

export function getCnpjWsToken() {
  return requireEnv("CNPJWS_API_TOKEN");
}

export function getCasaDosDadosKey() {
  return requireEnv("CASA_DOS_DADOS_API_KEY");
}

export function getDiscoveryCacheTtlHours() {
  return Number(getEnv("DISCOVERY_CACHE_TTL_HOURS") || "24");
}

export function getDiscoveryMaxResults() {
  return Number(getEnv("DISCOVERY_MAX_RESULTS") || "50");
}

export function isBillingBypassed() {
  return getEnv("BYPASS_BILLING").toLowerCase() === "true";
}

export function getMinimumCheckoutAmountCents() {
  return Number(getEnv("MINIMUM_CHECKOUT_AMOUNT_CENTS") || "50");
}

export function getAiFormattingPriceCents() {
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
