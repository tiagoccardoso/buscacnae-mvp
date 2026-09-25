/**
 * Limite de perguntas por usuário (janela deslizante, em memória).
 *
 * Protege custo de LLM e CPU. Em serverless cada instância tem a própria memória, então
 * o limite é "por instância" — suficiente contra abuso acidental; para um limite global,
 * troque o Map por uma tabela/Redis (ver docs/IA_EMPRESARIAL.md).
 */
const WINDOW_MS = 10 * 60 * 1000;
const hits = new Map<string, number[]>();

export function checkRateLimit(key: string, limit: number, now = Date.now()) {
  const recent = (hits.get(key) ?? []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= limit) {
    hits.set(key, recent);
    const retryAfter = Math.ceil((WINDOW_MS - (now - recent[0])) / 1000);
    return { limited: true as const, retryAfter };
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [entry, times] of hits) if (times.every((time) => now - time >= WINDOW_MS)) hits.delete(entry);
  }
  return { limited: false as const, remaining: limit - recent.length };
}

export function resetRateLimit() {
  hits.clear();
}
