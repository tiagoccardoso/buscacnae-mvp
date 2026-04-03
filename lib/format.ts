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

export function formatMoney(value?: number | string | null) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  const amount = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(amount)) {
    return "-";
  }

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(amount);
}
