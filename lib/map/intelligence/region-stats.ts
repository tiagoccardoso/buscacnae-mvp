import {
  NEW_COMPANY_WINDOW_MONTHS,
  analysisReferenceDate,
  formatCnaeCode,
  isActiveStatus,
  isNewCompany,
  newCompanyWindowStart,
  parseIsoDay
} from "@/lib/analytics/dimensions";
import type { LocationPrecision, MapCompany, MapPrecisionStats, MapRegionSeat } from "@/lib/map/types";

/**
 * Indicadores territoriais calculados SOMENTE com campos que a Casa dos Dados já devolveu
 * para as empresas da busca (situação, data de abertura, CNAE principal, porte).
 *
 * Regras para não inventar indicadores:
 * - campo ausente é contado como "não informado" e sai do denominador do percentual;
 * - "novas empresas" = abertas nos últimos 12 meses em relação à data do cálculo,
 *   considerando só empresas com data de abertura conhecida;
 * - nada é estimado para empresas fora da busca (a base é o resultado carregado).
 */
export { NEW_COMPANY_WINDOW_MONTHS };

export type RankedValue = { key: string; label: string; count: number };

export type RegionStats = {
  total: number;
  status: { active: number; inactive: number; unknown: number };
  newCompanies: { count: number; known: number; windowMonths: number; since: string };
  topCnaes: RankedValue[];
  /** CNAEs distintos entre as empresas com CNAE informado. */
  distinctCnaes: number;
  cnaeUnknown: number;
  bySize: RankedValue[];
  sizeUnknown: number;
  precision: MapPrecisionStats;
  /** Empresas cuja posição não é um ponto (CEP, município ou UF). */
  approximate: number;
  withoutLocation: number;
};

function emptyPrecision(): MapPrecisionStats {
  return { exact: 0, address: 0, postal_code: 0, city: 0, approximate: 0 };
}

function rank(counter: Map<string, RankedValue>, limit: number) {
  return Array.from(counter.values())
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "pt-BR"))
    .slice(0, limit);
}

export function summarizeCompanies(
  companies: readonly MapCompany[],
  options: { now?: Date; referenceDate?: string; topCnaes?: number } = {}
): RegionStats {
  // Mesma regra de "novas empresas" da Inteligência de Mercado (lib/analytics/dimensions.ts).
  const referenceDate = options.referenceDate ?? analysisReferenceDate(options.now ?? new Date());
  const since = newCompanyWindowStart(referenceDate);

  const status = { active: 0, inactive: 0, unknown: 0 };
  const newCompanies = { count: 0, known: 0 };
  const cnaes = new Map<string, RankedValue>();
  const sizes = new Map<string, RankedValue>();
  const precision = emptyPrecision();
  let cnaeUnknown = 0;
  let sizeUnknown = 0;
  let withoutLocation = 0;

  for (const company of companies) {
    if (!company.status) status.unknown += 1;
    else if (isActiveStatus(company.status)) status.active += 1;
    else status.inactive += 1;

    if (parseIsoDay(company.openedAt)) {
      newCompanies.known += 1;
      if (isNewCompany(company.openedAt, referenceDate, since)) newCompanies.count += 1;
    }

    const code = company.primaryCnaeCode?.replace(/\D/g, "") || "";
    if (code) {
      const entry = cnaes.get(code);
      if (entry) entry.count += 1;
      else
        cnaes.set(code, {
          key: code,
          label: company.primaryCnaeDescription ? `${formatCnaeCode(code)} · ${company.primaryCnaeDescription}` : formatCnaeCode(code),
          count: 1
        });
    } else {
      cnaeUnknown += 1;
    }

    const size = company.companySize?.trim();
    if (size) {
      const entry = sizes.get(size);
      if (entry) entry.count += 1;
      else sizes.set(size, { key: size, label: size, count: 1 });
    } else {
      sizeUnknown += 1;
    }

    if (company.location) precision[company.location.precision] += 1;
    else withoutLocation += 1;
  }

  return {
    total: companies.length,
    status,
    newCompanies: {
      ...newCompanies,
      windowMonths: NEW_COMPANY_WINDOW_MONTHS,
      since
    },
    topCnaes: rank(cnaes, options.topCnaes ?? 5),
    distinctCnaes: cnaes.size,
    cnaeUnknown,
    bySize: rank(sizes, 20),
    sizeUnknown,
    precision,
    approximate: precision.postal_code + precision.city + precision.approximate,
    withoutLocation
  };
}

/** Percentual inteiro seguro (denominador zero → null, nunca "0%" inventado). */
export function percentOf(part: number, whole: number) {
  if (!whole) return null;
  return Math.round((part / whole) * 100);
}

export type MunicipalityAggregate = {
  seat: MapRegionSeat;
  count: number;
  companyIds: string[];
};

/**
 * Agrupa empresas por município (chave IBGE ou UF+nome). Empresas cujo município não
 * foi identificado na base IBGE ficam em `unmatched` (continuam na lista e nas outras camadas).
 */
export function aggregateByMunicipality(companies: readonly MapCompany[], seats: readonly MapRegionSeat[]) {
  const seatByKey = new Map(seats.map((seat) => [seat.key, seat]));
  const groups = new Map<string, MunicipalityAggregate>();
  let unmatched = 0;
  for (const company of companies) {
    const seat = company.regionKey ? seatByKey.get(company.regionKey) : undefined;
    if (!seat) {
      unmatched += 1;
      continue;
    }
    const group = groups.get(seat.key);
    if (group) {
      group.count += 1;
      group.companyIds.push(company.id);
    } else {
      groups.set(seat.key, { seat, count: 1, companyIds: [company.id] });
    }
  }
  const regions = Array.from(groups.values()).sort(
    (left, right) => right.count - left.count || left.seat.name.localeCompare(right.seat.name, "pt-BR")
  );
  return { regions, unmatched };
}

/** Rótulo de precisão predominante para avisos da análise. */
export function dominantPrecision(precision: MapPrecisionStats): LocationPrecision | null {
  let best: LocationPrecision | null = null;
  let bestCount = 0;
  for (const key of Object.keys(precision) as LocationPrecision[]) {
    if (precision[key] > bestCount) {
      best = key;
      bestCount = precision[key];
    }
  }
  return best;
}
