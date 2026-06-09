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

type FieldGroup = {
  title: string;
  description?: string;
  fields: SectionField[];
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

const PANEL_STYLE = {
  borderRadius: 18,
  border: "1px solid rgba(255, 255, 255, 0.08)",
  background: "rgba(7, 16, 37, 0.36)",
  padding: 18,
  display: "grid",
  gap: 14
} as const;

const FIELD_ROW_STYLE = {
  borderRadius: 14,
  border: "1px solid rgba(255, 255, 255, 0.08)",
  background: "rgba(255, 255, 255, 0.03)",
  padding: "12px 14px",
  display: "grid",
  gap: 6
} as const;

const GROUP_STYLE = {
  display: "grid",
  gap: 12,
  alignContent: "start"
} as const;

const GROUP_GRID_STYLE = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: 18
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

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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
  const loweredKey = normalizeText(key);

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

  if ((loweredKey.includes("cnpj") || loweredKey.includes("cnpj raiz")) && trimmed.replace(/\D/g, "").length >= 8) {
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

function renderStructuredValue(key: string, value: unknown, path: string): ReactNode {
  if (!hasContent(value)) return <span>-</span>;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <span>{renderPrimitive(key, value)}</span>;
  }

  if (Array.isArray(value)) {
    const items = value.filter((item) => hasContent(item));
    if (items.length === 0) return <span>-</span>;

    return (
      <div style={{ display: "grid", gap: 8 }}>
        {items.map((item, index) => (
          <div key={`${path}-${index}`} style={{ ...FIELD_ROW_STYLE, padding: "10px 12px" }}>
            {typeof item === "string" || typeof item === "number" || typeof item === "boolean"
              ? renderPrimitive(key, item)
              : <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{safeJsonStringify(item, 2)}</pre>}
          </div>
        ))}
      </div>
    );
  }

  return <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{safeJsonStringify(value, 2)}</pre>;
}

function buildFieldGroups(fields: SectionField[]): FieldGroup[] {
  const groupDefinitions: Array<{ title: string; description?: string; matchers: string[] }> = [
    {
      title: "Identificação da empresa",
      description: "Dados centrais do cadastro para localizar e reconhecer o estabelecimento.",
      matchers: ["cnpj", "razao social", "company name", "nome fantasia", "trade name", "registration status", "status cadastral", "abertura", "opened at"]
    },
    {
      title: "Atividades e enquadramento",
      description: "Classificação econômica, natureza jurídica, porte e regime tributário.",
      matchers: ["cnae", "atividade", "natureza juridica", "legal nature", "porte", "company size", "simples", "mei", "capital social"]
    },
    {
      title: "Contato",
      description: "Canais diretos para prospecção e contato comercial.",
      matchers: ["email", "mail", "telefone", "phone", "celular", "whatsapp", "site", "website", "url", "contact"]
    },
    {
      title: "Endereço e localização",
      description: "Informações do endereço físico e códigos de localização.",
      matchers: ["pais", "country", "uf", "estado", "state", "cidade", "city", "municipio", "bairro", "cep", "logradouro", "numero", "número", "complemento", "endereco", "endereço", "ibge", "address"]
    },
    {
      title: "Quadro societário",
      description: "Sócios, administradores e demais vínculos societários quando retornados pelo provedor.",
      matchers: ["quadro societario", "quadro de socios", "socio", "sócio", "socios", "sócios", "qsa", "administrador", "qualificacao", "qualificação", "partner", "shareholder"]
    }
  ];

  const buckets = groupDefinitions.map((group) => ({ ...group, fields: [] as SectionField[] }));
  const leftovers: SectionField[] = [];

  for (const field of fields) {
    const haystack = `${field.label} ${field.key}`;
    const normalized = normalizeText(haystack);
    const bucket = buckets.find((group) =>
      group.matchers.some((matcher) => normalized.includes(normalizeText(matcher)))
    );

    if (bucket) {
      bucket.fields.push(field);
    } else {
      leftovers.push(field);
    }
  }

  const groups: FieldGroup[] = buckets
    .filter((group) => group.fields.length > 0)
    .map((group) => ({
      title: group.title,
      description: group.description,
      fields: group.fields
    }));

  if (leftovers.length > 0) {
    groups.push({
      title: "Outras informações extraídas do JSON",
      description: "Campos adicionais encontrados no JSON bruto e consolidados na ficha principal.",
      fields: leftovers
    });
  }

  return groups;
}

function renderFieldRow(field: SectionField, index: number, groupKey: string) {
  return (
    <div key={`${groupKey}-${index}-${field.key}`} style={FIELD_ROW_STYLE}>
      <span className="kicker">{field.label}</span>
      <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.65 }}>
        {renderStructuredValue(field.key, field.value, `${groupKey}-${index}-${field.key}`)}
      </div>
    </div>
  );
}

export function EstablishmentDetails({ establishment }: EstablishmentDetailsProps) {
  const displayEstablishment = buildDisplayEstablishment(establishment);
  const payload = getEstablishmentPayload(displayEstablishment);
  const rawJsonPayload = payload ?? displayEstablishment.provider_payload;
  const { primaryFields } = buildEstablishmentDetailSections(displayEstablishment, rawJsonPayload);
  const groupedFields = buildFieldGroups(primaryFields);

  return (
    <div className="stack">
      <div className="surface-soft card stack">
        <div className="stack" style={{ gap: 8 }}>
          <strong>Dados principais</strong>
          <span className="muted" style={{ lineHeight: 1.7 }}>
            Todas as informações consolidadas da pesquisa e do JSON bruto foram reunidas abaixo em uma leitura única.
          </span>
        </div>

        <div style={GROUP_GRID_STYLE}>
          {groupedFields.map((group) => (
            <section key={group.title} style={PANEL_STYLE}>
              <div style={GROUP_STYLE}>
                <div className="stack" style={{ gap: 4 }}>
                  <strong style={{ fontSize: "1rem" }}>{group.title}</strong>
                  {group.description ? <span className="muted" style={{ lineHeight: 1.6 }}>{group.description}</span> : null}
                </div>
                <div style={GROUP_STYLE}>
                  {group.fields.map((field, index) => renderFieldRow(field, index, group.title))}
                </div>
              </div>
            </section>
          ))}
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
