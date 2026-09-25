import { createDbClient } from "@/lib/db-client";
import { prepareSearchOrder } from "@/lib/discovery/service";
import { getMapAreaSearchMaxCities } from "@/lib/env";
import { municipalitiesInBounds } from "@/lib/geo/municipalities";
import { describeAreaSearchPlan, planAreaSearch } from "@/lib/map/area-search";
import { isUuid } from "@/lib/map/service";
import type { AreaSearchResponse, GeoBounds } from "@/lib/map/types";

function readBoolean(value: unknown) {
  return value === true;
}

function readNumberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

/**
 * Executa "Buscar nesta área" reaproveitando a busca oficial (prepareSearchOrder).
 * Mantém CNAEs e filtros da busca de origem; troca apenas a localidade.
 */
export async function runAreaSearch(args: {
  profileId: string;
  email: string;
  sourceSearchId: string;
  bounds: GeoBounds;
}): Promise<AreaSearchResponse> {
  if (!isUuid(args.sourceSearchId)) {
    return { ok: false, reason: "invalid", message: "Busca de origem inválida." };
  }

  const db = createDbClient();
  const { data: source } = await db
    .from("search_queries")
    .select("id, cnae_code, query_payload")
    .eq("id", args.sourceSearchId)
    .eq("profile_id", args.profileId)
    .maybeSingle();

  if (!source) {
    return { ok: false, reason: "invalid", message: "Busca de origem não encontrada." };
  }

  const plan = planAreaSearch(
    args.bounds,
    (bounds) => municipalitiesInBounds(bounds),
    getMapAreaSearchMaxCities()
  );

  if (plan.kind !== "cities") {
    return {
      ok: false,
      reason: plan.kind === "too_large" ? "too_large" : plan.kind === "empty" ? "empty" : "invalid",
      message: describeAreaSearchPlan(plan)
    };
  }

  const payload =
    source.query_payload && typeof source.query_payload === "object" && !Array.isArray(source.query_payload)
      ? (source.query_payload as Record<string, unknown>)
      : {};
  const cnaes = readStringArray(payload.cnaes);
  const cnaeList = cnaes.length > 0 ? cnaes : typeof source.cnae_code === "string" ? [source.cnae_code] : [];

  if (cnaeList.length === 0) {
    return { ok: false, reason: "invalid", message: "A busca de origem não tem CNAE para repetir nesta área." };
  }

  const result = await prepareSearchOrder({
    profileId: args.profileId,
    email: args.email,
    cnae: cnaeList.join("\n"),
    stateCode: plan.stateCodes.join("\n"),
    citySelection: JSON.stringify(plan.cities),
    stateWide: false,
    requireEmail: readBoolean(payload.requireEmail),
    requireAddress: readBoolean(payload.requireAddress),
    requirePhone: readBoolean(payload.requirePhone),
    mobileOnly: readBoolean(payload.mobileOnly),
    companySizes: readStringArray(payload.companySizes),
    simplesOnly: readBoolean(payload.simplesOnly),
    capitalSocialMin: readNumberOrNull(payload.capitalSocialMin),
    capitalSocialMax: readNumberOrNull(payload.capitalSocialMax),
    activityStartYear: readNumberOrNull(payload.activityStartYear),
    activityStartYearExact: readBoolean(payload.activityStartYearExact)
  });

  if (!result.ok) {
    return { ok: false, reason: "error", message: result.error };
  }

  return { ok: true, searchId: result.data.searchId, cities: plan.cities.length };
}
