import {
  subjectMatchesFilters,
  type CompanyFilterSubject,
  type CompanyTableFilters
} from "@/lib/results/company-table-model";
import type { MapCompany } from "@/lib/map/types";

/**
 * Filtros do Mapa = filtros da Lista (lib/results/company-table-model.ts).
 * O mapa converte cada MapCompany para o mesmo "sujeito de filtro" usado pela tabela,
 * então situação, contato, UF, matriz/filial e busca textual têm a MESMA regra nas duas
 * visões. O mapa recebe só indicadores de contato (tem telefone/e-mail), nunca os contatos.
 */
export function mapCompanyToFilterSubject(company: MapCompany): CompanyFilterSubject {
  return {
    cnpj: company.cnpj,
    status: company.status,
    state: company.stateCode,
    headquartersOrBranch: company.headquartersOrBranch,
    hasPhone: company.hasPhone,
    hasMobilePhone: company.hasMobilePhone,
    hasEmail: company.hasEmail,
    searchText: [
      company.legalName,
      company.tradeName,
      company.cnpj,
      company.cityName,
      company.stateCode,
      company.neighborhood,
      company.primaryCnaeCode,
      company.primaryCnaeDescription
    ]
      .filter(Boolean)
      .join(" ")
  };
}

export type IndexedMapCompany = { company: MapCompany; subject: CompanyFilterSubject };

export function indexMapCompanies(companies: readonly MapCompany[]): IndexedMapCompany[] {
  return companies.map((company) => ({ company, subject: mapCompanyToFilterSubject(company) }));
}

export function filterIndexedMapCompanies(indexed: readonly IndexedMapCompany[], filters: CompanyTableFilters): MapCompany[] {
  const result: MapCompany[] = [];
  for (const item of indexed) if (subjectMatchesFilters(item.subject, filters)) result.push(item.company);
  return result;
}

export function filterMapCompanies(companies: readonly MapCompany[], filters: CompanyTableFilters) {
  return filterIndexedMapCompanies(indexMapCompanies(companies), filters);
}

export function listMapStates(companies: readonly MapCompany[]) {
  return Array.from(new Set(companies.map((company) => company.stateCode).filter((value): value is string => Boolean(value)))).sort();
}
