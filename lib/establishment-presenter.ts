import { extractSingleObject } from "@/lib/utils";

export type DisplayEstablishment = Record<string, unknown> & {
  cnpj: unknown;
  cnpj_root: unknown;
  company_name: unknown;
  trade_name: unknown;
  registration_status: unknown;
  opened_at: unknown;
  primary_cnae_code: unknown;
  primary_cnae_description: unknown;
  secondary_cnaes: unknown;
  legal_nature_code: unknown;
  legal_nature_description: unknown;
  company_size: unknown;
  simples_opt_in: unknown;
  mei_opt_in: unknown;
  capital_social: unknown;
  email: unknown;
  phone: unknown;
  website: unknown;
  country: unknown;
  state_code: unknown;
  city_name: unknown;
  city_ibge: unknown;
  neighborhood: unknown;
  cep: unknown;
  address_line: unknown;
  address_number: unknown;
  complement: unknown;
  provider_payload: unknown;
};

function hasContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((item) => hasContent(item));
  if (typeof value === "object") return Object.values(value).some((item) => hasContent(item));
  return true;
}

function getValue(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (hasContent(value)) {
      return value;
    }
  }
  return null;
}

function readPath(value: unknown, path: string[]): unknown {
  if (path.length === 0) {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = readPath(item, path);
      if (hasContent(nested)) {
        return nested;
      }
    }
    return null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const [key, ...rest] = path;
  return readPath((value as Record<string, unknown>)[key], rest);
}

function extractFirstText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractFirstText(item);
      if (nested) return nested;
    }
    return null;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["email", "completo", "telefone", "numero", "valor", "site", "url", "descricao", "nome"]) {
      const nested = extractFirstText(record[key]);
      if (nested) return nested;
    }
  }

  return null;
}

function extractPhoneText(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractPhoneText(item);
      if (nested) return nested;
    }
    return null;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const complete = extractFirstText(record.completo);
    if (complete) return complete;

    const ddd = extractFirstText(record.ddd);
    const number = extractFirstText(record.numero);
    if (ddd && number) return `${ddd}-${number}`;
    if (number) return number;
  }

  return extractFirstText(value);
}

export function getEstablishmentPayload(establishment: Record<string, unknown>) {
  return extractSingleObject(establishment.provider_payload);
}

function collectPayloadSources(establishment: Record<string, unknown>) {
  const payload = getEstablishmentPayload(establishment);
  const candidates = [
    payload,
    payload?.consulta_cnpj,
    payload?.consulta_cnpj && typeof payload.consulta_cnpj === "object" && !Array.isArray(payload.consulta_cnpj)
      ? extractSingleObject((payload.consulta_cnpj as Record<string, unknown>).estabelecimento)
      : null,
    payload?.cnpjws_consulta,
    payload?.cnpjws_consulta && typeof payload.cnpjws_consulta === "object" && !Array.isArray(payload.cnpjws_consulta)
      ? extractSingleObject((payload.cnpjws_consulta as Record<string, unknown>).estabelecimento)
      : null,
    payload?.cnpjws_consulta && typeof payload.cnpjws_consulta === "object" && !Array.isArray(payload.cnpjws_consulta)
      ? extractSingleObject((payload.cnpjws_consulta as Record<string, unknown>).simples)
      : null,
    payload?.cnpjws_consulta && typeof payload.cnpjws_consulta === "object" && !Array.isArray(payload.cnpjws_consulta)
      ? extractSingleObject((payload.cnpjws_consulta as Record<string, unknown>).consulta_cnpj)
      : null,
    payload?.casadosdados_pesquisa,
    payload?.pesquisa
  ];

  return candidates.filter(
    (candidate): candidate is Record<string, unknown> => !!candidate && typeof candidate === "object" && !Array.isArray(candidate)
  );
}

function dedupeAddressType(type: string, street: string) {
  const normalizedType = type.trim();
  const normalizedStreet = street.trim();
  if (!normalizedType || !normalizedStreet) return [normalizedType, normalizedStreet] as const;

  if (/^\d/.test(normalizedType)) {
    return ["", normalizedStreet] as const;
  }

  const escapedType = normalizedType.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`^${escapedType}\\b`, "i").test(normalizedStreet)) {
    return ["", normalizedStreet] as const;
  }

  return [normalizedType, normalizedStreet] as const;
}

function normalizeAddressLine(rawValue: unknown) {
  const line = extractFirstText(rawValue);
  if (!line) return null;

  return line
    .replace(/\s+/g, " ")
    .replace(/\b(rua|avenida|av\.?|travessa|rodovia|alameda|estrada)\s+\1\b/gi, "$1")
    .trim();
}

