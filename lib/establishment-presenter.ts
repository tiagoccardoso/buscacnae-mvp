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
    payload?.cnpjws_consulta,
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
  if (typeof directLine === "string" && directLine.trim()) return directLine.trim();

  for (const source of sources) {
    const address = readPath(source, ["endereco"]);
    const addressRecord = address && typeof address === "object" && !Array.isArray(address)
      ? (address as Record<string, unknown>)
      : source;

    const type = extractFirstText(addressRecord.tipo_logradouro);
    const street = extractFirstText(addressRecord.logradouro);
    const line = [type, street].filter(Boolean).join(" ").trim();
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
    primary_cnae_code:
      getValue(establishment, "primary_cnae_code", "cnae_principal") ??
      findFirstFromPaths(payloadSources, [["atividade_principal", "codigo"], ["atividade_principal", "id"], ["codigo_atividade_principal"]]),
    primary_cnae_description:
      getValue(establishment, "primary_cnae_description", "atividade_principal_descricao") ??
      findFirstFromPaths(payloadSources, [["atividade_principal", "descricao"], ["atividade_principal_descricao"], ["descricao_atividade_principal"]]),
    secondary_cnaes:
      getValue(establishment, "secondary_cnaes", "atividades_secundarias") ??
      readPath(payloadSources[0], ["atividade_secundaria"]) ??
      readPath(payloadSources[0], ["atividades_secundarias"]),
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
      findFirstFromPaths(payloadSources, [["simples", "optante"], ["simples_optante"]]),
    mei_opt_in:
      getValue(establishment, "mei_opt_in", "mei") ??
      findFirstFromPaths(payloadSources, [["mei", "optante"], ["mei_optante"]]),
    capital_social:
      getValue(establishment, "capital_social") ??
      findFirstFromPaths(payloadSources, [["capital_social"]]),
    email:
      getValue(establishment, "email") ??
      findFirstFromPaths(payloadSources, [["contato_email"], ["email"], ["contacts", "email"], ["contacts", "emails"]]),
    phone:
      getValue(establishment, "phone", "telefone") ??
      findFirstFromPaths(
        payloadSources,
        [["contato_telefonico"], ["telefone"], ["telefone1"], ["contacts", "telefone"], ["contacts", "telefones"]],
        extractPhoneText
      ),
    website:
      getValue(establishment, "website", "site") ??
      findFirstFromPaths(payloadSources, [["website"], ["site"], ["url"], ["contacts", "website"], ["contacts", "site"]]),
    country:
      getValue(establishment, "country", "pais") ??
      findFirstFromPaths(payloadSources, [["pais", "nome"], ["pais_nome"], ["pais"]]),
    state_code:
      getValue(establishment, "state_code", "uf") ??
      findFirstFromPaths(payloadSources, [["endereco", "uf"], ["uf"]]),
    city_name:
      getValue(establishment, "city_name", "cidade", "municipio") ??
      findFirstFromPaths(payloadSources, [["endereco", "municipio"], ["cidade_nome"], ["cidade"], ["municipio"]]),
    city_ibge:
      getValue(establishment, "city_ibge", "cidade_id", "ibge_id") ??
      findFirstFromPaths(payloadSources, [["endereco", "ibge", "codigo_municipio"], ["codigo_municipio_ibge"], ["cidade_id"], ["ibge_id"]]),
    cep:
      getValue(establishment, "cep") ??
      findFirstFromPaths(payloadSources, [["endereco", "cep"], ["cep"]]),
    neighborhood:
      getValue(establishment, "neighborhood", "bairro") ??
      findFirstFromPaths(payloadSources, [["endereco", "bairro"], ["bairro"]]),
    address_line: resolveAddressLine(establishment, payloadSources),
    address_number:
      getValue(establishment, "address_number", "numero") ??
      findFirstFromPaths(payloadSources, [["endereco", "numero"], ["numero"]]),
    complement:
      getValue(establishment, "complement", "complemento") ??
      findFirstFromPaths(payloadSources, [["endereco", "complemento"], ["complemento"]]),
    provider_payload: getValue(establishment, "provider_payload")
  };
}
