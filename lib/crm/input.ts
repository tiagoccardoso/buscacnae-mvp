/**
 * Normalização de entradas do CRM (formulários e server actions).
 * Tudo que chega do cliente passa por aqui antes de tocar no banco.
 */

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_IMPORT = 1000;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function cleanText(value: unknown, max: number) {
  const text = String(value ?? "").replace(/\r\n/g, "\n").trim();
  return text ? text.slice(0, max) : null;
}

export function uuidList(values: unknown, max = MAX_IMPORT) {
  const list = Array.isArray(values) ? values : [];
  return Array.from(new Set(list.map((value) => String(value ?? "").trim().toLowerCase()).filter((value) => UUID_PATTERN.test(value)))).slice(0, max);
}

/** "R$ 12.500,90" | "12500.9" | "12500" → centavos. Vazio → null. Inválido → undefined. */
export function parseAmountToCents(value: unknown): number | null | undefined {
  const raw = String(value ?? "").replace(/[R$\s]/g, "").trim();
  if (!raw) return null;
  let normalized = raw;
  if (raw.includes(",")) normalized = raw.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) normalized = raw.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return undefined;
  const cents = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : undefined;
}

export function formatCents(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Data (AAAA-MM-DD) válida ou null. */
export function parseDateOnly(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T12:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw ? null : raw;
}

/** datetime-local ("2026-09-30T14:00") interpretado no fuso de São Paulo (UTC-3). */
export function parseLocalDateTime(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const dateOnly = parseDateOnly(raw);
  if (dateOnly) return new Date(`${dateOnly}T12:00:00-03:00`).toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}:00-03:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function cleanEmail(value: unknown) {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : undefined;
}

export function cleanPhone(value: unknown) {
  const phone = String(value ?? "").replace(/[^\d+()\-\s]/g, "").trim();
  return phone ? phone.slice(0, 40) : null;
}

/**
 * Lista → CRM: decide o que criar. Empresas que já têm negócio no workspace não
 * são duplicadas (a UNIQUE(workspace_id, establishment_id) também garante isso).
 */
export function planImport(establishmentIds: unknown, existing: Iterable<string>) {
  const ids = uuidList(establishmentIds);
  const existingSet = new Set(Array.from(existing, (id) => id.toLowerCase()));
  const toCreate = ids.filter((id) => !existingSet.has(id));
  return { toCreate, alreadyInCrm: ids.length - toCreate.length, requested: ids.length };
}
