import { getOpenAiApiKey, getOpenAiModel } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatCnpj, formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { getSearchSummary } from "@/lib/search-summary";
import { buildEstablishmentDetailSections } from "@/lib/establishment-detail-sections";
import { buildDisplayEstablishment, getEstablishmentPayload } from "@/lib/establishment-presenter";
import { extractSingleObject, safeJsonStringify } from "@/lib/utils";
import { saveSearchAiFormatPayload, type SearchAiFormatOrderRecord } from "@/lib/billing";

type FormattingSourceRecord = {
  position: number;
  cnpj: string;
  cnpjFormatted: string;
  companyName: string;
  tradeName: string;
  registrationStatus: string;
  openedAt: string;
  primaryActivity: string;
  legalNature: string;
  companySize: string;
  taxProfile: string;
  capitalSocial: string;
  location: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  secondaryCnaes: string;
};

type SearchAiExportSourceRow = Record<string, unknown>;

type FormattingAiInputRecord = {
  position: number;
  sourceRecord: FormattingSourceRecord;
  xlsxRow: string[];
  availableFields: Record<string, string>;
};

type PreparedExportRecord = {
  position: number;
  aiRecord: SearchAiFormattedRecord;
  sourceRecord: FormattingSourceRecord;
  establishment: Record<string, unknown>;
  flattenedFields: Map<string, string>;
  jsonAudit: string;
  searchResultPayloadText: string;
};

export type SearchAiFormattedRecord = {
  position: number;
  cnpj: string;
  cnpjFormatted: string;
  companyName: string;
  tradeName: string;
  registrationStatus: string;
  openedAt: string;
  primaryActivity: string;
  secondaryCnaes: string;
  legalNature: string;
  companySize: string;
  taxProfile: string;
  capitalSocial: string;
  location: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  contactChannel: string;
  dataCompleteness: string;
  commercialNote: string;
};

export type SearchAiFormattedPayload = {
  generator: "openai" | "fallback";
  generatedAt: string;
  model: string;
  orderId: string;
  searchQueryId: string;
  headline: string;
  subtitle: string;
  totalRecords: number;
  strategy?: {
    xlsx: string;
    pdf: string;
    pdfSafety: string;
  };
  summary: Array<{ label: string; value: string }>;
  records: SearchAiFormattedRecord[];
};

export type AiFormattedWorkbookSheet = {
  name: string;
  rows: string[][];
  columnWidths?: number[];
  wrapColumns?: number[];
};

function extractFirstJsonObject(value: string) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return value.slice(start, end + 1);
}

function extractResponseText(payload: any): string {
  if (typeof payload?.output_text === "string" && payload.output_text) {
    return payload.output_text;
  }

  if (Array.isArray(payload?.output)) {
    const parts: string[] = [];

    for (const item of payload.output) {
      if (!item || typeof item !== "object") continue;
      if (Array.isArray(item.content)) {
        for (const content of item.content) {
          if (typeof content?.text === "string") parts.push(content.text);
          if (typeof content?.output_text === "string") parts.push(content.output_text);
        }
      }
    }

    return parts.join("\n").trim();
  }

  return "";
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "-";

  const local = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  if (local.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }

  return value.trim() || "-";
}

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  return email || "-";
}

function normalizeWebsite(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "-";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function normalizeTextValue(value: unknown) {
  if (value === null || value === undefined) return "-";
  const text = String(value).trim();
  return text || "-";
}

function formatSecondaryCnaes(value: unknown) {
  if (!Array.isArray(value)) {
    return normalizeTextValue(value);
  }

  const items = value
    .map((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const record = item as Record<string, unknown>;
        const code = typeof record.codigo === "string" ? record.codigo.trim() : "";
        const description = typeof record.descricao === "string" ? record.descricao.trim() : "";
        if (code && description) return `${code} - ${description}`;
        return description || code || safeJsonStringify(item, 0);
      }

      return typeof item === "string" ? item.trim() : safeJsonStringify(item, 0);
    })
    .filter(Boolean);

  return items.length > 0 ? items.join(" • ") : "-";
}

function buildAddress(parts: Array<unknown>) {
  const values = parts
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  return values.length > 0 ? values.join(", ") : "-";
}

function buildTaxProfile(simples: unknown, mei: unknown) {
  const simplesLabel = simples === true ? "Simples: Sim" : simples === false ? "Simples: Não" : "Simples: N/D";
  const meiLabel = mei === true ? "MEI: Sim" : mei === false ? "MEI: Não" : "MEI: N/D";
  return `${simplesLabel} • ${meiLabel}`;
}

function estimateCompleteness(record: FormattingSourceRecord) {
  const score = [record.phone, record.email, record.website, record.address, record.location]
    .filter((value) => value && value !== "-")
    .length;

  if (score >= 4) return "Alta";
  if (score >= 2) return "Média";
  return "Baixa";
}

