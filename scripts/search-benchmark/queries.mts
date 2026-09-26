/**
 * Conjunto de consultas do benchmark, com gabarito calculado sobre a base sintética.
 * Cada consulta tem a INTENÇÃO explícita (predicado `relevant`), independente do motor.
 */
import type { BenchCompany } from "./dataset.mts";
import { foldSearchText, LEGAL_SUFFIX_WORDS, PT_STOP_WORDS } from "../../lib/search/text.ts";

export type BenchQuery = {
  id: string;
  category: string;
  q: string;
  stateCodes?: string[];
  relevant: (row: BenchCompany) => boolean;
};

function nameTokens(row: BenchCompany) {
  return foldSearchText(row.company_name)
    .split(" ")
    .filter((token) => token && !LEGAL_SUFFIX_WORDS.has(token) && !/^\d+$/.test(token) && !PT_STOP_WORDS.has(token));
}

function tradeTokens(row: BenchCompany) {
  return foldSearchText(row.trade_name ?? "").split(" ").filter((token) => token && !PT_STOP_WORDS.has(token));
}

function containsAll(haystack: string, tokens: string[]) {
  const words = new Set(haystack.split(" "));
  return tokens.every((token) => words.has(token));
}

/** Um erro de digitação determinístico numa palavra (troca, omissão, substituição ou inserção). */
function typo(word: string, random: () => number) {
  if (word.length < 5) return word;
  const position = 1 + Math.floor(random() * (word.length - 2));
  const kind = Math.floor(random() * 4);
  const letters = "aeioursntlcdm";
  if (kind === 0) return word.slice(0, position) + word[position + 1] + word[position] + word.slice(position + 2);
  if (kind === 1) return word.slice(0, position) + word.slice(position + 1);
  if (kind === 2) {
    const replacement = letters[Math.floor(random() * letters.length)];
    return word.slice(0, position) + (replacement === word[position] ? "x" : replacement) + word.slice(position + 1);
  }
  return word.slice(0, position) + letters[Math.floor(random() * letters.length)] + word.slice(position);
}

function withTypoInLongestWord(tokens: string[], random: () => number) {
  let longest = 0;
  tokens.forEach((token, index) => {
    if (token.length > tokens[longest].length) longest = index;
  });
  return tokens.map((token, index) => (index === longest ? typo(token, random) : token));
}

function formatCnpj(cnpj: string) {
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}

