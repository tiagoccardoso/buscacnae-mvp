export function formatCnpj(value?: string | null) {
  const input = (value ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (input.length !== 14) return value ?? "-";
  return `${input.slice(0, 2)}.${input.slice(2, 5)}.${input.slice(5, 8)}/${input.slice(8, 12)}-${input.slice(12, 14)}`;
}

export function formatDateTime(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

export function formatMoney(value?: number | string | null) {
  const amount = typeof value === "string" ? Number(value) : value ?? 0;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number.isFinite(amount) ? amount : 0);
}