function detectContactChannel(record: FormattingSourceRecord) {
  const channels = [] as string[];
  if (record.phone !== "-") channels.push("Telefone");
  if (record.email !== "-") channels.push("E-mail");
  if (record.website !== "-") channels.push("Site");
  if (channels.length === 0) return "Sem canal direto identificado";
  if (channels.length === 1) return channels[0];
  return channels.slice(0, -1).join(" + ") + " + " + channels[channels.length - 1];
}

function buildFallbackNote(record: FormattingSourceRecord) {
  const parts = [] as string[];
  if (record.phone !== "-") parts.push("telefone disponível");
  if (record.email !== "-") parts.push("e-mail disponível");
  if (record.website !== "-") parts.push("site identificado");

  if (parts.length === 0) {
    return "Revisar contatos antes da prospecção ativa.";
  }

  return `Contato por ${parts.join(", ")}.`;
}

function buildSourceRecord(position: number, establishment: Record<string, unknown>): FormattingSourceRecord {
  const cnpj = String(establishment.cnpj ?? "").trim();
  const primaryActivityCode = String(establishment.primary_cnae_code ?? "").trim();
  const primaryActivityDescription = String(establishment.primary_cnae_description ?? "").trim();
  const primaryActivity = [primaryActivityCode, primaryActivityDescription].filter(Boolean).join(" - ") || "-";
  const legalNature = [establishment.legal_nature_code, establishment.legal_nature_description]
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .join(" - ") || "-";
  const city = String(establishment.city_name ?? "").trim();
  const state = String(establishment.state_code ?? "").trim();

  return {
    position,
    cnpj,
    cnpjFormatted: formatCnpj(cnpj),
    companyName: normalizeTextValue(establishment.company_name),
    tradeName: normalizeTextValue(establishment.trade_name),
    registrationStatus: normalizeTextValue(establishment.registration_status),
    openedAt:
      typeof establishment.opened_at === "string" && establishment.opened_at.trim()
        ? formatDate(establishment.opened_at)
        : "-",
    primaryActivity,
    secondaryCnaes: formatSecondaryCnaes(establishment.secondary_cnaes),
    legalNature,
    companySize: normalizeTextValue(establishment.company_size),
    taxProfile: buildTaxProfile(establishment.simples_opt_in, establishment.mei_opt_in),
    capitalSocial:
      establishment.capital_social === null || establishment.capital_social === undefined || establishment.capital_social === ""
        ? "-"
        : formatMoney(establishment.capital_social as number | string),
    location: [city, state].filter(Boolean).join("/") || "-",
    address: buildAddress([
      establishment.address_line,
      establishment.address_number,
      establishment.complement,
      establishment.neighborhood,
      establishment.cep
    ]),
    phone: normalizePhone(String(establishment.phone ?? "")),
    email: normalizeEmail(String(establishment.email ?? "")),
    website: normalizeWebsite(String(establishment.website ?? ""))
  };
}

function createFallbackRecords(sourceRecords: FormattingSourceRecord[]): SearchAiFormattedRecord[] {
  return sourceRecords.map((record) => ({
    ...record,
    contactChannel: detectContactChannel(record),
    dataCompleteness: estimateCompleteness(record),
    commercialNote: buildFallbackNote(record)
  }));
}

function buildAiPromptInput(records: FormattingAiInputRecord[]) {
  const headers = [
    "Posição",
    "Empresa",
    "Nome fantasia",
    "CNPJ",
    "Situação cadastral",
    "Data de abertura",
    "Atividade principal",
    "CNAEs secundários",
    "Natureza jurídica",
    "Porte",
    "Regime tributário",
    "Capital social",
    "Localização",
    "Endereço",
    "Telefone",
    "E-mail",
    "Site"
  ];

  return {
    task:
      "Receba a planilha xlsx diretamente do sistema. O objetivo é organizar os dados com todas as informações disponíveis e gerar a base para um novo XLSX e um PDF com as informações.",
    pdf_guidance:
      "Para a formatação em PDF, escolha a melhor forma de apresentação para evitar textos desconfigurados, excesso de quebras e caracteres estranhos. Prefira linguagem limpa, sem markdown, sem emojis e sem símbolos decorativos.",
    expected_strategy:
      "Elabore uma estratégia curta para o XLSX e para o PDF, mas responda somente em JSON válido no formato solicitado.",
    system_xlsx_preview: {
      description: "Prévia da planilha que o sistema entregaria internamente para a etapa de organização por IA.",
      headers,
      rows: records.map((record) => record.xlsxRow)
    },
    records: records.map((record) => ({
      position: record.position,
      normalized_record: record.sourceRecord,
      all_available_fields: record.availableFields
    }))
  };
}

