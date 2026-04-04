import { ReactNode } from "react";
import { formatCnpj, formatDate, formatDateTime, formatMoney } from "@/lib/format";
import {
  buildEstablishmentDetailSections,
  formatEstablishmentLabel
} from "@/lib/establishment-detail-sections";
import { buildDisplayEstablishment, getEstablishmentPayload } from "@/lib/establishment-presenter";
import { safeJsonStringify } from "@/lib/utils";

type EstablishmentDetailsProps = {
  establishment: Record<string, unknown>;
};

type SectionField = {
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

function formatLabel(key: string) {
  if (LABEL_OVERRIDES[key]) return LABEL_OVERRIDES[key];
  return formatEstablishmentLabel(key);
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

function formatCep(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 8) return value;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

function renderPrimitive(key: string, value: string | number | boolean): ReactNode {
  const loweredKey = key.toLowerCase();

  if (typeof value === "boolean") {
    return value ? "Sim" : "Não";
  }

  if (typeof value === "number") {
    if (loweredKey.includes("capital")) {
      return formatMoney(value);
    }

    return new Intl.NumberFormat("pt-BR").format(value);
  }

  const trimmed = value.trim();
  if (!trimmed) return "-";

  if (loweredKey.includes("capital")) {
    return formatMoney(trimmed);
  }

  if ((loweredKey.includes("cnpj") || loweredKey.includes("cnpj_root") || loweredKey.includes("cnpj_raiz")) && trimmed.replace(/\D/g, "").length >= 8) {
    return loweredKey === "cnpj" ? formatCnpj(trimmed) : trimmed;
  }

  if (loweredKey.includes("cep") && trimmed.replace(/\D/g, "").length === 8) {
    return formatCep(trimmed);
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

function renderSectionFields(fields: SectionField[], sectionKey: string) {
  return fields.map((field, index) => renderValueNode(field.label, field.key, field.value, `${sectionKey}-${index}-${field.key}`));
}

export function EstablishmentDetails({ establishment }: EstablishmentDetailsProps) {
  const displayEstablishment = buildDisplayEstablishment(establishment);
  const payload = getEstablishmentPayload(displayEstablishment);
  const rawJsonPayload = payload ?? displayEstablishment.provider_payload;
  const { primaryFields, contactFields } = buildEstablishmentDetailSections(displayEstablishment, rawJsonPayload);

  return (
    <div className="stack">
      <div className="grid-2">
        <div className="surface-soft card stack">
          <strong>Dados principais</strong>
          <div style={DETAILS_GRID_STYLE}>{renderSectionFields(primaryFields, "primary")}</div>
        </div>

        <div className="surface-soft card stack">
          <strong>Contato e endereço</strong>
          <div style={DETAILS_GRID_STYLE}>{renderSectionFields(contactFields, "contact")}</div>
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
