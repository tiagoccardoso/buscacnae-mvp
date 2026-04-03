import crypto from "node:crypto";

export function normalizeCnpj(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export function normalizeCode(value: string) {
  return value.replace(/\D/g, "");
}

export function normalizeText(value: string) {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function toTitleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((chunk) => chunk[0]?.toUpperCase() + chunk.slice(1).toLowerCase())
    .join(" ");
}

export function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function parseBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (["true", "sim", "yes", "1", "s"].includes(normalized)) return true;
    if (["false", "nao", "não", "no", "0", "n"].includes(normalized)) return false;
  }
  return null;
}

export function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const normalized = value.replace(/\./g, "").replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function coalesceString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function coalesceObject(...values: unknown[]) {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return null;
}

export function coalesceArray(...values: unknown[]) {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value;
    }
  }
  return null;
}

export function extractSingleObject(value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        return item as Record<string, unknown>;
      }
    }
    return null;
  }

  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }

  return null;
}

export function safeJsonStringify(value: unknown, space = 0) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, space);
  } catch {
    return String(value);
  }
}

function toFlatString(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "string") return value;
  return safeJsonStringify(value, 0);
}

export function flattenUnknownToRows(
  value: unknown,
  parentPath = ""
): Array<{ path: string; value: string }> {
  if (value === null || value === undefined) {
    return [{ path: parentPath || "(raiz)", value: "" }];
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [{ path: parentPath || "(raiz)", value: toFlatString(value) }];
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [{ path: parentPath || "(raiz)", value: "[]" }];
    }

    return value.flatMap((item, index) => flattenUnknownToRows(item, `${parentPath}[${index}]`));
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return [{ path: parentPath || "(raiz)", value: "{}" }];
    }

    return entries.flatMap(([key, nestedValue]) =>
      flattenUnknownToRows(nestedValue, parentPath ? `${parentPath}.${key}` : key)
    );
  }

  return [{ path: parentPath || "(raiz)", value: String(value) }];
}
