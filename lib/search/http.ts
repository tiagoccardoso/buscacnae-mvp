import type { CompanySearchFilters } from "@/lib/search/company-index";
import { normalizeCnaeCode } from "@/lib/cnae-utils";
import { BRAZILIAN_UFS } from "@/lib/data-quality/normalize";

export const SEARCH_NO_STORE = { "Cache-Control": "no-store" } as const;

function list(params: URLSearchParams, name: string, max = 20) {
  return Array.from(
    new Set(
      params
        .getAll(name)
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ).slice(0, max);
}

/** Lê filtros da URL com validação estrita (valores fora do formato são descartados). */
export function parseCompanySearchParams(params: URLSearchParams) {
  const q = (params.get("q") ?? "").slice(0, 200);
  const filters: CompanySearchFilters = {
    stateCodes: list(params, "uf").map((value) => value.toUpperCase()).filter((value) => BRAZILIAN_UFS.has(value)),
    cityIbges: list(params, "cityIbge").filter((value) => /^\d{7}$/.test(value)),
    cities: list(params, "city", 5).map((value) => value.slice(0, 80)),
    primaryCnaes: list(params, "cnae").map(normalizeCnaeCode).filter((value) => /^\d{7}$/.test(value)),
    registrationStatuses: list(params, "status", 5).map((value) => value.toUpperCase()).filter((value) => /^[A-Z ]{3,20}$/.test(value)),
    companySizes: list(params, "size", 5).filter((value) => /^[A-Za-z ]{2,30}$/.test(value)),
    headquarters: params.get("hq") === "matriz" || params.get("hq") === "filial" ? (params.get("hq") as "matriz" | "filial") : null
  };
  const limit = Math.min(Math.max(Number(params.get("limit") ?? "20") || 20, 1), 50);
  const page = Math.min(Math.max(Number(params.get("page") ?? "1") || 1, 1), 50);
  return { q, filters, limit, offset: (page - 1) * limit, facets: params.get("facets") === "1" };
}

/** Autorização da rotina de sincronização (cron da Vercel envia Authorization: Bearer <CRON_SECRET>). */
export function isAuthorizedSyncRequest(request: Request, secret: string) {
  if (!secret || secret.length < 16) return false;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token.length !== secret.length) return false;
  let diff = 0;
  for (let index = 0; index < secret.length; index += 1) diff |= token.charCodeAt(index) ^ secret.charCodeAt(index);
  return diff === 0;
}