function findFirstUnknownFromPaths(sources: Record<string, unknown>[], paths: string[][]): unknown {
  for (const source of sources) {
    for (const path of paths) {
      const nested = readPath(source, path);
      if (hasContent(nested)) {
        return nested;
      }
    }
  }
  return null;
}

function resolveSecondaryCnaes(establishment: Record<string, unknown>, sources: Record<string, unknown>[]) {
  const direct = getValue(establishment, "secondary_cnaes", "atividades_secundarias");
  if (hasContent(direct)) return direct;

  return findFirstUnknownFromPaths(sources, [
    ["atividade_secundaria"],
    ["atividades_secundarias"],
    ["estabelecimento", "atividade_secundaria"],
    ["estabelecimento", "atividades_secundarias"],
    ["consulta_cnpj", "atividade_secundaria"],
    ["consulta_cnpj", "atividades_secundarias"],
    ["cnpjws_consulta", "estabelecimento", "atividade_secundaria"]
  ]);
}

function resolvePrimaryCnaeCode(establishment: Record<string, unknown>, sources: Record<string, unknown>[]) {
  return getValue(establishment, "primary_cnae_code", "cnae_principal") ??
    findFirstFromPaths(sources, [
      ["atividade_principal", "codigo"],
      ["atividade_principal", "id"],
      ["codigo_atividade_principal"],
      ["cnae_fiscal_principal"],
      ["estabelecimento", "cnae_fiscal_principal"],
      ["consulta_cnpj", "cnae_fiscal_principal"]
    ]);
}

function resolvePrimaryCnaeDescription(establishment: Record<string, unknown>, sources: Record<string, unknown>[]) {
  return getValue(establishment, "primary_cnae_description", "atividade_principal_descricao") ??
    findFirstFromPaths(sources, [
      ["atividade_principal", "descricao"],
      ["atividade_principal_descricao"],
      ["descricao_atividade_principal"],
      ["cnae_fiscal_principal_descricao"],
      ["estabelecimento", "cnae_fiscal_principal_descricao"],
      ["consulta_cnpj", "cnae_fiscal_principal_descricao"]
    ]);
}

function findFirstFromPaths(
  sources: Record<string, unknown>[],
  paths: string[][],
  extractor: (value: unknown) => string | null = extractFirstText
) {
  for (const source of sources) {
    for (const path of paths) {
      const nested = readPath(source, path);
      const extracted = extractor(nested);
      if (extracted) {
        return extracted;
      }
    }
  }
  return null;
}

function resolveAddressLine(establishment: Record<string, unknown>, sources: Record<string, unknown>[]) {
  const directLine = getValue(establishment, "address_line", "logradouro");
  const normalizedDirect = normalizeAddressLine(directLine);
  if (normalizedDirect) return normalizedDirect;

  for (const source of sources) {
    const address = readPath(source, ["endereco"]);
    const addressRecord = address && typeof address === "object" && !Array.isArray(address)
      ? (address as Record<string, unknown>)
      : source;

    const type = extractFirstText(addressRecord.tipo_logradouro);
    const street = extractFirstText(addressRecord.logradouro ?? addressRecord.tipo_e_logradouro);
    const [safeType, safeStreet] = dedupeAddressType(type ?? "", street ?? "");
    const line = normalizeAddressLine([safeType, safeStreet].filter(Boolean).join(" "));
    if (line) return line;
  }

  return null;
}

