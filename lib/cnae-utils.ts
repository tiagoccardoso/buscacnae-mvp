export function normalizeCnaeCode(value: string) {
  return value.replace(/\D/g, "");
}

export function formatCnaeCode(value: string) {
  const digits = normalizeCnaeCode(value);
  if (digits.length !== 7) return digits || value.trim();
  return `${digits.slice(0, 4)}-${digits.slice(4, 5)}/${digits.slice(5)}`;
}