async function formatChunkWithOpenAi(records: FormattingAiInputRecord[]) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: getOpenAiModel(),
      instructions:
        "Receba a planilha xlsx diretamente do sistema, organize os dados com todas as informações disponíveis e gere a melhor base possível para exportação em XLSX e PDF. Preserve integralmente os dados recebidos, nunca invente valores e nunca descarte informações úteis. Considere tanto a prévia tabular do XLSX quanto todos os campos disponíveis por registro. Para o PDF, escolha uma estratégia textual que privilegie legibilidade, blocos curtos, rótulos claros, texto limpo em português do Brasil e caracteres seguros para evitar desconfiguração visual, símbolos estranhos, markdown, emojis e ornamentos desnecessários. Responda apenas JSON válido no formato {\"strategy\":{\"xlsx\": string, \"pdf\": string, \"pdfSafety\": string}, \"items\":[{\"position\": number, \"companyName\": string, \"tradeName\": string, \"registrationStatus\": string, \"openedAt\": string, \"primaryActivity\": string, \"secondaryCnaes\": string, \"legalNature\": string, \"companySize\": string, \"taxProfile\": string, \"capitalSocial\": string, \"location\": string, \"address\": string, \"phone\": string, \"email\": string, \"website\": string, \"contactChannel\": string, \"dataCompleteness\": string, \"commercialNote\": string}]}. Em strategy.xlsx, descreva em uma frase como organizar o XLSX. Em strategy.pdf, descreva em uma frase como distribuir as informações no PDF. Em strategy.pdfSafety, descreva em uma frase como evitar textos quebrados e caracteres estranhos no PDF. Use somente os dados fornecidos. Normalize nomes, telefones, e-mails, sites, localização e endereço em português do Brasil. Em contactChannel, indique o melhor canal baseado nos contatos disponíveis. Em dataCompleteness, classifique como Alta, Média ou Baixa considerando principalmente telefone, e-mail, site e endereço. Em commercialNote, faça uma observação objetiva com no máximo 22 palavras usando apenas dados reais do item.",
      input: safeJsonStringify(buildAiPromptInput(records), 2),
      max_output_tokens: 5000,
      temperature: 0.15
    })
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const rawText = extractResponseText(payload);
  const jsonText = extractFirstJsonObject(rawText);

  if (!jsonText) {
    return null;
  }

  const parsed = JSON.parse(jsonText) as {
    strategy?: {
      xlsx?: string;
      pdf?: string;
      pdfSafety?: string;
    };
    items?: Array<Partial<SearchAiFormattedRecord> & { position?: number }>;
  };

  if (!Array.isArray(parsed.items)) {
    return null;
  }

  return {
    strategy:
      parsed.strategy &&
      typeof parsed.strategy === "object" &&
      (parsed.strategy.xlsx || parsed.strategy.pdf || parsed.strategy.pdfSafety)
        ? {
            xlsx: typeof parsed.strategy.xlsx === "string" && parsed.strategy.xlsx.trim() ? parsed.strategy.xlsx.trim() : "",
            pdf: typeof parsed.strategy.pdf === "string" && parsed.strategy.pdf.trim() ? parsed.strategy.pdf.trim() : "",
            pdfSafety:
              typeof parsed.strategy.pdfSafety === "string" && parsed.strategy.pdfSafety.trim()
                ? parsed.strategy.pdfSafety.trim()
                : ""
          }
        : null,
    items: parsed.items
  };
}

function mergeAiRecord(
  sourceRecord: FormattingSourceRecord,
  partial?: Partial<SearchAiFormattedRecord> & { position?: number }
): SearchAiFormattedRecord {
  const companyName = typeof partial?.companyName === "string" && partial.companyName.trim()
    ? partial.companyName.trim()
    : sourceRecord.companyName;
  const tradeName = typeof partial?.tradeName === "string" && partial.tradeName.trim()
    ? partial.tradeName.trim()
    : sourceRecord.tradeName;
  const registrationStatus = typeof partial?.registrationStatus === "string" && partial.registrationStatus.trim()
    ? partial.registrationStatus.trim()
    : sourceRecord.registrationStatus;
  const openedAt = typeof partial?.openedAt === "string" && partial.openedAt.trim()
    ? partial.openedAt.trim()
    : sourceRecord.openedAt;
  const primaryActivity = typeof partial?.primaryActivity === "string" && partial.primaryActivity.trim()
    ? partial.primaryActivity.trim()
    : sourceRecord.primaryActivity;
  const secondaryCnaes = typeof partial?.secondaryCnaes === "string" && partial.secondaryCnaes.trim()
    ? partial.secondaryCnaes.trim()
    : sourceRecord.secondaryCnaes;
  const legalNature = typeof partial?.legalNature === "string" && partial.legalNature.trim()
    ? partial.legalNature.trim()
    : sourceRecord.legalNature;
  const companySize = typeof partial?.companySize === "string" && partial.companySize.trim()
    ? partial.companySize.trim()
    : sourceRecord.companySize;
  const taxProfile = typeof partial?.taxProfile === "string" && partial.taxProfile.trim()
    ? partial.taxProfile.trim()
    : sourceRecord.taxProfile;
  const capitalSocial = typeof partial?.capitalSocial === "string" && partial.capitalSocial.trim()
    ? partial.capitalSocial.trim()
    : sourceRecord.capitalSocial;
  const location = typeof partial?.location === "string" && partial.location.trim()
    ? partial.location.trim()
    : sourceRecord.location;
  const address = typeof partial?.address === "string" && partial.address.trim()
    ? partial.address.trim()
    : sourceRecord.address;
  const phone = typeof partial?.phone === "string" && partial.phone.trim()
    ? partial.phone.trim()
    : sourceRecord.phone;
  const email = typeof partial?.email === "string" && partial.email.trim()
    ? partial.email.trim()
    : sourceRecord.email;
  const website = typeof partial?.website === "string" && partial.website.trim()
    ? partial.website.trim()
    : sourceRecord.website;

  return {
    ...sourceRecord,
    companyName,
    tradeName,
    registrationStatus,
    openedAt,
    primaryActivity,
    secondaryCnaes,
    legalNature,
    companySize,
    taxProfile,
    capitalSocial,
    location,
    address,
    phone,
    email,
    website,
    contactChannel:
      typeof partial?.contactChannel === "string" && partial.contactChannel.trim()
        ? partial.contactChannel.trim()
        : detectContactChannel({ ...sourceRecord, phone, email, website, address, location }),
    dataCompleteness:
      typeof partial?.dataCompleteness === "string" && partial.dataCompleteness.trim()
        ? partial.dataCompleteness.trim()
        : estimateCompleteness({ ...sourceRecord, phone, email, website, address, location }),
    commercialNote:
      typeof partial?.commercialNote === "string" && partial.commercialNote.trim()
        ? partial.commercialNote.trim()
        : buildFallbackNote(sourceRecord)
  };
}

