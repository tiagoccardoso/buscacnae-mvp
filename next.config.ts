import type { NextConfig } from "next";

function normalizeAllowedOrigin(value: string | undefined) {
  const trimmed = value?.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return trimmed || "";
}

function getAllowedServerActionOrigins() {
  const origins = new Set<string>(["localhost:3000", "127.0.0.1:3000", "localhost:3001", "127.0.0.1:3001"]);

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
    const origin = normalizeAllowedOrigin(value);
    if (origin) origins.add(origin);
  }

  for (const value of (process.env.NEON_AUTH_TRUSTED_ORIGINS ?? "").split(",")) {
    const origin = normalizeAllowedOrigin(value);
    if (origin) origins.add(origin);
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