export function buildBenchQueries(rows: BenchCompany[], random: () => number): BenchQuery[] {
  const queries: BenchQuery[] = [];
  const pickRow = (predicate: (row: BenchCompany) => boolean) => {
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      const row = rows[Math.floor(random() * rows.length)];
      if (predicate(row)) return row;
    }
    throw new Error("Nenhuma linha para o predicado do benchmark.");
  };
  const byName = (tokens: string[]) => (row: BenchCompany) => containsAll(foldSearchText(`${row.company_name} ${row.trade_name ?? ""}`), tokens);

  // 1. Razão social exata (sem sufixo societário).
  for (let index = 0; index < 10; index += 1) {
    const row = pickRow((candidate) => nameTokens(candidate).length >= 2 && !/\d{11}/.test(candidate.company_name));
    const tokens = nameTokens(row);
    queries.push({ id: `razao-${index}`, category: "razão social", q: tokens.join(" "), relevant: byName(tokens) });
  }
  // 2. Razão social com erro de digitação.
  for (let index = 0; index < 20; index += 1) {
    const row = pickRow((candidate) => nameTokens(candidate).some((token) => token.length >= 6) && !/\d{11}/.test(candidate.company_name));
    const tokens = nameTokens(row);
    queries.push({ id: `typo-${index}`, category: "typo", q: withTypoInLongestWord(tokens, random).join(" "), relevant: byName(tokens) });
  }
  // 3. Acentos: consulta sem acento para nome acentuado, e com acento para nome gravado sem acento.
  for (let index = 0; index < 8; index += 1) {
    const row = pickRow((candidate) => /[À-ÿ]/.test(candidate.company_name) && nameTokens(candidate).length >= 2);
    const tokens = nameTokens(row);
    queries.push({ id: `acento-sem-${index}`, category: "acentos", q: tokens.join(" "), relevant: byName(tokens) });
  }
  const accentPairs: Array<[string, string]> = [
    ["CONCEICAO", "Conceição"], ["LOGISTICA", "Logística"], ["ARAUJO", "Araújo"], ["MECANICA", "Mecânica"],
    ["FARMACIA", "Farmácia"], ["CONSTRUCOES", "Construções"], ["GONCALVES", "Gonçalves"], ["MAGALHAES", "Magalhães"]
  ];
  accentPairs.forEach(([plain, accented], index) => {
    const row = pickRow((candidate) => candidate.company_name.includes(plain) && nameTokens(candidate).length >= 2);
    const tokens = nameTokens(row);
    const q = row.company_name
      .replace(plain, accented)
      .split(" ")
      .filter((word) => !LEGAL_SUFFIX_WORDS.has(foldSearchText(word)) && !/^\d+$/.test(word))
      .join(" ");
    queries.push({ id: `acento-com-${index}`, category: "acentos", q, relevant: byName(tokens) });
  });
  // 4. CNPJ: com máscara, só dígitos e raiz.
  for (let index = 0; index < 5; index += 1) {
    const row = pickRow(() => true);
    queries.push({ id: `cnpj-mask-${index}`, category: "CNPJ", q: formatCnpj(row.cnpj), relevant: (candidate) => candidate.cnpj === row.cnpj });
  }
  for (let index = 0; index < 5; index += 1) {
    const row = pickRow(() => true);
    queries.push({ id: `cnpj-digits-${index}`, category: "CNPJ", q: row.cnpj, relevant: (candidate) => candidate.cnpj === row.cnpj });
  }
  for (let index = 0; index < 5; index += 1) {
    const row = pickRow(() => true);
    const root = row.cnpj.slice(0, 8);
    queries.push({ id: `cnpj-root-${index}`, category: "CNPJ", q: root, relevant: (candidate) => candidate.cnpj.startsWith(root) });
  }
  // 5. Nome fantasia (exato e com erro).
  for (let index = 0; index < 10; index += 1) {
    const row = pickRow((candidate) => tradeTokens(candidate).length >= 2);
    const tokens = tradeTokens(row);
    const q = index < 5 ? tokens.join(" ") : withTypoInLongestWord(tokens, random).join(" ");
    queries.push({ id: `fantasia-${index}`, category: "nome fantasia", q, relevant: byName(tokens) });
  }
  // 6. CNAE por código.
  for (const code of ["4930202", "4721102", "5611201", "6201501"]) {
    const formatted = `${code.slice(0, 4)}-${code.slice(4, 5)}/${code.slice(5)}`;
    queries.push({ id: `cnae-${code}`, category: "CNAE", q: formatted, relevant: (row) => row.primary_cnae_code === code });
  }
  // 7. Atividade + cidade (sem erro) e 8. com erro de digitação (inclui o exemplo do enunciado).
  const activityCity: Array<{ id: string; q: string; prefix: string; city: string; uf: string; category: string }> = [
    { id: "ativ-1", q: "padaria curitiba", prefix: "4721", city: "Curitiba", uf: "PR", category: "atividade + cidade" },
    { id: "ativ-2", q: "restaurante londrina", prefix: "5611", city: "Londrina", uf: "PR", category: "atividade + cidade" },
    { id: "ativ-3", q: "construtora joinville", prefix: "4120", city: "Joinville", uf: "SC", category: "atividade + cidade" },
    { id: "ativ-4", q: "farmacia campinas", prefix: "4771", city: "Campinas", uf: "SP", category: "atividade + cidade" },
    { id: "ativ-5", q: "transportadora cascavel", prefix: "4930", city: "Cascavel", uf: "PR", category: "atividade + cidade" },
    { id: "ativ-6", q: "supermercado porto alegre", prefix: "4711", city: "Porto Alegre", uf: "RS", category: "atividade + cidade" },
    { id: "ptyp-1", q: "transportadoras pato brnaco", prefix: "4930", city: "Pato Branco", uf: "PR", category: "atividade + cidade c/ erro" },
    { id: "ptyp-2", q: "padarias curitba", prefix: "4721", city: "Curitiba", uf: "PR", category: "atividade + cidade c/ erro" },
    { id: "ptyp-3", q: "restaurantes londrna", prefix: "5611", city: "Londrina", uf: "PR", category: "atividade + cidade c/ erro" },
    { id: "ptyp-4", q: "oficina mecanica maringa", prefix: "4520", city: "Maringá", uf: "PR", category: "atividade + cidade c/ erro" },
    { id: "ptyp-5", q: "construtora joinvile", prefix: "4120", city: "Joinville", uf: "SC", category: "atividade + cidade c/ erro" },
    { id: "ptyp-6", q: "farmacia campinaz", prefix: "4771", city: "Campinas", uf: "SP", category: "atividade + cidade c/ erro" },
    { id: "ptyp-7", q: "salao de beleza florianopolis", prefix: "9602", city: "Florianópolis", uf: "SC", category: "atividade + cidade c/ erro" },
    { id: "ptyp-8", q: "transportes fracisco beltrao", prefix: "4930", city: "Francisco Beltrão", uf: "PR", category: "atividade + cidade c/ erro" }
  ];
  for (const item of activityCity) {
    queries.push({
      id: item.id,
      category: item.category,
      q: item.q,
      relevant: (row) => row.primary_cnae_code.startsWith(item.prefix) && row.city_name === item.city && row.state_code === item.uf
    });
  }
  // 9. UF como filtro explícito (faceta escolhida na interface).
  for (const [id, q, prefix, uf] of [
    ["uf-1", "transportadora", "4930", "PR"],
    ["uf-2", "padaria", "4721", "SC"],
    ["uf-3", "contabilidade", "6920", "SP"],
    ["uf-4", "hotel", "5510", "RS"]
  ] as const) {
    queries.push({ id, category: "UF (filtro)", q, stateCodes: [uf], relevant: (row) => row.primary_cnae_code.startsWith(prefix) && row.state_code === uf });
  }
  return queries;
}
