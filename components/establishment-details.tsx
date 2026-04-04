import { ReactNode } from "react";
import { formatCnpj, formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { buildDisplayEstablishment, getEstablishmentPayload } from "@/lib/establishment-presenter";
import { flattenUnknownToRows, safeJsonStringify } from "@/lib/utils";

type EstablishmentDetailsProps = {
  establishment: Record<string, unknown>;
};

const LABEL_OVERRIDES: Record<string, string> = {
  cnpj: "CNPJ",
  cnpj_root: "Raiz do CNPJ",
  razao_social: "Razão social",
  nome_fantasia: "Nome fantasia",
  capital_social: "Capital social",
  opened_at: "Abertura",
  cep: "CEP",
  uf: "UF",
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
  complement: "Complemento"
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

  if ((key === "cnpj" || key === "cnpj_raiz" || key === "cnpj_root") && trimmed.replace(/\D/g, "").length >= 8) {
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

    return (
      <div className="field-card field-card-full" key={path}>
        <span className="kicker">{label}</span>
        <div className="tag-list">
          {items.map((item, index) => (
            <span className="pill" key={`${path}-${index}`}>
              {typeof item === "string" || typeof item === "number" || typeof item === "boolean"
                ? renderPrimitive(key, item)
                : safeJsonStringify(item, 0)}
            </span>
          ))}
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

function stringifySecondaryCnaes(value: unknown) {
  if (!hasContent(value)) return "-";
  if (Array.isArray(value)) {
    const readable = value
      .map((item) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const objectItem = item as Record<string, unknown>;
          return String(objectItem.descricao ?? objectItem.id ?? objectItem.codigo ?? safeJsonStringify(item, 0));
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
  const payload = getEstablishmentPayload(displayEstablishment);
  const flattenedPayload = payload ? flattenUnknownToRows(payload) : [];

  return (
    <div className="stack">
      <div className="grid-2">
        <div className="surface-soft card stack">
          <strong>Dados principais</strong>
          <span className="muted">Razão social: {formatTextLine(getValue(displayEstablishment, "company_name", "razao_social"))}</span>
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
          <span className="muted">Cidade/UF: {formatTextLine(getValue(displayEstablishment, "city_name"))} / {formatTextLine(getValue(displayEstablishment, "state_code"))}</span>
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
          <strong>Dados brutos organizados</strong>
          <div className="raw-data-table-wrap">
            <table className="table table-premium raw-data-table">
              <thead>
                <tr>
                  <th>Campo bruto</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {flattenedPayload.map((item) => (
                  <tr key={`${item.path}-${item.value}`}>
                    <td>{item.path}</td>
                    <td>{item.value || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="stack" style={{ gap: 10 }}>
            <span className="kicker">Dados brutos formatados (JSON)</span>
            <pre className="payload-json-block">{safeJsonStringify(payload, 2)}</pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
