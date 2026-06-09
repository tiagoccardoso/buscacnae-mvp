import { flattenUnknownToRows, safeJsonStringify } from "@/lib/utils";

export type EstablishmentDetailField = {
  label: string;
  key: string;
  value: unknown;
  path?: string;
  source: "display" | "raw";
};

const OMIT_DISPLAY_KEYS = new Set(["id", "created_at", "updated_at", "provider_payload"]);
const OMIT_RAW_PATH_SUFFIXES = new Set(["capital_social"]);
const WRAPPER_SEGMENTS = new Set([
  "provider_payload",
  "cnpjws_consulta",
  "consulta_cnpj",
  "casadosdados_pesquisa",
  "casadosdados_detalhe",
  "pesquisa",
  "search_result_payload",
  "normalized",
  "organized"
]);

const PRIMARY_ORDER: Array<{ key: string; label: string }> = [
  { key: "cnpj", label: "CNPJ" },
  { key: "cnpj_root", label: "Raiz do CNPJ" },
  { key: "company_name", label: "Razão social" },
  { key: "trade_name", label: "Nome fantasia" },
  { key: "registration_status", label: "Status cadastral" },
  { key: "opened_at", label: "Abertura" },
  { key: "primary_cnae_code", label: "CNAE principal" },
  { key: "primary_cnae_description", label: "Descrição do CNAE principal" },
  { key: "secondary_cnaes", label: "CNAEs secundários" },
  { key: "legal_nature_code", label: "Código da natureza jurídica" },
  { key: "legal_nature_description", label: "Natureza jurídica" },
  { key: "company_size", label: "Porte" },
  { key: "simples_opt_in", label: "Simples" },
  { key: "mei_opt_in", label: "MEI" },
  { key: "capital_social", label: "Capital social" },
  { key: "email", label: "E-mail" },
  { key: "phone", label: "Telefone" },
  { key: "website", label: "Site" },
  { key: "country", label: "País" },
  { key: "state_code", label: "UF" },
  { key: "city_name", label: "Cidade" },
  { key: "city_ibge", label: "IBGE da cidade" },
  { key: "neighborhood", label: "Bairro" },
  { key: "cep", label: "CEP" },
  { key: "address_line", label: "Logradouro" },
  { key: "address_number", label: "Número" },
  { key: "complement", label: "Complemento" },
  { key: "address_summary", label: "Endereço completo" }
];

function hasContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((item) => hasContent(item));
  if (typeof value === "object") return Object.values(value).some((item) => hasContent(item));
  return true;
}

function normalizeComparableText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buildComparableValue(key: string, value: unknown) {
  const raw =
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : safeJsonStringify(value, 0);

  const loweredKey = normalizeComparableText(key);
  if (/capital/.test(loweredKey)) {
    const digits = raw.replace(/\D/g, "");
    return digits || normalizeComparableText(raw);
  }

  if (/cnpj|cep|ibge|telefone|phone|numero|número/.test(loweredKey)) {
    const digits = raw.replace(/\D/g, "");
    return digits || normalizeComparableText(raw);
  }

  return normalizeComparableText(raw);
}

export function formatEstablishmentLabel(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((chunk) => {
      const upper = chunk.toUpperCase();
      if (["CNPJ", "CNAE", "CPF", "DDD", "CEP", "IBGE", "ISO", "MEI", "UF", "JSON"].includes(upper)) {
        return upper;
      }
      if (upper === "ID") return "ID";
      return chunk.charAt(0).toUpperCase() + chunk.slice(1).toLowerCase();
    })
    .join(" ");
}

function simplifyPath(path: string) {
  if (!path) return path;

  const segments = path.split(".").filter(Boolean);
  const simplified = segments.filter((segment) => !WRAPPER_SEGMENTS.has(segment.replace(/\[\d+\]/g, "")));

  return simplified.join(".") || path;
}