function buildSummary(records: SearchAiFormattedRecord[]) {
  const withPhone = records.filter((record) => record.phone !== "-").length;
  const withEmail = records.filter((record) => record.email !== "-").length;
  const withWebsite = records.filter((record) => record.website !== "-").length;
  const highCompleteness = records.filter((record) => /alta/i.test(record.dataCompleteness)).length;

  return [
    { label: "Registros formatados", value: String(records.length) },
    { label: "Com telefone", value: String(withPhone) },
    { label: "Com e-mail", value: String(withEmail) },
    { label: "Com site", value: String(withWebsite) },
    { label: "Completude alta", value: String(highCompleteness) }
  ];
}

function isStoredPayload(value: unknown): value is SearchAiFormattedPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.records) && typeof record.searchQueryId === "string";
}

function blankWhenMissing(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  return !text || text === "-" ? "" : text;
}

function toRawCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "string") return value.trim();
  return safeJsonStringify(value, 0);
}

function toReadablePrimitive(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "string") return value.trim();
  return safeJsonStringify(value, 0);
}

function maybeParseStructuredString(value: string) {
  const text = value.trim();
  if (!text) return null;
  if (!(text.startsWith("{") || text.startsWith("["))) {
    return null;
  }

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function buildReadableArrayText(values: unknown[]) {
  return values
    .map((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const record = item as Record<string, unknown>;
        const code = toReadablePrimitive(record.codigo);
        const description = toReadablePrimitive(record.descricao);
        const name = toReadablePrimitive(record.nome ?? record.name ?? record.tipo ?? record.type);
        const itemValue = toReadablePrimitive(record.valor ?? record.value ?? record.numero ?? record.email);

        if (code && description) return `${code} - ${description}`;
        if (name && itemValue) return `${name}: ${itemValue}`;
        return safeJsonStringify(item, 0);
      }

      return toReadablePrimitive(item);
    })
    .filter(Boolean)
    .join(" | ");
}

function expandStructuredValue(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = maybeParseStructuredString(value);
    return parsed ? expandStructuredValue(parsed, depth + 1) : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => expandStructuredValue(item, depth + 1));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [key, expandStructuredValue(nestedValue, depth + 1)])
    );
  }

  return value;
}

function flattenValueToMap(value: unknown, path: string, out: Map<string, string>) {
  if (value === null || value === undefined) {
    if (path) out.set(path, "");
    return;
  }

  if (typeof value === "string") {
    const parsed = maybeParseStructuredString(value);
    if (parsed) {
      if (path) out.set(path, value.trim());
      flattenValueToMap(parsed, path, out);
      return;
    }

    if (path) out.set(path, value.trim());
    return;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    if (path) out.set(path, toReadablePrimitive(value));
    return;
  }

  if (Array.isArray(value)) {
    if (path) out.set(path, buildReadableArrayText(value));
    if (value.length === 0) return;

    value.forEach((item, index) => {
      flattenValueToMap(item, `${path}[${index}]`, out);
    });
    return;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      if (path) out.set(path, "{}");
      return;
    }

    for (const [key, nestedValue] of entries) {
      flattenValueToMap(nestedValue, path ? `${path}.${key}` : key, out);
    }
  }
}