export function buildDisplayEstablishment(establishment: Record<string, unknown>): DisplayEstablishment {
  const payloadSources = collectPayloadSources(establishment);

  return {
    ...establishment,
    cnpj:
      getValue(establishment, "cnpj") ??
      findFirstFromPaths(payloadSources, [["cnpj"], ["estabelecimento", "cnpj"], ["empresa", "cnpj"]]),
    cnpj_root:
      getValue(establishment, "cnpj_root", "cnpj_raiz") ??
      findFirstFromPaths(payloadSources, [["cnpj_raiz"], ["cnpjRoot"], ["raiz_cnpj"]]),
    company_name:
      getValue(establishment, "company_name", "razao_social") ??
      findFirstFromPaths(payloadSources, [["razao_social"], ["nome_empresarial"], ["nome"]]),
    trade_name:
      getValue(establishment, "trade_name", "nome_fantasia") ??
      findFirstFromPaths(payloadSources, [["nome_fantasia"]]),
    registration_status:
      getValue(establishment, "registration_status", "situacao_cadastral") ??
      findFirstFromPaths(payloadSources, [["situacao_cadastral", "situacao_atual"], ["situacao_cadastral"], ["status"]]),
    opened_at:
      getValue(establishment, "opened_at", "data_abertura", "data_inicio_atividade") ??
      findFirstFromPaths(payloadSources, [["data_abertura"], ["data_inicio_atividade"], ["situacao_cadastral", "data"]]),
    primary_cnae_code: resolvePrimaryCnaeCode(establishment, payloadSources),
    primary_cnae_description: resolvePrimaryCnaeDescription(establishment, payloadSources),
    secondary_cnaes: resolveSecondaryCnaes(establishment, payloadSources),
    legal_nature_code:
      getValue(establishment, "legal_nature_code", "natureza_juridica_id") ??
      findFirstFromPaths(payloadSources, [["codigo_natureza_juridica"], ["natureza_juridica", "codigo"]]),
    legal_nature_description:
      getValue(establishment, "legal_nature_description", "natureza_juridica") ??
      findFirstFromPaths(payloadSources, [["descricao_natureza_juridica"], ["natureza_juridica", "descricao"], ["natureza_juridica"]]),
    company_size:
      getValue(establishment, "company_size", "porte") ??
      findFirstFromPaths(payloadSources, [["porte_empresa", "descricao"], ["porte", "descricao"], ["porte"]]),
    simples_opt_in:
      getValue(establishment, "simples_opt_in", "simples") ??
      findFirstFromPaths(payloadSources, [["simples", "optante"], ["simples_optante"], ["cnpjws_consulta", "simples", "optante"], ["cnpjws_consulta", "simples", "simples"]]),
    mei_opt_in:
      getValue(establishment, "mei_opt_in", "mei") ??
      findFirstFromPaths(payloadSources, [["mei", "optante"], ["mei_optante"], ["cnpjws_consulta", "simples", "mei"], ["simples", "mei"]]),
    capital_social:
      getValue(establishment, "capital_social") ??
      findFirstFromPaths(payloadSources, [["capital_social"]]),
    email:
      getValue(establishment, "email") ??
      findFirstFromPaths(payloadSources, [["contato_email"], ["email"], ["contacts", "email"], ["contacts", "emails"], ["estabelecimento", "email"], ["consulta_cnpj", "email"]]),
    phone:
      getValue(establishment, "phone", "telefone") ??
      findFirstFromPaths(
        payloadSources,
        [["contato_telefonico"], ["telefone"], ["telefone1"], ["ddd_telefone_1"], ["contacts", "telefone"], ["contacts", "telefones"], ["estabelecimento", "telefone1"], ["consulta_cnpj", "telefone"]],
        extractPhoneText
      ),
    website:
      getValue(establishment, "website", "site") ??
      findFirstFromPaths(payloadSources, [["website"], ["site"], ["url"], ["contacts", "website"], ["contacts", "site"], ["estabelecimento", "site"], ["consulta_cnpj", "site"]]),
    country:
      getValue(establishment, "country", "pais") ??
      findFirstFromPaths(payloadSources, [["pais", "nome"], ["pais_nome"], ["pais"]]),
    state_code:
      getValue(establishment, "state_code", "uf") ??
      findFirstFromPaths(payloadSources, [["endereco", "uf"], ["uf"], ["estabelecimento", "uf"], ["consulta_cnpj", "uf"]]),
    city_name:
      getValue(establishment, "city_name", "cidade", "municipio") ??
      findFirstFromPaths(payloadSources, [["endereco", "municipio"], ["cidade_nome"], ["cidade"], ["municipio"], ["estabelecimento", "cidade"], ["consulta_cnpj", "municipio"]]),
    city_ibge:
      getValue(establishment, "city_ibge", "cidade_id", "ibge_id") ??
      findFirstFromPaths(payloadSources, [["endereco", "ibge", "codigo_municipio"], ["codigo_municipio_ibge"], ["cidade_id"], ["ibge_id"], ["estabelecimento", "codigo_municipio_ibge"], ["consulta_cnpj", "codigo_municipio_ibge"]]),
    cep:
      getValue(establishment, "cep") ??
      findFirstFromPaths(payloadSources, [["endereco", "cep"], ["cep"], ["estabelecimento", "cep"], ["consulta_cnpj", "cep"]]),
    neighborhood:
      getValue(establishment, "neighborhood", "bairro") ??
      findFirstFromPaths(payloadSources, [["endereco", "bairro"], ["bairro"], ["estabelecimento", "bairro"], ["consulta_cnpj", "bairro"]]),
    address_line: resolveAddressLine(establishment, payloadSources),
    address_number:
      getValue(establishment, "address_number", "numero") ??
      findFirstFromPaths(payloadSources, [["endereco", "numero"], ["numero"], ["estabelecimento", "numero"], ["consulta_cnpj", "numero"]]),
    complement:
      getValue(establishment, "complement", "complemento") ??
      findFirstFromPaths(payloadSources, [["endereco", "complemento"], ["complemento"], ["estabelecimento", "complemento"], ["consulta_cnpj", "complemento"]]),
    provider_payload: getValue(establishment, "provider_payload")
  };
}
