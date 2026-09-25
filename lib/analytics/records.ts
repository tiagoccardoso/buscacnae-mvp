import { mapCompanyToFilterSubject } from "@/lib/map/filters";
import type { MapCompany, MapRegionSeat } from "@/lib/map/types";
import type { AnalyticsRecord } from "@/lib/analytics/metrics";
import { computeFacetKeys } from "@/lib/analytics/dimensions";

/**
 * MapCompany (o mesmo JSON de GET /api/map/searches/[id]) → registro analítico.
 *
 * A Inteligência NÃO tem endpoint nem modelo próprios: consome exatamente o conjunto
 * normalizado que o Mapa recebe, convertido pelo MESMO adaptador de filtros
 * (`mapCompanyToFilterSubject`). O rótulo do município vem da sede IBGE (base local);
 * sem sede, do município informado no cadastro.
 */
export function toAnalyticsRecords(companies: readonly MapCompany[], seats: readonly MapRegionSeat[] = []): AnalyticsRecord[] {
  const seatByKey = new Map(seats.map((seat) => [seat.key, seat]));
  return companies.map((company) => {
    const seat = company.regionKey ? seatByKey.get(company.regionKey) : undefined;
    const municipalityLabel = seat
      ? `${seat.name}/${seat.stateCode}`
      : company.regionKey && company.cityName
        ? [company.cityName, company.stateCode].filter(Boolean).join("/")
        : null;
    const subject = mapCompanyToFilterSubject(company);
    return {
      ...subject,
      keys: computeFacetKeys(subject),
      id: company.id,
      municipalityLabel,
      cnaeDescription: company.primaryCnaeDescription
    };
  });
}
