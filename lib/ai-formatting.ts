import { getOpenAiApiKey, getOpenAiModel } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatCnpj, formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { getSearchSummary } from "@/lib/search-summary";
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
  summary: Array<{ label: string; value: string }>;
  records: SearchAiFormattedRecord[];
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

async function formatChunkWithOpenAi(records: FormattingSourceRecord[]) {
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
        "Você organiza listas comerciais B2B no Brasil. Responda apenas JSON válido com o formato {\"items\":[{\"position\": number, \"companyName\": string, \"tradeName\": string, \"registrationStatus\": string, \"primaryActivity\": string, \"legalNature\": string, \"companySize\": string, \"taxProfile\": string, \"location\": string, \"address\": string, \"phone\": string, \"email\": string, \"website\": string, \"contactChannel\": string, \"dataCompleteness\": string, \"commercialNote\": string}]}. Use somente os dados fornecidos. Não invente dados ausentes. Preserve posição. Padronize nomes, contatos e endereço. commercialNote deve ter no máximo 18 palavras.",
      input: safeJsonStringify({ items: records }, 2),
      max_output_tokens: 4500,
      temperature: 0.2
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
    items?: Array<Partial<SearchAiFormattedRecord> & { position?: number }>;
  };

  if (!Array.isArray(parsed.items)) {
    return null;
  }

  return parsed.items;
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
  const primaryActivity = typeof partial?.primaryActivity === "string" && partial.primaryActivity.trim()
    ? partial.primaryActivity.trim()
    : sourceRecord.primaryActivity;
  const legalNature = typeof partial?.legalNature === "string" && partial.legalNature.trim()
    ? partial.legalNature.trim()
    : sourceRecord.legalNature;
  const companySize = typeof partial?.companySize === "string" && partial.companySize.trim()
    ? partial.companySize.trim()
    : sourceRecord.companySize;
  const taxProfile = typeof partial?.taxProfile === "string" && partial.taxProfile.trim()
    ? partial.taxProfile.trim()
    : sourceRecord.taxProfile;
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
    primaryActivity,
    legalNature,
    companySize,
    taxProfile,
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
      .select("position, establishments(*)")
      .eq("search_query_id", order.search_query_id)
      .order("position", { ascending: true })
  ]);

  const sourceRecords = (rows ?? [])
    .map((row) => {
      const establishment = extractSingleObject(row.establishments);
      if (!establishment) return null;
      return buildSourceRecord(Number(row.position ?? 0), establishment);
    })
    .filter((item): item is FormattingSourceRecord => Boolean(item));

  const fallbackRecords = createFallbackRecords(sourceRecords);
  let formattedRecords = fallbackRecords;
  let generator: SearchAiFormattedPayload["generator"] = "fallback";

  try {
    const chunkSize = 12;
    const aiRecords = new Map<number, Partial<SearchAiFormattedRecord> & { position?: number }>();

    for (let start = 0; start < sourceRecords.length; start += chunkSize) {
      const chunk = sourceRecords.slice(start, start + chunkSize);
      const formattedChunk = await formatChunkWithOpenAi(chunk);

      if (!formattedChunk) {
        aiRecords.clear();
        break;
      }

      for (const item of formattedChunk) {
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
  const summaryRows = [
    ["Título", payload.headline],
    ["Subtítulo", payload.subtitle],
    ["Gerado em", formatDateTime(payload.generatedAt)],
    ["Gerador", payload.generator === "openai" ? `OpenAI (${payload.model})` : `Fallback (${payload.model})`],
    ["Total de registros", String(payload.totalRecords)],
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
