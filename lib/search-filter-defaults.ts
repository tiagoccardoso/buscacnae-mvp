type SearchQueryPayload = {
  cnaes?: unknown;
  stateCodes?: unknown;
  citySelections?: unknown;
  stateWide?: unknown;
  requireEmail?: unknown;
  requireAddress?: unknown;
  requirePhone?: unknown;
  mobileOnly?: unknown;
  companySizes?: unknown;
  simplesOnly?: unknown;
  capitalSocialMin?: unknown;
  capitalSocialMax?: unknown;
  activityStartYear?: unknown;
  activityStartYearExact?: unknown;
};

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];

  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    )
  );
}

function readCitySelections(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<{ cityName: string; stateCode: string }>;

  const unique = new Map<string, { cityName: string; stateCode: string }>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const cityName = typeof row.cityName === "string" ? row.cityName.trim() : "";
    const stateCode = typeof row.stateCode === "string" ? row.stateCode.trim().toUpperCase() : "";
    if (!cityName || !stateCode) continue;
    unique.set(`${cityName}|${stateCode}`, { cityName, stateCode });
  }

  return Array.from(unique.values());
}

function readNumberString(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}

export function getSearchFilterDefaults(payload: unknown) {
  const parsed = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as SearchQueryPayload)
    : null;

  return {
    defaultCnaes: readStringArray(parsed?.cnaes),
    defaultStateCodes: readStringArray(parsed?.stateCodes).map((item) => item.toUpperCase()),
    defaultCitySelections: readCitySelections(parsed?.citySelections),
    defaultStateWide: parsed?.stateWide === true,
    defaultRequireEmail: parsed?.requireEmail === true,
    defaultRequireAddress: parsed?.requireAddress === true,
    defaultRequirePhone: parsed?.requirePhone === true,
    defaultMobileOnly: parsed?.mobileOnly === true,
    defaultCompanySizes: readStringArray(parsed?.companySizes),
    defaultSimplesOnly: parsed?.simplesOnly === true,
    defaultCapitalSocialMin: readNumberString(parsed?.capitalSocialMin),
    defaultCapitalSocialMax: readNumberString(parsed?.capitalSocialMax),
    defaultActivityStartYear: readNumberString(parsed?.activityStartYear),
    defaultActivityStartYearExact: parsed?.activityStartYearExact === true
  };
}

/**
 * Filtros vindos da Busca rápida (Fase 7): `cnae` (lista de códigos), `uf` e `city`.
 * Tudo validado; valores fora do formato são ignorados. Retorna null se nada for aproveitável.
 */
export function getSearchFilterDefaultsFromQuickSearch(params: Record<string, string | string[] | undefined>) {
  const read = (name: string) => {
    const value = params[name];
    return typeof value === "string" ? value : Array.isArray(value) ? value[0] ?? "" : "";
  };
  const cnaes = read("cnae")
    .split(",")
    .map((item) => item.replace(/\D/g, ""))
    .filter((item) => /^\d{7}$/.test(item))
    .slice(0, 10);
  const stateCode = read("uf").trim().toUpperCase();
  const validState = /^[A-Z]{2}$/.test(stateCode) ? stateCode : "";
  const cityName = read("city").trim().slice(0, 80);
  if (cnaes.length === 0 && !validState) return null;
  return getSearchFilterDefaults({
    cnaes,
    stateCodes: validState ? [validState] : [],
    citySelections: validState && cityName ? [{ cityName, stateCode: validState }] : [],
    stateWide: Boolean(validState && !cityName)
  });
}
