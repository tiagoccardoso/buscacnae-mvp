import type { NextConfig } from "next";

function normalizeAllowedOrigin(value: string | undefined) {
  const trimmed = value?.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return trimmed || "";
}

function addOriginWithWwwVariant(origins: Set<string>, value: string | undefined) {
  const origin = normalizeAllowedOrigin(value);
  if (!origin) return;

  origins.add(origin);

  if (origin.startsWith("www.")) {
    origins.add(origin.replace(/^www\./, ""));
  } else if (!origin.endsWith(".vercel.app") && !origin.startsWith("localhost") && !origin.startsWith("127.0.0.1")) {
    origins.add(`www.${origin}`);
  }
}

function getAllowedServerActionOrigins() {
  const origins = new Set<string>(["localhost:3000", "127.0.0.1:3000", "localhost:3001", "127.0.0.1:3001"]);

  addOriginWithWwwVariant(origins, "www.buscacnae.com.br");
  addOriginWithWwwVariant(origins, "buscacnae.com.br");

  for (const value of [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_BASE_URL,
    process.env.SITE_URL,
    process.env.APP_URL,
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
  ]) {
    addOriginWithWwwVariant(origins, value);
  }

  origins.add("*.vercel.app");

  return Array.from(origins);
}

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    serverActions: {
      allowedOrigins: getAllowedServerActionOrigins()
    }
  }
};

export default nextConfig;
