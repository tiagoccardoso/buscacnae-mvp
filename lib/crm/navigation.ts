/**
 * Retorno seguro após uma server action do CRM: só caminhos internos de /dashboard,
 * sem "//" (evita redirecionamento aberto). Preserva a query (filtros, busca, página).
 */
export function safeReturnTo(value: unknown, fallback: string) {
  const path = String(value ?? "");
  return /^\/dashboard(\/[A-Za-z0-9_\-/.%]*)?(\?[A-Za-z0-9_\-=&.%+]*)?$/.test(path) && !path.includes("//") ? path : fallback;
}

/** Acrescenta status/erro à URL de retorno, descartando feedback anterior. */
export function withParams(path: string, params: Record<string, string>) {
  const [base, query = ""] = path.split("?");
  const search = new URLSearchParams(query);
  for (const key of ["status", "error", "detail"]) search.delete(key);
  for (const [key, value] of Object.entries(params)) search.set(key, value);
  const text = search.toString();
  return text ? `${base}?${text}` : base;
}