function humanizeToken(value: string) {
  const normalized = value.trim();
  if (!normalized) return "";

  const upper = normalized.toUpperCase();
  if (["CNPJ", "CNAE", "CEP", "UF", "IBGE", "MEI"].includes(upper)) {
    return upper;
  }

  if (upper === "ID") {
    return "ID";
  }

  if (upper === "JSON") {
    return "JSON";
  }

  return normalized
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatFieldLabel(path: string) {
  const rootLabelMap: Record<string, string> = {
    position: "Posição",
    organized: "Organizado",
    establishment: "Cadastro",
    provider_payload: "Payload bruto",
    search_result_payload: "Payload da busca"
  };

  return path
    .split(".")
    .flatMap((segment, segmentIndex) => {
      const base = segment.replace(/\[\d+\]/g, "");
      const indexes = Array.from(segment.matchAll(/\[(\d+)\]/g), (match) => Number(match[1] ?? 0) + 1);
      const label = segmentIndex === 0 && rootLabelMap[base] ? rootLabelMap[base] : humanizeToken(base);
      const parts = [label, ...indexes.map((index) => String(index))].filter(Boolean);
      return parts;
    })
    .join(" • ");
}

function formatMaybeDateValue(value: unknown) {
  const text = blankWhenMissing(value);
  if (!text) return "";
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? formatDate(text) : text;
}

function formatCep(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 8) {
    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }

  return blankWhenMissing(value);
}

function buildPreparedExportRecords(payload: SearchAiFormattedPayload, rows: SearchAiExportSourceRow[]) {
  const aiByPosition = new Map(payload.records.map((record) => [record.position, record]));

  return rows
    .map((row) => {
      const establishment = extractSingleObject(row.establishments);
      if (!establishment) return null;

      const position = Number(row.position ?? 0);
      const sourceRecord = buildSourceRecord(position, establishment);
      const aiRecord = aiByPosition.get(position) ?? mergeAiRecord(sourceRecord);
      const establishmentPayload = expandStructuredValue(establishment.provider_payload);
      const searchResultPayload = expandStructuredValue(row.provider_payload);
      const establishmentWithoutPayload = { ...establishment };
      delete establishmentWithoutPayload.provider_payload;

      const flatObject = {
        position,
        organized: {
          company_name: blankWhenMissing(aiRecord.companyName),
          trade_name: blankWhenMissing(aiRecord.tradeName),
          cnpj: blankWhenMissing(aiRecord.cnpj),
          cnpj_formatted: blankWhenMissing(aiRecord.cnpjFormatted),
          registration_status: blankWhenMissing(aiRecord.registrationStatus),
          opened_at: blankWhenMissing(aiRecord.openedAt),
          primary_activity: blankWhenMissing(aiRecord.primaryActivity),
          secondary_cnaes: blankWhenMissing(aiRecord.secondaryCnaes),
          legal_nature: blankWhenMissing(aiRecord.legalNature),
          company_size: blankWhenMissing(aiRecord.companySize),
          tax_profile: blankWhenMissing(aiRecord.taxProfile),
          capital_social: blankWhenMissing(aiRecord.capitalSocial),
          location: blankWhenMissing(aiRecord.location),
          address: blankWhenMissing(aiRecord.address),
          phone: blankWhenMissing(aiRecord.phone),
          email: blankWhenMissing(aiRecord.email),
          website: blankWhenMissing(aiRecord.website),
          contact_channel: blankWhenMissing(aiRecord.contactChannel),
          data_completeness: blankWhenMissing(aiRecord.dataCompleteness),
          commercial_note: blankWhenMissing(aiRecord.commercialNote)
        },
        establishment: establishmentWithoutPayload,
        provider_payload: establishmentPayload,
        search_result_payload: searchResultPayload
      };

      const flattenedFields = new Map<string, string>();
      flattenValueToMap(flatObject, "", flattenedFields);

      const jsonAudit = safeJsonStringify(
        {
          position,
          organized: aiRecord,
          establishment,
          provider_payload: establishmentPayload,
          search_result_payload: searchResultPayload
        },
        2
      );

      return {
        position,
        aiRecord,
        sourceRecord,
        establishment,
        flattenedFields,
        jsonAudit,
        searchResultPayloadText: safeJsonStringify(row.provider_payload, 2)
      } satisfies PreparedExportRecord;
    })
    .filter((item): item is PreparedExportRecord => Boolean(item))
    .sort((left, right) => left.position - right.position);
}

function buildFormattingAiInputRecord(
  row: { position?: number | string | null; establishments?: unknown; provider_payload?: unknown }
): FormattingAiInputRecord | null {
  const establishment = extractSingleObject(row.establishments);
  if (!establishment) return null;

  const position = Number(row.position ?? 0);
  const sourceRecord = buildSourceRecord(position, establishment);
  const flatFields = new Map<string, string>();
  const establishmentPayload = expandStructuredValue(establishment.provider_payload);
  const searchResultPayload = expandStructuredValue(row.provider_payload);
  const establishmentWithoutPayload = { ...establishment };
  delete establishmentWithoutPayload.provider_payload;

  flattenValueToMap(
    {
      normalized: sourceRecord,
      establishment: establishmentWithoutPayload,
      provider_payload: establishmentPayload,
      search_result_payload: searchResultPayload
    },
    "",
    flatFields
  );

  return {
    position,
    sourceRecord,
    xlsxRow: [
      String(sourceRecord.position),
      sourceRecord.companyName,
      sourceRecord.tradeName,
      sourceRecord.cnpjFormatted,
      sourceRecord.registrationStatus,
      sourceRecord.openedAt,
      sourceRecord.primaryActivity,
      sourceRecord.secondaryCnaes,
      sourceRecord.legalNature,
      sourceRecord.companySize,
      sourceRecord.taxProfile,
      sourceRecord.capitalSocial,
      sourceRecord.location,
      sourceRecord.address,
      sourceRecord.phone,
      sourceRecord.email,
      sourceRecord.website
    ],
    availableFields: Object.fromEntries(flatFields)
  };
}

