import { getCnpjWsToken, getDiscoveryMaxResults } from "@/lib/env";
import { DiscoverySearchInput, DiscoverySearchOutput, NormalizedEstablishment } from "@/lib/types";
import {
  coalesceArray,
  coalesceObject,
  coalesceString,
  normalizeCnpj,
  normalizeCode,
  parseBoolean,
  parseNumber,
  toTitleCase
} from "@/lib/utils";
import { resolveCityIbge } from "./ibge";

function normalizeFromCnpjWs(item: Record<string, unknown>): NormalizedEstablishment | null {
  const establishment = coalesceObject(item.estabelecimento, item.establishment, item);
  const activity = coalesceObject(
    establishment?.atividade_principal,
    establishment?.atividadePrincipal,
    item.atividade_principal,
    item.atividadePrincipal
  );
  const city = coalesceObject(establishment?.cidade, item.cidade);
  const state = coalesceObject(establishment?.estado, item.estado);
  const country = coalesceObject(establishment?.pais, item.pais);

  const cnpj = normalizeCnpj(
    coalesceString(item.cnpj, establishment?.cnpj, establishment?.cnpj_completo) ?? ""
  );
  if (!cnpj) return null;

  return {
    cnpj,
    cnpjRoot: normalizeCode(coalesceString(item.cnpj_raiz, establishment?.cnpj_raiz) ?? ""),
    companyName:
      coalesceString(item.razao_social, item.nome, establishment?.razao_social, establishment?.nome) ??
      "Sem razão social",
    tradeName: coalesceString(item.nome_fantasia, establishment?.nome_fantasia),
    registrationStatus: coalesceString(
      establishment?.situacao_cadastral,
      item.situacao_cadastral,
      establishment?.situacao
    ),
    openedAt: coalesceString(establishment?.data_inicio_atividade, item.data_inicio_atividade),
    primaryCnaeCode: normalizeCode(
      coalesceString(activity?.id, activity?.codigo, establishment?.cnae_fiscal_principal_id, item.atividade_principal_id) ?? ""
    ),
    primaryCnaeDescription: coalesceString(activity?.descricao, activity?.text),
    secondaryCnaes: coalesceArray(
      establishment?.atividades_secundarias,
      item.atividades_secundarias
    ),
    legalNatureCode: normalizeCode(
      coalesceString(item.natureza_juridica_id, establishment?.natureza_juridica_id) ?? ""
    ),
    legalNatureDescription: coalesceString(
      item.natureza_juridica,
      establishment?.natureza_juridica
    ),
    companySize: coalesceString(item.porte, establishment?.porte),
    simplesOptIn: parseBoolean(item.simples_optante ?? establishment?.simples_optante),
    meiOptIn: parseBoolean(item.mei_optante ?? establishment?.mei_optante),
    capitalSocial: parseNumber(item.capital_social ?? establishment?.capital_social),
    email: coalesceString(establishment?.email, item.email),
    phone: coalesceString(establishment?.telefone1, establishment?.telefone, item.telefone),
    website: coalesceString(establishment?.website, item.website),
    country: coalesceString(country?.nome, item.pais_nome),
    stateCode: coalesceString(state?.sigla, item.uf, establishment?.uf)?.toUpperCase() ?? null,
    cityName:
      coalesceString(city?.nome, item.cidade_nome, establishment?.cidade, item.cidade) ??
      null,
    cityIbge: normalizeCode(
      coalesceString(city?.id, item.cidade_id, establishment?.cidade_id, item.codigo_municipio_ibge) ?? ""
    ),
    neighborhood: coalesceString(establishment?.bairro, item.bairro),
    cep: normalizeCode(coalesceString(establishment?.cep, item.cep) ?? ""),
    addressLine: coalesceString(
      establishment?.tipo_logradouro && establishment?.logradouro
        ? `${establishment.tipo_logradouro} ${establishment.logradouro}`
        : null,
      establishment?.logradouro,
      item.logradouro
    ),
    addressNumber: coalesceString(establishment?.numero, item.numero),
    complement: coalesceString(establishment?.complemento, item.complemento),
    providerPayload: item
  };
}

export async function searchWithCnpjWs(input: DiscoverySearchInput): Promise<DiscoverySearchOutput> {
  let cityIbge = input.cityIbge?.trim();

  if (!cityIbge) {
    cityIbge = await resolveCityIbge({
      cityName: input.cityName,
      stateCode: input.stateCode
    });
  }

  const params = new URLSearchParams({
    atividade_id: normalizeCode(input.cnae),
    cidade_id: normalizeCode(cityIbge),
    situacao_cadastral: "ATIVA"
  });

  const maxResults = getDiscoveryMaxResults();
  if (maxResults > 0) {
    params.set("limite", String(maxResults));
  }

  const response = await fetch(`https://comercial.cnpj.ws/v2/pesquisa?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${getCnpjWsToken()}`,
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`CNPJ.ws respondeu ${response.status}: ${message}`);
  }

  const raw = (await response.json()) as Record<string, unknown>;
  const rows = coalesceArray(raw.registros, raw.itens, raw.data, raw.resultados, raw.empresas, raw) ?? [];

  const normalized = rows
    .map((item) => normalizeFromCnpjWs(item as Record<string, unknown>))
    .filter(Boolean) as NormalizedEstablishment[];

  return {
    provider: "cnpjws",
    raw,
    normalized: normalized.map((item) => ({
      ...item,
      cityName: item.cityName ? toTitleCase(item.cityName) : item.cityName
    }))
  };
}
