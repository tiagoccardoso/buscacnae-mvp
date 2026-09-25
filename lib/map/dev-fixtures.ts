import type { CompanySummary } from "@/lib/company-model";
import { listMunicipalities } from "@/lib/geo/municipalities";
import { boundsFromPoints } from "@/lib/map/geo";
import { buildMapCompanies, buildRegionSeats, summarizeMapCompanies } from "@/lib/map/service";
import type { MapSearchData } from "@/lib/map/types";

/**
 * Dados SINTÉTICOS para validar o mapa localmente (volume, performance, UX) sem banco,
 * sem login e sem consumir a Casa dos Dados. Usados só pela rota /dev/mapa (desligada em
 * produção) e pelos testes. Passam pelo MESMO pipeline do servidor (buildMapCompanies →
 * resolveCompanyLocation → spreadSharedLocations), então a precisão é tratada de verdade:
 * - ~70% só com município (precisão "city", como a Casa dos Dados devolve hoje);
 * - ~20% com CEP em cache ("postal_code");
 * - ~10% com coordenada de endereço na fonte ("address").
 */
const CNAES: Array<[string, string]> = [
  ["4781400", "Comércio varejista de artigos do vestuário e acessórios"],
  ["5611201", "Restaurantes e similares"],
  ["4712100", "Comércio varejista de mercadorias em geral (minimercados)"],
  ["9602501", "Cabeleireiros, manicure e pedicure"],
  ["4930202", "Transporte rodoviário de carga intermunicipal"],
  ["6201501", "Desenvolvimento de programas de computador sob encomenda"],
  ["8630504", "Atividade odontológica"],
  ["4120400", "Construção de edifícios"]
];
const SIZES = ["ME", "EPP", "DEMAIS"];
const STATUSES = ["ATIVA", "ATIVA", "ATIVA", "ATIVA", "BAIXADA", "INAPTA"];

/** PRNG determinístico (mulberry32): mesmo conjunto a cada execução. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pad(value: number, size: number) {
  return String(value).padStart(size, "0");
}

export function buildSyntheticSummaries(count: number, seed = 42): { summaries: CompanySummary[]; postal: Map<string, { latitude: number; longitude: number }> } {
  const next = random(seed);
  const all = listMunicipalities();
  // Poucas cidades concentram a maioria das empresas (distribuição realista).
  const capitals = all.filter((item) => item.capital);
  const others = all.filter((item) => !item.capital);
  const pool = [...capitals, ...others.slice(0, 400)];
  const postal = new Map<string, { latitude: number; longitude: number }>();
  const summaries: CompanySummary[] = [];

  for (let index = 0; index < count; index += 1) {
    const r = next();
    const city = r < 0.55 ? capitals[Math.floor(next() * capitals.length)] : pool[Math.floor(next() * pool.length)];
    const [cnae, description] = CNAES[Math.floor(Math.pow(next(), 1.6) * CNAES.length)];
    const kind = next();
    const cnpj = `${pad(10_000_000 + index, 8)}0001${pad(index % 100, 2)}`;
    let postalCode: string | null = null;
    let payload: Record<string, unknown> | null = null;

    if (kind < 0.1) {
      payload = {
        endereco: {
          latitude: city.latitude + (next() - 0.5) * 0.08,
          longitude: city.longitude + (next() - 0.5) * 0.08
        }
      };
    } else if (kind < 0.3) {
      postalCode = `${pad(Math.floor(next() * 99_999_999), 8)}`;
      postal.set(postalCode, { latitude: city.latitude + (next() - 0.5) * 0.05, longitude: city.longitude + (next() - 0.5) * 0.05 });
    }

    const year = 1995 + Math.floor(next() * 32);
    const openedAt = `${Math.min(year, 2026)}-${pad(1 + Math.floor(next() * 12), 2)}-${pad(1 + Math.floor(next() * 28), 2)}`;
    const name = `EMPRESA ${description.split(" ")[0].toUpperCase()} ${index + 1} LTDA`;

    summaries.push({
      id: `dev-${index}`,
      cnpj,
      legalName: name,
      tradeName: next() < 0.5 ? `Loja ${index + 1}` : null,
      displayName: name,
      status: next() < 0.03 ? null : STATUSES[Math.floor(next() * STATUSES.length)],
      openedAt: next() < 0.05 ? null : openedAt,
      primaryCnaeCode: cnae,
      primaryCnaeDescription: description,
      companySize: next() < 0.08 ? null : SIZES[Math.floor(Math.pow(next(), 2) * SIZES.length)],
      capitalSocial: Math.round(next() * 500_000),
      email: next() < 0.4 ? `contato${index}@exemplo.com.br` : null,
      phone: next() < 0.6 ? "(11) 98765-4321" : null,
      phoneIsMobile: next() < 0.5,
      headquartersOrBranch: next() < 0.85 ? "matriz" : "filial",
      neighborhood: "Centro",
      cityName: city.name,
      cityIbge: city.ibge,
      stateCode: city.stateCode,
      postalCode,
      payload
    });
  }
  return { summaries, postal };
}

export function buildSyntheticMapData(count: number, seed = 42): MapSearchData {
  const { summaries, postal } = buildSyntheticSummaries(count, seed);
  const companies = buildMapCompanies(summaries, new Set(), postal);
  const located = companies.filter((company) => company.location).map((company) => company.location!);
  return {
    searchId: "00000000-0000-4000-8000-000000000000",
    headline: `Dados sintéticos · ${new Intl.NumberFormat("pt-BR").format(count)} empresas`,
    cnaeText: "8 CNAEs",
    locationText: "Brasil",
    filterLabels: ["Ambiente de validação"],
    createdAt: null,
    totalResults: count,
    unlocked: true,
    lockedCount: 0,
    companies,
    stats: summarizeMapCompanies(companies),
    limits: { maxMarkers: count, truncated: false, tooManyResults: false },
    bounds: boundsFromPoints(located),
    regions: buildRegionSeats(summaries),
    geocoding: { enabled: false, pendingPostalCodes: 0 }
  };
}
