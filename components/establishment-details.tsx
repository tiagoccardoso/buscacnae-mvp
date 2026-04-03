import { ReactNode } from "react";
import { formatCnpj, formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { extractSingleObject, safeJsonStringify } from "@/lib/utils";

type EstablishmentDetailsProps = {
  establishment: Record<string, unknown>;
};

const LABEL_OVERRIDES: Record<string, string> = {
  cnpj: "CNPJ",
  cnpj_raiz: "Raiz do CNPJ",
  cnpj_ordem: "Ordem do CNPJ",
  cnpj_digito_verificador: "Dígito verificador",
  cpf_cnpj_socio: "CPF/CNPJ do sócio",
  razao_social: "Razão social",
  nome_fantasia: "Nome fantasia",
  capital_social: "Capital social",
  updated_at: "Atualizado em",
  atualizado_em: "Atualizado em",
  opened_at: "Abertura",
  data_inicio_atividade: "Início de atividade",
  data_situacao_cadastral: "Data da situação cadastral",
  data_situacao_especial: "Data da situação especial",
  cep: "CEP",
  uf: "UF",
  ibge_id: "IBGE",
  comex_id: "COMEX",
  iso2: "ISO2",
  iso3: "ISO3",
  ddd1: "DDD 1",
  ddd2: "DDD 2",
  ddd_fax: "DDD fax",
  telefone1: "Telefone 1",
  telefone2: "Telefone 2",
  atividade_principal: "Atividade principal",
  atividades_secundarias: "Atividades secundárias",
  inscricoes_estaduais: "Inscrições estaduais",
  natureza_juridica: "Natureza jurídica",
  qualificacao_do_responsavel: "Qualificação do responsável",
  qualificacao_socio: "Qualificação do sócio",
  qualificacao_representante: "Qualificação do representante",
  situacao_cadastral: "Situação cadastral",
  situacao_especial: "Situação especial",
  motivo_situacao_cadastral: "Motivo da situação cadastral",
  simples: "Simples Nacional",
  mei: "MEI",
  porte: "Porte",
  pais: "País",
  cidade: "Cidade",
  estado: "Estado",
  socio_nome: "Nome do sócio",
  socio_cpf_cnpj: "CPF/CNPJ do sócio",
  city_ibge: "IBGE da cidade",
  primary_cnae_code: "CNAE principal",
  primary_cnae_description: "Descrição do CNAE principal",
  legal_nature_code: "Código da natureza jurídica",
  legal_nature_description: "Natureza jurídica",
  company_size: "Porte",
  registration_status: "Status cadastral",
  trade_name: "Nome fantasia",
  company_name: "Razão social",
  state_code: "UF",
  city_name: "Cidade",
  address_line: "Logradouro",
  address_number: "Número",
  provider_payload: "Payload do provedor",
  casadosdados_pesquisa: "Casa dos Dados · Pesquisa",
  cnpjws_consulta: "CNPJ.ws · Consulta",
  erro_enriquecimento_cnpjws: "Erro no enriquecimento CNPJ.ws",
  resultados_enriquecidos: "Resultados enriquecidos",
  motor_principal: "Motor principal",
  complemento: "Complemento"
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

function formatLabel(key: string) {
  if (LABEL_OVERRIDES[key]) return LABEL_OVERRIDES[key];

  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((chunk) => {
      const upper = chunk.toUpperCase();
      if (["CNPJ", "CNAE", "CPF", "DDD", "CEP", "IBGE", "ISO", "MEI", "UF"].includes(upper)) {
        return upper;
      }
      return chunk.charAt(0).toUpperCase() + chunk.slice(1).toLowerCase();
    })
    .join(" ");
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isIsoDateTime(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value);
}

function looksLikeUrl(value: string) {
  return /^(https?:\/\/|www\.)/i.test(value);
}

function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function renderPrimitive(key: string, value: string | number | boolean): ReactNode {
  if (typeof value === "boolean") {
    return value ? "Sim" : "Não";
  }

  if (typeof value === "number") {
    if (key.toLowerCase().includes("capital")) {
      return formatMoney(value);
    }

    return new Intl.NumberFormat("pt-BR").format(value);
  }

  const trimmed = value.trim();
  if (!trimmed) return "-";

  if (key.toLowerCase().includes("capital_social")) {
    return formatMoney(trimmed);
  }

  if ((key === "cnpj" || key === "cnpj_raiz") && trimmed.replace(/\D/g, "").length >= 8) {
    return key === "cnpj" ? formatCnpj(trimmed) : trimmed;
  }

  if (isIsoDateTime(trimmed)) {
    return formatDateTime(trimmed);
  }

  if (isIsoDate(trimmed)) {
    return formatDate(trimmed);
  }

  if (looksLikeEmail(trimmed)) {
    return <a href={`mailto:${trimmed}`}>{trimmed}</a>;
  }

  if (looksLikeUrl(trimmed)) {
    const href = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {trimmed}
      </a>
    );
  }

  return trimmed;
}

function renderValueNode(label: string, key: string, value: unknown, path: string): ReactNode {
  if (!hasContent(value)) return null;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return (
      <div className="field-card" key={path}>
        <span className="kicker">{label}</span>
        <div className="field-card-value">{renderPrimitive(key, value)}</div>
      </div>
    );
  }

  if (Array.isArray(value)) {
    const items = value.filter((item) => hasContent(item));
    if (items.length === 0) return null;

    const primitiveItems = items.every(
      (item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean"
    );

    if (primitiveItems) {
      return (
        <div className="field-card field-card-full" key={path}>
          <span className="kicker">{label}</span>
          <div className="tag-list">
            {items.map((item, index) => (
              <span className="pill" key={`${path}-${index}`}>
                {typeof item === "string" || typeof item === "number" || typeof item === "boolean"
                  ? renderPrimitive(key, item)
                  : String(item)}
              </span>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="field-card field-card-full" key={path}>
        <span className="kicker">{label}</span>
        <div className="stack">
          {items.map((item, index) => {
            if (item && typeof item === "object" && !Array.isArray(item)) {
              return (
                <div className="surface-soft card stack" key={`${path}-${index}`}>
                  <strong>{`${label} ${index + 1}`}</strong>
                  <div className="details-grid">{renderObjectFields(item as Record<string, unknown>, `${path}-${index}`)}</div>
                </div>
              );
            }

            return (
              <div className="surface-soft card" key={`${path}-${index}`}>
                {String(item)}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (value && typeof value === "object") {
    return (
      <div className="field-card field-card-full" key={path}>
        <span className="kicker">{label}</span>
        <div className="details-grid">{renderObjectFields(value as Record<string, unknown>, path)}</div>
      </div>
    );
  }

  return null;
}

function renderObjectFields(record: Record<string, unknown>, path = "root", omitKeys: string[] = []) {
  return Object.entries(record)
    .filter(([key, value]) => !omitKeys.includes(key) && hasContent(value))
    .map(([key, value]) => renderValueNode(formatLabel(key), key, value, `${path}-${key}`));
}

function readPayload(establishment: Record<string, unknown>) {
  const payload = establishment.provider_payload;
  const objectPayload = extractSingleObject(payload);
  if (!objectPayload) return null;
  return objectPayload;
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

function collectPayloadSources(establishment: Record<string, unknown>) {
  const payload = readPayload(establishment);
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

function buildDisplayEstablishment(establishment: Record<string, unknown>) {
  const payloadSources = collectPayloadSources(establishment);

  return {
    ...establishment,
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
    company_size:
      getValue(establishment, "company_size", "porte") ??
      findFirstFromPaths(payloadSources, [["porte_empresa", "descricao"], ["porte", "descricao"], ["porte"]]),
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
    cep:
      getValue(establishment, "cep") ??
      findFirstFromPaths(payloadSources, [["endereco", "cep"], ["cep"]]),
    neighborhood:
      getValue(establishment, "neighborhood", "bairro") ??
      findFirstFromPaths(payloadSources, [["endereco", "bairro"], ["bairro"]]),
    city_name:
      getValue(establishment, "city_name", "cidade", "municipio") ??
      findFirstFromPaths(payloadSources, [["endereco", "municipio"], ["cidade_nome"], ["cidade"], ["municipio"]]),
    state_code:
      getValue(establishment, "state_code", "uf") ??
      findFirstFromPaths(payloadSources, [["endereco", "uf"], ["uf"]]),
    address_line: resolveAddressLine(establishment, payloadSources),
    address_number:
      getValue(establishment, "address_number", "numero") ??
      findFirstFromPaths(payloadSources, [["endereco", "numero"], ["numero"]]),
    complement:
      getValue(establishment, "complement", "complemento") ??
      findFirstFromPaths(payloadSources, [["endereco", "complemento"], ["complemento"]])
  } satisfies Record<string, unknown>;
}

function stringifySecondaryCnaes(value: unknown) {
  if (!hasContent(value)) return "-";
  if (Array.isArray(value)) {
    const readable = value
      .map((item) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const objectItem = item as Record<string, unknown>;
          return String(objectItem.descricao ?? objectItem.id ?? objectItem.codigo ?? JSON.stringify(item));
        }
        return String(item);
      })
      .filter(Boolean);

    return readable.length > 0 ? readable.join(" • ") : "-";
  }

  return String(value);
}

function formatTextLine(value: unknown) {
  if (!hasContent(value)) return "-";

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "-";
    if (isIsoDateTime(trimmed)) return formatDateTime(trimmed);
    if (isIsoDate(trimmed)) return formatDate(trimmed);
    return trimmed;
  }

  if (typeof value === "number") {
    return new Intl.NumberFormat("pt-BR").format(value);
  }

  if (typeof value === "boolean") {
    return value ? "Sim" : "Não";
  }

  return String(value);
}

function formatAddressSummary(establishment: Record<string, unknown>) {
  const line = formatTextLine(getValue(establishment, "address_line", "logradouro"));
  const number = formatTextLine(getValue(establishment, "address_number", "numero"));
  const complement = formatTextLine(getValue(establishment, "complement", "complemento"));

  const parts = [line !== "-" ? line : "", number !== "-" ? number : "", complement !== "-" ? complement : ""]
    .filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : "-";
}

export function EstablishmentDetails({ establishment }: EstablishmentDetailsProps) {
  const displayEstablishment = buildDisplayEstablishment(establishment);
  const payload = readPayload(displayEstablishment);

  return (
    <div className="stack">
      <div className="grid-2">
        <div className="surface-soft card stack">
          <strong>Dados principais</strong>
          <span className="muted">Nome fantasia: {formatTextLine(getValue(displayEstablishment, "trade_name", "nome_fantasia"))}</span>
          <span className="muted">Status cadastral: {formatTextLine(getValue(displayEstablishment, "registration_status", "situacao_cadastral"))}</span>
          <span className="muted">CNAE principal: {formatTextLine(getValue(displayEstablishment, "primary_cnae_code", "cnae_principal"))}</span>
          <span className="muted">Descrição CNAE: {formatTextLine(getValue(displayEstablishment, "primary_cnae_description", "atividade_principal_descricao"))}</span>
          <span className="muted">Abertura: {formatTextLine(getValue(displayEstablishment, "opened_at", "data_abertura", "data_inicio_atividade"))}</span>
          <span className="muted">Capital social: {formatMoney(getValue(displayEstablishment, "capital_social") as string | number | null)}</span>
        </div>

        <div className="surface-soft card stack">
          <strong>Contato e endereço</strong>
          <span className="muted">Email: {formatTextLine(getValue(displayEstablishment, "email"))}</span>
          <span className="muted">Telefone: {formatTextLine(getValue(displayEstablishment, "phone", "telefone"))}</span>
          <span className="muted">Site: {formatTextLine(getValue(displayEstablishment, "website", "site"))}</span>
          <span className="muted">CEP: {formatTextLine(getValue(displayEstablishment, "cep"))}</span>
          <span className="muted">Bairro: {formatTextLine(getValue(displayEstablishment, "neighborhood", "bairro"))}</span>
          <span className="muted">Endereço: {formatAddressSummary(displayEstablishment)}</span>
        </div>
      </div>

      <div className="surface-soft card stack">
        <strong>Campos normalizados da pesquisa</strong>
        <div className="details-grid">{renderObjectFields(displayEstablishment, "normalized", ["id", "created_at", "updated_at", "provider_payload"])}</div>
      </div>

      <div className="surface-soft card stack">
        <strong>Atividades</strong>
        <span className="muted">
          CNAE principal: {String(getValue(displayEstablishment, "primary_cnae_code") ?? "-")} · {String(getValue(displayEstablishment, "primary_cnae_description") ?? "-")}
        </span>
        <span className="muted">CNAEs secundários: {stringifySecondaryCnaes(getValue(displayEstablishment, "secondary_cnaes"))}</span>
      </div>

      {payload ? (
        <div className="surface-soft card stack">
          <strong>Todos os campos retornados pela API</strong>
          <div className="details-grid">{renderObjectFields(payload, "payload")}</div>
          <div className="stack" style={{ gap: 10 }}>
            <span className="kicker">Dados brutos formatados (JSON)</span>
            <pre className="payload-json-block">{safeJsonStringify(payload, 2)}</pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