export function formatEstablishmentPathLabel(path: string) {
  const simplifiedPath = simplifyPath(path);
  if (!simplifiedPath || simplifiedPath === "(raiz)") return "Raiz";

  return simplifiedPath
    .split(".")
    .filter(Boolean)
    .map((segment) => {
      const parts: string[] = [];
      const matcher = /([^\[\]]+)|(\[(\d+)\])/g;
      let match: RegExpExecArray | null;

      while ((match = matcher.exec(segment)) !== null) {
        if (match[1]) {
          parts.push(formatEstablishmentLabel(match[1]));
        } else if (typeof match[3] === "string") {
          parts.push(`Item ${Number(match[3]) + 1}`);
        }
      }

      return parts.join(" · ");
    })
    .filter(Boolean)
    .join(" → ");
}

function cleanAddressPart(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function formatCepPart(value: unknown) {
  const raw = cleanAddressPart(value);
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 8) return raw;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export function buildAddressSummary(establishment: Record<string, unknown>) {
  const addressLine = cleanAddressPart(establishment.address_line);
  const addressNumber = cleanAddressPart(establishment.address_number);
  const complement = cleanAddressPart(establishment.complement);
  const neighborhood = cleanAddressPart(establishment.neighborhood);
  const cityName = cleanAddressPart(establishment.city_name);
  const stateCode = cleanAddressPart(establishment.state_code).toUpperCase();
  const cep = formatCepPart(establishment.cep);

  const hasNumberInLine = addressNumber ? addressLine.includes(addressNumber) : false;
  const cityState = cityName && stateCode ? `${cityName}/${stateCode}` : cityName || stateCode;

  const parts = [
    addressLine,
    addressNumber && !hasNumberInLine ? addressNumber : "",
    complement,
    neighborhood,
    cityState,
    cep ? `CEP ${cep}` : ""
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : null;
}

export function buildEstablishmentDetailSections(
  displayEstablishment: Record<string, unknown>,
  rawJsonPayload: unknown
) {
  const primaryFields: EstablishmentDetailField[] = [];
  const contactFields: EstablishmentDetailField[] = [];
  const seenSignatures = new Set<string>();
  const usedDisplayKeys = new Set<string>();

  const push = (
    target: EstablishmentDetailField[],
    field: Omit<EstablishmentDetailField, "source"> & { source?: "display" | "raw" }
  ) => {
    if (!hasContent(field.value)) return;

    const signature = [
      target === contactFields ? "contact" : "primary",
      normalizeComparableText(field.label),
      buildComparableValue(field.key || field.label, field.value)
    ].join("|");

    if (seenSignatures.has(signature)) return;
    seenSignatures.add(signature);

    target.push({
      label: field.label,
      key: field.key,
      value: field.value,
      path: field.path,
      source: field.source ?? "display"
    });
  };

  for (const field of PRIMARY_ORDER) {
    usedDisplayKeys.add(field.key);
    push(primaryFields, {
      label: field.label,
      key: field.key,
      value: field.key === "address_summary" ? buildAddressSummary(displayEstablishment) : displayEstablishment[field.key]
    });
  }

  for (const [key, value] of Object.entries(displayEstablishment)) {
    if (OMIT_DISPLAY_KEYS.has(key) || usedDisplayKeys.has(key)) continue;

    push(primaryFields, {
      label: formatEstablishmentLabel(key),
      key,
      value
    });
  }

  const flattenedPayload = hasContent(rawJsonPayload) ? flattenUnknownToRows(rawJsonPayload) : [];
  for (const row of flattenedPayload) {
    if (!hasContent(row.value)) continue;

    const simplifiedPath = simplifyPath(row.path);
    const pathSegments = (simplifiedPath || row.path)
      .split(".")
      .map((segment) => segment.replace(/\[\d+\]/g, ""))
      .filter(Boolean);
    const pathSuffix = pathSegments[pathSegments.length - 1] ?? "";

    if (OMIT_RAW_PATH_SUFFIXES.has(pathSuffix)) continue;

    push(primaryFields, {
      label: formatEstablishmentPathLabel(simplifiedPath),
      key: simplifiedPath || row.path,
      value: row.value,
      path: simplifiedPath || row.path,
      source: "raw"
    });
  }

  return {
    primaryFields,
    contactFields
  };
}
