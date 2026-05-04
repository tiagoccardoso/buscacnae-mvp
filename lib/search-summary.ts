import { toTitleCase } from "@/lib/utils";

type SearchSummarySource = {
  cnae_code?: string | null;
  city_name?: string | null;
  state_code?: string | null;
  query_payload?: unknown;
};

type CitySelectionPayload = {
  cityName: string;
  stateCode: string;
};

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];

  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    unique.add(trimmed);
  }

  return Array.from(unique);
}

function readCitySelections(value: unknown) {
  if (!Array.isArray(value)) return [] as CitySelectionPayload[];

  const unique = new Map<string, CitySelectionPayload>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.cityName !== "string" || typeof candidate.stateCode !== "string") continue;
    const cityName = toTitleCase(candidate.cityName);
    const stateCode = candidate.stateCode.trim().toUpperCase();
    if (!cityName || !stateCode) continue;
    const key = `${cityName}|${stateCode}`;
    if (!unique.has(key)) {
      unique.set(key, { cityName, stateCode });
    }
  }

  return Array.from(unique.values());
}

function formatCompactList(values: string[], emptyLabel: string) {
  if (values.length === 0) return emptyLabel;
  if (values.length === 1) return values[0];
  if (values.length <= 3) return values.join(", ");
  return `${values.slice(0, 3).join(", ")} +${values.length - 3}`;
}

export function getSearchSummary(source: SearchSummarySource) {
  const payload =
    source.query_payload && typeof source.query_payload === "object" && !Array.isArray(source.query_payload)
      ? (source.query_payload as Record<string, unknown>)
      : null;

  const cnaes = readStringArray(payload?.cnaes).map((item) => item.replace(/\D/g, ""));
  const cityNames = readStringArray(payload?.cityNames).map((item) => toTitleCase(item));
  const stateCodes = readStringArray(payload?.stateCodes).map((item) => item.toUpperCase());
  const citySelections = readCitySelections(payload?.citySelections).map((item) => `${item.cityName}/${item.stateCode}`);
  const filterLabels = readStringArray(payload?.filterLabels);
  const stateWide = payload?.stateWide === true;
  const activityStartYear = typeof payload?.activityStartYear === "number" ? Math.trunc(payload.activityStartYear) : null;
  const activityStartYearExact = payload?.activityStartYearExact === true;

  const cnaeText = cnaes.length > 0 ? formatCompactList(cnaes, "Todos os CNAEs") : source.cnae_code ?? "Todos os CNAEs";

  let locationText = "Brasil";

  if (stateWide) {
    const statesLabel = formatCompactList(stateCodes, source.state_code ?? "estado informado");
    locationText = `Estado inteiro · ${statesLabel}`;
  } else if (citySelections.length > 0) {
    locationText = formatCompactList(citySelections, source.city_name ?? "-");
  } else if (cityNames.length > 0 || stateCodes.length > 0) {
    const citiesLabel = cityNames.length > 0 ? formatCompactList(cityNames, source.city_name ?? "-") : source.city_name ?? "-";
    const statesLabel = stateCodes.length > 0 ? formatCompactList(stateCodes, source.state_code ?? "-") : source.state_code ?? "-";
    locationText = `${citiesLabel} · ${statesLabel}`;
  } else if (source.city_name || source.state_code) {
    locationText = `${source.city_name ?? "-"} · ${source.state_code ?? "-"}`;
  }

  return {
    cnaeText,
    locationText,
    headline: `${cnaeText} · ${locationText}`,
    stateWide,
    filterLabels: [
      ...filterLabels,
      ...(activityStartYear
        ? [activityStartYearExact ? `Ativas somente em ${activityStartYear}` : `Ativas desde ${activityStartYear}`]
        : [])
    ]
  };
}
