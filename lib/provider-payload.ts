/**
 * Higienização do `provider_payload` persistido.
 *
 * A Casa dos Dados é a única fonte autorizada de dados empresariais. Registros
 * gravados antes da remoção da CNPJ.ws ainda podem carregar, dentro do JSON
 * salvo no banco, a resposta daquela fonte (`cnpjws_consulta`) e mensagens
 * técnicas de enriquecimento (`erro_enriquecimento_*`).
 *
 * Esses blocos NUNCA devem chegar à ficha, à lista, ao mapa ou às exportações:
 * eles são removidos aqui, de forma centralizada, antes de qualquer leitura.
 * Nenhuma chamada externa é feita por este módulo.
 */

/** Chaves legadas que não pertencem às fontes atualmente autorizadas. */
export const LEGACY_PROVIDER_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  "cnpjws_consulta",
  "erro_enriquecimento_cnpjws",
  "erro_enriquecimento_casadosdados"
]);

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
      if (LEGACY_PROVIDER_PAYLOAD_KEYS.has(key)) continue;
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
      if (key === "cnpjws_consulta" && nested !== null && nested !== undefined) return true;
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