export async function ensureSearchAiFormattingPayload(order: SearchAiFormatOrderRecord) {
  if (isStoredPayload(order.formatted_payload)) {
    return order.formatted_payload;
  }

  const admin = createSupabaseAdminClient();
  const [{ data: search }, { data: rows }] = await Promise.all([
    admin
      .from("search_queries")
      .select("*")
      .eq("id", order.search_query_id)
      .maybeSingle(),
    admin
      .from("search_results")
      .select("position, provider_payload, establishments(*)")
      .eq("search_query_id", order.search_query_id)
      .order("position", { ascending: true })
  ]);

  const aiInputRecords = ((rows ?? []) as Array<{ position?: number | string | null; establishments?: unknown; provider_payload?: unknown }>)
    .map((row) => buildFormattingAiInputRecord(row))
    .filter((item): item is FormattingAiInputRecord => Boolean(item));

  const sourceRecords = aiInputRecords.map((record) => record.sourceRecord);
  const fallbackRecords = createFallbackRecords(sourceRecords);
  let formattedRecords = fallbackRecords;
  let generator: SearchAiFormattedPayload["generator"] = "fallback";
  let strategy: SearchAiFormattedPayload["strategy"] | undefined;

  try {
    const chunkSize = 8;
    const aiRecords = new Map<number, Partial<SearchAiFormattedRecord> & { position?: number }>();

    for (let start = 0; start < aiInputRecords.length; start += chunkSize) {
      const chunk = aiInputRecords.slice(start, start + chunkSize);
      const formattedChunk = await formatChunkWithOpenAi(chunk);

      if (!formattedChunk) {
        aiRecords.clear();
        strategy = undefined;
        break;
      }

      if (!strategy && formattedChunk.strategy) {
        strategy = {
          xlsx: formattedChunk.strategy.xlsx || "",
          pdf: formattedChunk.strategy.pdf || "",
          pdfSafety: formattedChunk.strategy.pdfSafety || ""
        };
      }

      for (const item of formattedChunk.items) {
        if (typeof item.position === "number") {
          aiRecords.set(item.position, item);
        }
      }
    }

    if (aiRecords.size > 0 || sourceRecords.length === 0) {
      formattedRecords = sourceRecords.map((record) => mergeAiRecord(record, aiRecords.get(record.position)));
      generator = sourceRecords.length > 0 ? "openai" : "fallback";
    }
  } catch {
    generator = "fallback";
    strategy = undefined;
  }

  if (!strategy) {
    strategy = {
      xlsx: "Organizar a lista em abas legíveis, com colunas padronizadas e todos os campos disponíveis preservados para análise e filtro.",
      pdf: "Distribuir cada empresa em ficha cadastral com seções curtas e rótulos claros para facilitar a leitura sem poluir a página.",
      pdfSafety: "Usar texto limpo, sem markdown, emojis ou símbolos decorativos, mantendo quebras controladas e caracteres compatíveis com o PDF."
    };
  }

  const summary = getSearchSummary(search ?? {});
  const payload: SearchAiFormattedPayload = {
    generator,
    generatedAt: new Date().toISOString(),
    model: getOpenAiModel(),
    orderId: order.id,
    searchQueryId: order.search_query_id,
    headline: summary.headline,
    subtitle: `${formattedRecords.length} registro(s) organizados para exportação em XLSX e PDF`,
    totalRecords: formattedRecords.length,
    strategy,
    summary: buildSummary(formattedRecords),
    records: formattedRecords
  };

  await saveSearchAiFormatPayload({
    orderId: order.id,
    payload
  });

  return payload;
}

