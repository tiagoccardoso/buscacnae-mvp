import { ReactNode } from "react";
import { formatCnpj, formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { buildDisplayEstablishment, getEstablishmentPayload } from "@/lib/establishment-presenter";
import { flattenUnknownToRows, safeJsonStringify } from "@/lib/utils";

type EstablishmentDetailsProps = {
  establishment: Record<string, unknown>;
};

type LabeledField = {
  label: string;
  key: string;
  value: unknown;
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

const DETAILS_GRID_STYLE = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12
} as const;

const DETAIL_CARD_STYLE = {
  borderRadius: 16,
  border: "1px solid rgba(255, 255, 255, 0.08)",
  background: "rgba(7, 16, 37, 0.42)",
  padding: 14,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  minWidth: 0
} as const;

const DETAIL_CARD_FULL_STYLE = {
  ...DETAIL_CARD_STYLE,
  gridColumn: "1 / -1"
} as const;

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

function formatPathLabel(path: string) {
  if (!path || path === "(raiz)") return "Raiz";

  return path
    .split(".")
    .filter(Boolean)
    .map((segment) => {
      const parts: string[] = [];
      const matcher = /([^\[\]]+)|(\[(\d+)\])/g;
      let match: RegExpExecArray | null;

      while ((match = matcher.exec(segment)) !== null) {
        if (match[1]) {
          parts.push(formatLabel(match[1]));
        } else if (typeof match[3] === "string") {
          parts.push(`Item ${Number(match[3]) + 1}`);
        }
      }

      return parts.join(" · ");
    })
    .filter(Boolean)
    .join(" → ");
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

function renderArrayValue(key: string, value: unknown[], path: string) {
  const items = value.filter((item) => hasContent(item));
  if (items.length === 0) return null;

  return (
    <div style={DETAIL_CARD_FULL_STYLE} key={path}>
      <span className="kicker">{formatLabel(key)}</span>
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

function renderValueNode(label: string, key: string, value: unknown, path: string): ReactNode {
  if (!hasContent(value)) return null;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return (
      <div key={path} style={DETAIL_CARD_STYLE}>
        <span className="kicker">{label}</span>
        <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{renderPrimitive(key, value)}</div>
      </div>
    );
  }

  if (Array.isArray(value)) {
    return renderArrayValue(key, value, path);
  }

  if (value && typeof value === "object") {
    return (
      <div key={path} style={DETAIL_CARD_FULL_STYLE}>
        <span className="kicker">{label}</span>
        <div style={DETAILS_GRID_STYLE}>{renderObjectFields(value as Record<string, unknown>, path)}</div>
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

function renderInlineFieldValue(key: string, value: unknown, establishment?: Record<string, unknown>) {
  if (key === "secondary_cnaes") {
    return stringifySecondaryCnaes(value);
  }

  if (key === "address_summary") {
    return establishment ? formatAddressSummary(establishment) : "-";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return renderPrimitive(key, value);
  }

  if (!hasContent(value)) {
    return "-";
  }

  if (Array.isArray(value)) {
    return safeJsonStringify(value, 0);
  }

  if (value && typeof value === "object") {
    return safeJsonStringify(value, 0);
  }

  return String(value);
}

function renderLabeledFields(fields: LabeledField[], sectionKey: string, establishment?: Record<string, unknown>) {
  return fields.map((field, index) => (
    <span className="muted" key={`${sectionKey}-${index}-${field.key}`}>
      {field.label}: {renderInlineFieldValue(field.key, field.value, establishment)}
    </span>
  ));
}

function renderFlattenedRows(rows: Array<{ path: string; value: string }>, path = "normalized-raw") {
  return rows.map((item, index) =>
    renderValueNode(formatPathLabel(item.path), item.path, item.value, `${path}-${index}-${item.path}`)
  );
}

export function EstablishmentDetails({ establishment }: EstablishmentDetailsProps) {
  const displayEstablishment = buildDisplayEstablishment(establishment);
  const payload = getEstablishmentPayload(displayEstablishment);
  const rawJsonPayload = payload ?? displayEstablishment.provider_payload;
  const flattenedPayload = hasContent(rawJsonPayload) ? flattenUnknownToRows(rawJsonPayload) : [];

  const primaryFields: LabeledField[] = [
    { label: "CNPJ", key: "cnpj", value: getValue(displayEstablishment, "cnpj") },
    { label: "Raiz do CNPJ", key: "cnpj_root", value: getValue(displayEstablishment, "cnpj_root", "cnpj_raiz") },
    { label: "Razão social", key: "company_name", value: getValue(displayEstablishment, "company_name", "razao_social") },
    { label: "Nome fantasia", key: "trade_name", value: getValue(displayEstablishment, "trade_name", "nome_fantasia") },
    { label: "Status cadastral", key: "registration_status", value: getValue(displayEstablishment, "registration_status", "situacao_cadastral") },
    { label: "Abertura", key: "opened_at", value: getValue(displayEstablishment, "opened_at", "data_abertura", "data_inicio_atividade") },
    { label: "CNAE principal", key: "primary_cnae_code", value: getValue(displayEstablishment, "primary_cnae_code", "cnae_principal") },
    {
      label: "Descrição do CNAE principal",
      key: "primary_cnae_description",
      value: getValue(displayEstablishment, "primary_cnae_description", "atividade_principal_descricao")
    },
    { label: "CNAEs secundários", key: "secondary_cnaes", value: getValue(displayEstablishment, "secondary_cnaes", "atividades_secundarias") },
    { label: "Código da natureza jurídica", key: "legal_nature_code", value: getValue(displayEstablishment, "legal_nature_code", "natureza_juridica_id") },
    {
      label: "Natureza jurídica",
      key: "legal_nature_description",
      value: getValue(displayEstablishment, "legal_nature_description", "natureza_juridica")
    },
    { label: "Porte", key: "company_size", value: getValue(displayEstablishment, "company_size", "porte") },
    { label: "Simples", key: "simples_opt_in", value: getValue(displayEstablishment, "simples_opt_in", "simples") },
    { label: "MEI", key: "mei_opt_in", value: getValue(displayEstablishment, "mei_opt_in", "mei") },
    { label: "Capital social", key: "capital_social", value: getValue(displayEstablishment, "capital_social") }
  ];

  const contactFields: LabeledField[] = [
    { label: "E-mail", key: "email", value: getValue(displayEstablishment, "email") },
    { label: "Telefone", key: "phone", value: getValue(displayEstablishment, "phone", "telefone") },
    { label: "Site", key: "website", value: getValue(displayEstablishment, "website", "site") },
    { label: "País", key: "country", value: getValue(displayEstablishment, "country", "pais") },
    { label: "UF", key: "state_code", value: getValue(displayEstablishment, "state_code", "uf") },
    { label: "Cidade", key: "city_name", value: getValue(displayEstablishment, "city_name", "cidade", "municipio") },
    { label: "IBGE da cidade", key: "city_ibge", value: getValue(displayEstablishment, "city_ibge", "cidade_id", "ibge_id") },
    { label: "Bairro", key: "neighborhood", value: getValue(displayEstablishment, "neighborhood", "bairro") },
    { label: "CEP", key: "cep", value: getValue(displayEstablishment, "cep") },
    { label: "Logradouro", key: "address_line", value: getValue(displayEstablishment, "address_line", "logradouro") },
    { label: "Número", key: "address_number", value: getValue(displayEstablishment, "address_number", "numero") },
    { label: "Complemento", key: "complement", value: getValue(displayEstablishment, "complement", "complemento") },
    { label: "Endereço completo", key: "address_summary", value: true }
  ];

  return (
    <div className="stack">
      <div className="grid-2">
        <div className="surface-soft card stack">
          <strong>Dados principais</strong>
          {renderLabeledFields(primaryFields, "primary", displayEstablishment)}
        </div>

        <div className="surface-soft card stack">
          <strong>Contato e endereço</strong>
          {renderLabeledFields(contactFields, "contact", displayEstablishment)}
        </div>
      </div>

      <div className="surface-soft card stack">
        <strong>Campos normalizados da pesquisa</strong>
        <div className="stack" style={{ gap: 18 }}>
          <div className="stack" style={{ gap: 12 }}>
            <span className="kicker">Campos consolidados</span>
            <div style={DETAILS_GRID_STYLE}>
              {renderObjectFields(displayEstablishment, "normalized", ["id", "created_at", "updated_at", "provider_payload"])}
            </div>
          </div>

          {flattenedPayload.length > 0 ? (
            <div className="stack" style={{ gap: 12 }}>
              <span className="kicker">Campos vindos dos dados brutos do JSON</span>
              <div style={DETAILS_GRID_STYLE}>{renderFlattenedRows(flattenedPayload)}</div>
            </div>
          ) : null}
        </div>
      </div>

      {hasContent(rawJsonPayload) ? (
        <div className="surface-soft card stack">
          <strong>Dados brutos formatados (JSON)</strong>
          <pre className="payload-json-block">{safeJsonStringify(rawJsonPayload, 2)}</pre>
        </div>
      ) : null}
    </div>
  );
}
