export function formatCnpj(value?: string | null) {
  const input = (value ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (input.length !== 14) return value ?? "-";
  return `${input.slice(0, 2)}.${input.slice(2, 5)}.${input.slice(5, 8)}/${input.slice(8, 12)}-${input.slice(12, 14)}`;
}

export function formatDate(value?: string | null) {
  if (!value) return "-";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short"
  }).format(parsed);
}

export function formatDateTime(value?: string | null) {
  if (!value) return "-";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(parsed);
}

function parseMoneyValue(value: number | string) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  const sanitized = trimmed.replace(/\s+/g, "").replace(/R\$/gi, "");
  if (!sanitized) return null;

  let normalized = sanitized;

  if (sanitized.includes(",") && sanitized.includes(".")) {
    normalized = sanitized.lastIndexOf(",") > sanitized.lastIndexOf(".")
      ? sanitized.replace(/\./g, "").replace(",", ".")
      : sanitized.replace(/,/g, "");
  } else if (sanitized.includes(",")) {
    const parts = sanitized.split(",");
    normalized = parts.length === 2 && parts[1].length <= 2
      ? sanitized.replace(/\./g, "").replace(",", ".")
      : sanitized.replace(/,/g, "");
  } else if ((sanitized.match(/\./g) ?? []).length > 1) {
    normalized = sanitized.replace(/\./g, "");
  } else if (/^\d+\.\d{3}$/.test(sanitized)) {
    normalized = sanitized.replace(/\./g, "");
  }

  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

export function formatMoney(value?: number | string | null) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  const amount = parseMoneyValue(value);
  if (amount === null) {
    return "-";
  }

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(amount);
}