export function buildAiFormattedWorkbookRows(payload: SearchAiFormattedPayload) {
  const summaryRows: string[][] = [
    ["Título", payload.headline],
    ["Subtítulo", payload.subtitle],
    ["Gerado em", formatDateTime(payload.generatedAt)],
    ["Gerador", payload.generator === "openai" ? `OpenAI (${payload.model})` : `Fallback (${payload.model})`],
    ["Total de registros", String(payload.totalRecords)],
    ...(payload.strategy?.xlsx ? [["Estratégia do XLSX", payload.strategy.xlsx]] : []),
    ...(payload.strategy?.pdf ? [["Estratégia do PDF", payload.strategy.pdf]] : []),
    ...(payload.strategy?.pdfSafety ? [["Segurança visual do PDF", payload.strategy.pdfSafety]] : []),
    ...payload.summary.map((item) => [item.label, item.value])
  ];

  const listRows: string[][] = [
    [
      "Posição",
      "Empresa",
      "Nome fantasia",
      "CNPJ",
      "Status",
      "Abertura",
      "Atividade principal",
      "CNAEs secundários",
      "Natureza jurídica",
      "Porte",
      "Regime",
      "Capital social",
      "Localização",
      "Endereço",
      "Telefone",
      "E-mail",
      "Site",
      "Canal recomendado",
      "Completude",
      "Nota comercial"
    ]
  ];

  for (const record of payload.records) {
    listRows.push([
      String(record.position),
      record.companyName,
      record.tradeName,
      record.cnpjFormatted,
      record.registrationStatus,
      record.openedAt,
      record.primaryActivity,
      record.secondaryCnaes,
      record.legalNature,
      record.companySize,
      record.taxProfile,
      record.capitalSocial,
      record.location,
      record.address,
      record.phone,
      record.email,
      record.website,
      record.contactChannel,
      record.dataCompleteness,
      record.commercialNote
    ]);
  }

  return {
    summaryRows,
    listRows
  };
}

export function buildAiFormattedWorkbookSheets(payload: SearchAiFormattedPayload, rows: SearchAiExportSourceRow[]): AiFormattedWorkbookSheet[] {
  const preparedRecords = buildPreparedExportRecords(payload, rows);

  const organizedRows: string[][] = [
    [
      "Posição",
      "Empresa",
      "Nome fantasia",
      "CNPJ",
      "Situação cadastral",
      "Data de abertura",
      "Atividade principal",
      "CNAEs secundários",
      "Natureza jurídica",
      "Porte",
      "Regime tributário",
      "Capital social",
      "País",
      "Cidade",
      "UF",
      "Bairro",
      "CEP",
      "Endereço completo",
      "Telefone",
      "E-mail",
      "Site",
      "Canal recomendado",
      "Completude",
      "Observação comercial"
    ]
  ];

  const fichaRows: string[][] = [["Posição", "CNPJ", "Razão Social", "Grupo", "Campo", "Valor"]];

  const formatFichaValue = (key: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return "";
    if (key === "opened_at") return formatMaybeDateValue(value);
    if (key === "secondary_cnaes") return blankWhenMissing(formatSecondaryCnaes(value));
    if (key.toLowerCase().includes("capital")) return blankWhenMissing(formatMoney(value as number | string));
    if (Array.isArray(value)) return blankWhenMissing(buildReadableArrayText(value));
    if (typeof value === "boolean") return value ? "Sim" : "Não";
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
    if (typeof value === "string") return value.trim();
    return safeJsonStringify(value, 0);
  };

  for (const record of preparedRecords) {
    organizedRows.push([
      String(record.position),
      blankWhenMissing(record.aiRecord.companyName),
      blankWhenMissing(record.aiRecord.tradeName),
      blankWhenMissing(record.aiRecord.cnpjFormatted || formatCnpj(record.aiRecord.cnpj)),
      blankWhenMissing(record.aiRecord.registrationStatus),
      blankWhenMissing(record.aiRecord.openedAt),
      blankWhenMissing(record.aiRecord.primaryActivity),
      blankWhenMissing(record.aiRecord.secondaryCnaes),
      blankWhenMissing(record.aiRecord.legalNature),
      blankWhenMissing(record.aiRecord.companySize),
      blankWhenMissing(record.aiRecord.taxProfile),
      blankWhenMissing(record.aiRecord.capitalSocial),
      blankWhenMissing(record.establishment.country),
      blankWhenMissing(record.establishment.city_name),
      blankWhenMissing(record.establishment.state_code),
      blankWhenMissing(record.establishment.neighborhood),
      formatCep(record.establishment.cep),
      blankWhenMissing(record.aiRecord.address),
      blankWhenMissing(record.aiRecord.phone),
      blankWhenMissing(record.aiRecord.email),
      blankWhenMissing(record.aiRecord.website),
      blankWhenMissing(record.aiRecord.contactChannel),
      blankWhenMissing(record.aiRecord.dataCompleteness),
      blankWhenMissing(record.aiRecord.commercialNote)
    ]);

    const display = buildDisplayEstablishment(record.establishment);
    const payloadData = getEstablishmentPayload(display);
    const rawJsonPayload = payloadData ?? display.provider_payload;
    const { primaryFields, contactFields } = buildEstablishmentDetailSections(display, rawJsonPayload);

    for (const field of primaryFields) {
      fichaRows.push([
        String(record.position),
        blankWhenMissing(display.cnpj ? formatCnpj(String(display.cnpj)) : record.aiRecord.cnpjFormatted),
        blankWhenMissing(display.company_name || record.aiRecord.companyName),
        "Dados principais",
        field.label,
        blankWhenMissing(formatFichaValue(field.key, field.value)) || "-"
      ]);
    }

    for (const field of contactFields) {
      fichaRows.push([
        String(record.position),
        blankWhenMissing(display.cnpj ? formatCnpj(String(display.cnpj)) : record.aiRecord.cnpjFormatted),
        blankWhenMissing(display.company_name || record.aiRecord.companyName),
        "Contato e endereço",
        field.label,
        blankWhenMissing(formatFichaValue(field.key, field.value)) || "-"
      ]);
    }

    fichaRows.push([
      String(record.position),
      blankWhenMissing(display.cnpj ? formatCnpj(String(display.cnpj)) : record.aiRecord.cnpjFormatted),
      blankWhenMissing(display.company_name || record.aiRecord.companyName),
      "Dados brutos formatados (JSON)",
      "JSON",
      record.jsonAudit
    ]);

    fichaRows.push(["", "", "", "", "", ""]);
  }

  const jsonRows: string[][] = [["Posição", "Empresa", "CNPJ", "JSON legível"]];
  for (const record of preparedRecords) {
    jsonRows.push([
      String(record.position),
      blankWhenMissing(record.aiRecord.companyName),
      blankWhenMissing(record.aiRecord.cnpjFormatted),
      record.jsonAudit
    ]);
    jsonRows.push(["", "", "", ""]);
  }

  return [
    {
      name: "Empresas organizadas",
      rows: organizedRows,
      columnWidths: [10, 34, 28, 22, 20, 14, 36, 36, 26, 14, 22, 16, 12, 22, 8, 18, 12, 38, 18, 30, 28, 18, 14, 36],
      wrapColumns: [1, 2, 6, 7, 8, 10, 17, 19, 20, 23]
    },
    {
      name: "Ficha completa",
      rows: fichaRows,
      columnWidths: [10, 22, 34, 18, 24, 96],
      wrapColumns: [5]
    },
    {
      name: "JSON legível",
      rows: jsonRows,
      columnWidths: [10, 34, 22, 92],
      wrapColumns: [3]
    }
  ];
}

