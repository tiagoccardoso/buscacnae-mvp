import { formatCnaeCode, normalizeCnaeCode } from "@/lib/cnae-utils";
import { parseSecondaryCnaes, resolveHeadquartersOrBranch } from "@/lib/company-model";
import { cleanString, normalizeCnpjValue, normalizeIbgeCode, normalizeUf } from "@/lib/data-quality/normalize";
import { foldSearchText, stripPersonalIdentifiers } from "@/lib/search/text";

/**
 * Documento do índice de empresas (Fase 7).
 *
 * O índice é um MECANISMO DE PESQUISA, não fonte de verdade: guarda somente o que é
 * necessário para encontrar a empresa e decidir se vale abri-la. A ficha continua
 * lendo `establishments` e revalidando na Casa dos Dados.
 *
 * Lista branca (tudo que não está aqui NÃO é indexado):
 *   identificação cadastral pública — CNPJ, raiz, razão social (sem CPF de MEI), nome fantasia,
 *   situação, matriz/filial, porte, ano de abertura, CNAE principal/secundários, município, UF.
 * Nunca indexado:
 *   e-mail, telefone, site, endereço, CEP, bairro, capital social, sócios, payload bruto do provedor.
 *   Contato é o produto pago do BuscaCNAE e dado potencialmente pessoal (LGPD).
 */
export type CompanySearchDocument = {
  id: string;
  cnpj: string;
  cnpjRoot: string;
  legalName: string;
  tradeName: string | null;
  primaryCnae: string | null;
  primaryCnaeLabel: string | null;
  cnaeClass: string | null;
  cnaeDivision: string | null;
  secondaryCnaes: string[];
  city: string | null;
  cityIbge: string | null;
  stateCode: string | null;
  registrationStatus: string | null;
  headquarters: "matriz" | "filial" | null;
  companySize: string | null;
  openedYear: number | null;
  /** Quem pode ver o documento (listas liberadas/salvas do usuário). */
  profileIds: string[];
  /** Workspaces do CRM que têm negócio com a empresa. */
  workspaceIds: string[];
  /** Origem do dado (o índice só replica; nunca é a origem). */
  source: "casadosdados";
  /** Epoch (s) em que o dado foi obtido na fonte. */
  sourceFetchedAt: number;
  /** Epoch (s) em que o documento foi (re)gerado. */
  indexedAt: number;
  /** Epoch (s) após o qual o documento deixa de ser servido e é removido. */
  expiresAt: number;
};

export type CompanyVisibility = { profileIds: string[]; workspaceIds: string[] };

function readString(row: Record<string, unknown>, key: string) {
  return cleanString(row[key]);
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  value = parseJsonValue(value);
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function toEpochSeconds(value: unknown): number | null {
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
  }
  return null;
}

function normalizeStatus(value: string | null) {
  if (!value) return null;
  const folded = foldSearchText(value).toUpperCase();
  return folded || null;
}

function uniqueSorted(values: Iterable<string>) {
  return Array.from(new Set(Array.from(values).map((value) => value.trim()).filter(Boolean))).sort();
}

/**
 * Data em que o dado veio da Casa dos Dados: consulta detalhada salva no payload,
 * senão a última gravação do estabelecimento, senão o momento em que a mudança foi enfileirada.
 */
export function resolveSourceFetchedAt(row: Record<string, unknown>, fallbackEpoch: number) {
  const payload = readRecord(row.provider_payload);
  const candidates = [payload?.casadosdados_detalhe_em, row.updated_at, row.created_at];
  let best: number | null = null;
  for (const candidate of candidates) {
    const epoch = toEpochSeconds(candidate);
    if (epoch !== null && (best === null || epoch > best)) best = epoch;
  }
  return best ?? fallbackEpoch;
}

/**
 * Linha de `establishments` → documento do índice. Retorna null quando não há CNPJ válido
 * ou quando ninguém pode ver a empresa (documento sem dono não é indexado).
 */
export function toCompanySearchDocument(
  row: Record<string, unknown>,
  visibility: CompanyVisibility,
  options: { nowEpoch: number; ttlDays: number }
): CompanySearchDocument | null {
  const cnpj = normalizeCnpjValue(row.cnpj);
  if (!cnpj) return null;
  const profileIds = uniqueSorted(visibility.profileIds);
  const workspaceIds = uniqueSorted(visibility.workspaceIds);
  if (profileIds.length === 0 && workspaceIds.length === 0) return null;

  const legalName = stripPersonalIdentifiers(readString(row, "company_name")) ?? "Sem razão social";
  const tradeName = stripPersonalIdentifiers(readString(row, "trade_name"));
  const primaryCnaeDigits = normalizeCnaeCode(readString(row, "primary_cnae_code") ?? "");
  const primaryCnae = primaryCnaeDigits.length === 7 ? primaryCnaeDigits : null;
  const primaryDescription = readString(row, "primary_cnae_description");
  const secondaryCnaes = uniqueSorted(
    parseSecondaryCnaes(parseJsonValue(row.secondary_cnaes))
      .map((item) => normalizeCnaeCode(item.code ?? ""))
      .filter((code) => code.length === 7 && code !== primaryCnae)
  );
  const openedAt = readString(row, "opened_at");
  const openedYear = openedAt && /^\d{4}/.test(openedAt) ? Number(openedAt.slice(0, 4)) : null;
  const sourceFetchedAt = resolveSourceFetchedAt(row, options.nowEpoch);

  return {
    id: cnpj,
    cnpj,
    cnpjRoot: cnpj.slice(0, 8),
    legalName,
    tradeName: tradeName && foldSearchText(tradeName) !== foldSearchText(legalName) ? tradeName : null,
    primaryCnae,
    primaryCnaeLabel: primaryCnae
      ? primaryDescription
        ? `${formatCnaeCode(primaryCnae)} ${primaryDescription}`
        : formatCnaeCode(primaryCnae)
      : primaryDescription,
    cnaeClass: primaryCnae ? primaryCnae.slice(0, 5) : null,
    cnaeDivision: primaryCnae ? primaryCnae.slice(0, 2) : null,
    secondaryCnaes,
    city: readString(row, "city_name"),
    cityIbge: normalizeIbgeCode(row.city_ibge),
    stateCode: normalizeUf(row.state_code),
    registrationStatus: normalizeStatus(readString(row, "registration_status")),
    headquarters: resolveHeadquartersOrBranch(cnpj, row.provider_payload),
    companySize: readString(row, "company_size"),
    openedYear: openedYear && openedYear > 1800 ? openedYear : null,
    profileIds,
    workspaceIds,
    source: "casadosdados",
    sourceFetchedAt,
    indexedAt: options.nowEpoch,
    expiresAt: sourceFetchedAt + options.ttlDays * 86_400
  };
}

/** Campos que o documento NUNCA pode ter (checado nos testes). */
export const FORBIDDEN_DOCUMENT_FIELDS = [
  "email",
  "phone",
  "website",
  "address",
  "addressLine",
  "address_line",
  "cep",
  "neighborhood",
  "capitalSocial",
  "capital_social",
  "providerPayload",
  "provider_payload",
  "partners",
  "socios"
] as const;
