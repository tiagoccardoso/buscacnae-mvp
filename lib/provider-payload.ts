/**
 * Higienização do `provider_payload` persistido.
 *
 * A Casa dos Dados é a única fonte autorizada de dados empresariais. Registros
 * gravados por versões antigas ainda podem carregar, dentro do JSON salvo no
 * banco, respostas de fontes aposentadas e mensagens técnicas de enriquecimento.
 * Esses blocos nunca devem chegar à ficha, à lista, ao mapa ou às exportações.
 * Nenhuma chamada externa é feita por este módulo.
 */

function normalizePayloadKey(key: string) {
  return key
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}

/**
 * Identifica metadados técnicos que pertencem a integrações aposentadas.
 *
 * O payload atual usa `consulta_cnpj` como wrapper válido e os blocos
 * `casadosdados_*` como fonte oficial. Consultas com o sufixo `_consulta`,
 * além de mensagens/status de enriquecimento, são estruturas históricas e
 * não representam dados cadastrais atuais.
 */
function isRetiredPayloadKey(key: string) {
  const normalized = normalizePayloadKey(key);
  const isCurrentConsultationWrapper = normalized === "consultacnpj";
  const isRetiredConsultation = normalized.endsWith("consulta") && !isCurrentConsultationWrapper;
  const isTechnicalEnrichmentMetadata = normalized.includes("enriquecimento") || normalized.includes("enrichment");

  return isRetiredConsultation || isTechnicalEnrichmentMetadata;
}

const MAX_DEPTH = 12;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Remove recursivamente os blocos legados. Retorna uma cópia; o valor original não é alterado. */
export function sanitizeProviderPayload<T = unknown>(value: T, depth = 0): T {
  if (depth > MAX_DEPTH) return value;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeProviderPayload(item, depth + 1)) as unknown as T;
  }

  if (isPlainObject(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (isRetiredPayloadKey(key)) continue;
      output[key] = sanitizeProviderPayload(nested, depth + 1);
    }
    return output as T;
  }

  return value;
}

/** Indica se o payload ainda contém dados salvos pela integração removida. */
export function hasLegacyProviderData(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false;

  if (Array.isArray(value)) {
    return value.some((item) => hasLegacyProviderData(item, depth + 1));
  }

  if (isPlainObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      if (isRetiredPayloadKey(key) && nested !== null && nested !== undefined) return true;
      if (hasLegacyProviderData(nested, depth + 1)) return true;
    }
  }

  return false;
}

/** Indica se o payload já contém a consulta detalhada da Casa dos Dados. */
export function hasCasaDosDadosDetail(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const detail = value.casadosdados_detalhe;
  return isPlainObject(detail) && Object.keys(detail).length > 0;
}

/** Cópia rasa do registro com `provider_payload` higienizado. */
export function withSanitizedProviderPayload<T extends Record<string, unknown> | null | undefined>(record: T): T {
  if (!record) return record;
  if (!("provider_payload" in record)) return record;
  return { ...record, provider_payload: sanitizeProviderPayload(record.provider_payload) } as T;
}