function buildPdfFields(fields: Array<{ label: string; value: unknown }>) {
  return fields
    .map((field) => ({
      label: field.label,
      value: blankWhenMissing(field.value)
    }))
    .filter((field) => field.value);
}

export function buildAiFormattedPdfInput(payload: SearchAiFormattedPayload, rows: SearchAiExportSourceRow[]) {
  const preparedRecords = buildPreparedExportRecords(payload, rows);

  const formatPdfSectionValue = (key: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return "";
    if (key === "opened_at") return formatMaybeDateValue(value);
    if (key === "secondary_cnaes") return blankWhenMissing(formatSecondaryCnaes(value));
    if (key.toLowerCase().includes("capital")) return blankWhenMissing(formatMoney(value as number | string));
    if (Array.isArray(value)) return blankWhenMissing(buildReadableArrayText(value));
    if (typeof value === "boolean") return value ? "Sim" : "Não";
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
    if (typeof value === "string") return value.trim();
    return safeJsonStringify(value, 0);
  };

  const records = preparedRecords.map((record) => {
    const display = buildDisplayEstablishment(record.establishment);
    const payloadData = getEstablishmentPayload(display);
    const rawJsonPayload = payloadData ?? display.provider_payload;
    const { primaryFields, contactFields } = buildEstablishmentDetailSections(display, rawJsonPayload);

    const primarySectionFields = [
      { label: "Posição", value: String(record.position) },
      ...primaryFields.map((field) => ({
        label: field.label,
        value: formatPdfSectionValue(field.key, field.value)
      }))
    ];

    const contactSectionFields = [
      ...contactFields.map((field) => ({
        label: field.label,
        value: formatPdfSectionValue(field.key, field.value)
      })),
      { label: "Canal recomendado", value: record.aiRecord.contactChannel },
      { label: "Completude", value: record.aiRecord.dataCompleteness },
      { label: "Observação comercial", value: record.aiRecord.commercialNote }
    ];

    return {
      position: record.position,
      title: blankWhenMissing(record.aiRecord.companyName) || blankWhenMissing(display.company_name) || "Registro sem nome",
      subtitle: [blankWhenMissing(record.aiRecord.cnpjFormatted), blankWhenMissing(record.aiRecord.tradeName)].filter(Boolean).join(" • "),
      sections: [
        {
          title: "Dados principais",
          fields: buildPdfFields(primarySectionFields)
        },
        {
          title: "Contato e endereço",
          fields: buildPdfFields(contactSectionFields)
        }
      ]
    };
  });

  const summary = [...payload.summary];

  if (payload.strategy?.xlsx) {
    summary.unshift({ label: "Estratégia do XLSX", value: payload.strategy.xlsx });
  }
  if (payload.strategy?.pdf) {
    summary.unshift({ label: "Estratégia do PDF", value: payload.strategy.pdf });
  }
  if (payload.strategy?.pdfSafety) {
    summary.unshift({ label: "Segurança visual do PDF", value: payload.strategy.pdfSafety });
  }

  return {
    title: `${payload.headline} · Lista formatada por IA`,
    subtitle: payload.subtitle,
    generatedAt: formatDateTime(payload.generatedAt),
    summary,
    records
  };
}
