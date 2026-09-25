import { foldText } from "@/lib/analytics/dimensions";
import { normalizePlaceName } from "@/lib/geo/municipalities";
import { emptyPlan, type RawPlan } from "@/lib/ai/plan";
import { UF_NAMES, hasMunicipalityName, type Vocabulary } from "@/lib/ai/vocabulary";
import type { AiDimension, AiToolName } from "@/lib/ai/types";

/**
 * Intérprete por REGRAS (pt-BR), sem rede e sem modelo.
 *
 * Usado quando não há chave de LLM configurada, quando o modelo falha/estoura o tempo e
 * nos testes. Produz exatamente o mesmo contrato (`RawPlan`) do planejador com LLM, então
 * a resolução de entidades, a execução e a resposta são idênticas nos dois caminhos.
 */

export type RulesContext = {
  vocabulary: Vocabulary;
  referenceDate: string;
  previousTool: AiToolName | null;
  previousGroupBy: AiDimension | null;
};

const NUMBER_WORDS: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  doze: 12,
  quinze: 15,
  vinte: 20,
  trinta: 30
};

const DIMENSION_WORDS: Array<[RegExp, AiDimension]> = [
  [/^(municipios?|cidades?|localidades?)$/, "municipality"],
  [/^(estados?|ufs?)$/, "state"],
  [/^(cnaes?|atividades?|setor(es)?|ramos?|segmentos?)$/, "cnae"],
  [/^(portes?|tamanhos?)$/, "size"],
  [/^(situac(ao|oes)|status)$/, "status"],
  [/^(capital|capitais|faixas?)$/, "capital"],
  [/^(anos?)$/, "openedYear"],
  [/^(mes|meses)$/, "openedMonth"]
];

function dimensionOf(word: string): AiDimension | null {
  for (const [pattern, dimension] of DIMENSION_WORDS) if (pattern.test(word)) return dimension;
  return null;
}

/** Palavras que nunca são atividade/cidade (intenção, filtros, conectivos). */
const KEYWORDS = new Set(
  (
    "a o as os um uma de da do das dos em no na nos nas e ou com sem por para que qual quais quanto quantas quantos " +
    "empresa empresas estabelecimento estabelecimentos cnpj cnpjs negocio negocios " +
    "municipio municipios cidade cidades estado estados uf ufs regiao regioes localidade localidades " +
    "mais menos maior maiores menor menores possuem possui tem ha existem existe concentram concentra numero total quantidade qtd " +
    "mostre mostrar mostra exiba exibir veja ver liste listar lista abra abrir coloque aplique aplicar filtre filtrar filtro filtros " +
    "somente apenas so agora tambem entao todas todos toda todo sobre desta dessa nesta nessa busca resultado resultados universo " +
    "compare comparar comparacao comparativo versus vs entre x " +
    "grafico graficos mapa lista tabela painel inteligencia dashboard indicadores ranking top " +
    "abertas aberta abertos aberto abriram fundadas criadas novas novos recentes antigas antigos ano anos mes meses ultimos ultimo ultimas ultima desde ate antes depois este esse neste nesse " +
    "ativas ativa inativas inativa baixadas baixada inaptas inapta suspensas suspensa nulas nula situacao status " +
    "porte portes me mei epp demais micro microempresa microempresas pequeno pequena pequenas grande grandes medio media medias " +
    "matriz matrizes filial filiais telefone telefones celular email emails contato contatos whatsapp " +
    "capital social acima abaixo milhao milhoes mil reais " +
    "resumo resuma panorama visao geral perfil cada distribuicao evolucao ordem ordene ordenadas alfabetica recente " +
    "me diga fale quero gostaria saber pode poderia favor por favor " +
    "janeiro fevereiro marco abril maio junho julho agosto setembro outubro novembro dezembro"
  ).split(/\s+/)
);

function wordsToNumber(value: string) {
  return /^\d+$/.test(value) ? Number(value) : NUMBER_WORDS[value] ?? null;
}

function parseMoney(amount: string, unit: string | undefined) {
  const numeric = Number(amount.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(numeric)) return null;
  const multiplier = unit && /^(mi|milhao|milhoes)$/.test(unit) ? 1_000_000 : unit && /^(mil|k)$/.test(unit) ? 1_000 : 1;
  return numeric * multiplier;
}

/** Nomes de UF dobrados (sem acento), do maior para o menor ("rio grande do sul" antes de "para"). */
const STATE_NAME_PATTERNS = Object.entries(UF_NAMES)
  .map(([uf, name]) => ({ uf, folded: foldText(name) }))
  .sort((left, right) => right.folded.length - left.folded.length);

type Mention = { value: string; start: number; end: number };

const CONNECTIVES = ["em", "de", "do", "da", "entre", "compare", "comparar", "com", "e", "x", "vs", "versus", "contra", "sobre", "para"];
/** Nome com inicial maiúscula depois de um conectivo (o conectivo aceita maiúscula: "Compare Cascavel…"). */
const CITY_AFTER_CONNECTIVE = new RegExp(
  `(?:^|,\\s*|\\b(?:${CONNECTIVES.map((word) => `[${word[0].toUpperCase()}${word[0]}]${word.slice(1)}`).join("|")})\\s+)((?:[A-ZÀ-Ý][\\p{L}'’-]+)(?:\\s+(?:d[aeo]s?\\s+)?[A-ZÀ-Ý][\\p{L}'’-]+){0,4})(\\s*(?:\\/|-|\\()\\s*[A-Z]{2}\\)?)?`,
  "gu"
);

function overlaps(mentions: Mention[], start: number, end: number) {
  return mentions.some((mention) => start < mention.end && end > mention.start);
}

export function interpretWithRules(question: string, context: RulesContext): RawPlan {
  const original = question;
  const t = foldText(question);
  const plan = emptyPlan("searchCompanies");
  const f = plan.filters;
  const refYear = Number(context.referenceDate.slice(0, 4));
  const consumed: Mention[] = [];

  /* ---------- saudações e conversa fiada */
  if (/^(oi|ola|bom dia|boa tarde|boa noite|e ai|tudo bem|obrigad[oa]|valeu|ok|beleza)\b[\s!.?]*$/.test(t)) {
    plan.action = "clarify";
    plan.clarification =
      "Olá! Pergunte sobre as empresas desta busca: quantas são, onde se concentram, comparação entre cidades, filtros por porte ou abertura, ou peça para mostrar no mapa.";
    return plan;
  }

  /* ---------- perguntas impossíveis com estes dados */
  if (
    /\b(faturamento|faturam|receita|lucro|lucrativ|rentabilidade|margem|funcionarios|empregados|colaboradores|folha de pagamento|populacao|habitantes|pib|renda per capita|market share|participacao de mercado|fatia de mercado|previsao|projecao|projetar|prever|vai crescer|vao crescer|crescera|daqui a|no futuro|investir|melhor empresa|mais confiave|reputacao|avaliac|reclamac|credito|inadimplen|divida|dividas)\b/.test(
      t
    )
  ) {
    plan.action = "unsupported";
    plan.unsupportedReason = "no_data";
    return plan;
  }

  /* ---------- contexto */
  if (/\b(todas as empresas|sem (nenhum )?filtros?|limp[ae]r? (os )?filtros|remov[ae]r? (os )?filtros|tir[ae]r? (os )?filtros|universo (todo|inteiro|completo)|toda a busca|busca (toda|inteira|completa)|do zero|zer[ae]r? (os )?filtros)\b/.test(t)) {
    plan.contextMode = "reset";
  }

  /* ---------- período de abertura */
  let match: RegExpExecArray | null;
  if ((match = /\b(?:nos|dos|nas|das|ha|nestes|ultimos|ultimas)?\s*(?:ultimos|ultimas)\s+(\d{1,3}|[a-z]+)\s+(anos?|mes(?:es)?)\b/.exec(t))) {
    const amount = wordsToNumber(match[1]);
    if (amount) f.openedLastMonths = match[2].startsWith("ano") ? amount * 12 : amount;
  } else if (/\b(no ultimo ano|nos ultimos doze meses|ultimo ano|novas|novos|recentes|recem abertas|recem-abertas)\b/.test(t)) {
    f.openedLastMonths = 12;
  } else if (/\b(no ultimo mes|ultimo mes|este mes|neste mes)\b/.test(t)) {
    f.openedLastMonths = 1;
  }
  if ((match = /\b(?:entre|de)\s+(\d{4})\s+(?:e|a|ate)\s+(\d{4})\b/.exec(t))) {
    const from = Number(match[1]);
    const to = Number(match[2]);
    f.openedYearFrom = Math.min(from, to);
    f.openedYearTo = Math.max(from, to);
  } else if ((match = /\b(?:desde|a partir de)\s+(\d{4})\b/.exec(t))) {
    f.openedYearFrom = Number(match[1]);
    f.openedYearTo = refYear;
  } else if ((match = /\b(?:antes de)\s+(\d{4})\b/.exec(t))) {
    f.openedYearFrom = 1800;
    f.openedYearTo = Number(match[1]) - 1;
  } else if ((match = /\b(?:abertas?|abertos?|fundadas?|criadas?|abriram|abertura)\s+(?:em|no ano de|de)\s+(\d{4})\b/.exec(t)) || (match = /\b(?:em|no ano de)\s+((?:19|20)\d{2})\b/.exec(t))) {
    f.openedYearFrom = Number(match[1]);
    f.openedYearTo = Number(match[1]);
  } else if (/\b(este ano|neste ano|esse ano|nesse ano|ano atual)\b/.test(t)) {
    f.openedYearFrom = refYear;
    f.openedYearTo = refYear;
  }

  /* ---------- situação */
  if (/\b(nao ativas?|inativas?|encerradas?|fechadas?)\b/.test(t)) f.status = "inativas";
  else if (/\bbaixadas?\b/.test(t)) f.status = "baixada";
  else if (/\binaptas?\b/.test(t)) f.status = "inapta";
  else if (/\bsuspensas?\b/.test(t)) f.status = "suspensa";
  else if (/\bativas?\b/.test(t) || /\bem atividade\b/.test(t)) f.status = "ativas";

  /* ---------- porte ("me" minúsculo é pronome: só a sigla em maiúsculas conta) */
  const sizes: string[] = [];
  if (/\bME\b/.test(original) || /\b(microempresas?|micro empresas?|porte me)\b/.test(t)) sizes.push("ME");
  if (/\bepp\b/.test(t) || /\bpequeno porte\b/.test(t)) sizes.push("EPP");
  if (/\bMEI\b/.test(original) || /\bmicroempreendedor(es)? individua(l|is)\b/.test(t)) sizes.push("MEI");
  if (/\bDEMAIS\b/.test(original) || /\b(porte demais|grande porte|medio porte|grandes empresas)\b/.test(t)) sizes.push("DEMAIS");
  if (sizes.length > 0) f.sizes = sizes;

  /* ---------- contato e unidade */
  if (/\bcom (telefone ou e-?mail|contato|algum contato)\b/.test(t)) f.contact = "any";
  else if (/\bcom (celular|whatsapp)\b/.test(t)) f.contact = "mobile";
  else if (/\bcom (telefone|fone)\b/.test(t)) f.contact = "phone";
  else if (/\bcom e-?mail\b/.test(t)) f.contact = "email";
  if (/\b(matriz|matrizes)\b/.test(t) && !/\bfiliais?\b/.test(t)) f.branch = "matriz";
  else if (/\b(filial|filiais)\b/.test(t) && !/\bmatriz(es)?\b/.test(t)) f.branch = "filial";

  /* ---------- capital social */
  if ((match = /\bcapital(?: social)?\s+(?:acima de|maior que|superior a|de mais de|a partir de|mais de)\s*(?:r\$)?\s*([\d.,]+)\s*(mil|k|mi|milhao|milhoes)?\b/.exec(t))) {
    f.capitalMin = parseMoney(match[1], match[2]);
  }
  if ((match = /\bcapital(?: social)?\s+(?:ate|abaixo de|menor que|inferior a|de ate)\s*(?:r\$)?\s*([\d.,]+)\s*(mil|k|mi|milhao|milhoes)?\b/.exec(t))) {
    f.capitalMax = parseMoney(match[1], match[2]);
  }

  /* ---------- CNAE por código */
  const codes = Array.from(original.matchAll(/\b(\d{4})[-.]?(\d)[/]?(\d{2})\b/g)).map((item) => `${item[1]}${item[2]}${item[3]}`);

  /* ---------- UF (sigla em maiúsculas ou nome) */
  const states: Array<{ uf: string; start: number; explicitCity: boolean; explicitState: boolean }> = [];
  for (const item of original.matchAll(/\b([A-Z]{2})\b/g)) {
    // "Cascavel/PR": a UF só desambigua o município, não vira filtro de UF.
    const before = original.slice(Math.max(0, (item.index ?? 0) - 2), item.index ?? 0);
    if (/[/(-]\s*$/.test(before)) continue;
    if (UF_NAMES[item[1]] && item[1] !== "ME") states.push({ uf: item[1], start: item.index ?? 0, explicitCity: false, explicitState: true });
  }
  for (const { uf, folded } of STATE_NAME_PATTERNS) {
    const pattern = new RegExp(`(^|[^a-z])(${folded.replace(/ /g, "\\s+")})(?![a-z])`, "g");
    for (const item of t.matchAll(pattern)) {
      const start = (item.index ?? 0) + item[1].length;
      const end = start + item[2].length;
      if (overlaps(consumed, start, end)) continue;
      const before = t.slice(Math.max(0, start - 16), start);
      consumed.push({ value: item[2], start, end });
      states.push({ uf, start, explicitCity: /(cidade|municipio) de\s+$/.test(before), explicitState: /estado d[eo]s?\s+$/.test(before) });
    }
  }

  /* ---------- municípios */
  const cities: Array<{ name: string; start: number }> = [];
  // 1) municípios presentes na busca (nome dobrado), do maior para o menor.
  const universeNames = Array.from(context.vocabulary.labels.municipality.values())
    .map((label) => ({ label, name: foldText(label.split("/")[0]) }))
    .filter((item) => item.name.length >= 3)
    .sort((left, right) => right.name.length - left.name.length);
  for (const { label, name } of universeNames) {
    const pattern = new RegExp(`(^|[^a-z])(${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")})(?![a-z])`, "g");
    for (const item of t.matchAll(pattern)) {
      const start = (item.index ?? 0) + item[1].length;
      const end = start + item[2].length;
      if (KEYWORDS.has(name)) continue;
      const stateHit = states.find((state) => state.start === start && !state.explicitState);
      if (overlaps(consumed, start, end) && !stateHit?.explicitCity) continue;
      consumed.push({ value: name, start, end });
      // Nome sem UF (a resolução decide entre homônimos); "/PR" escrito junto é preservado.
      const suffix = /^\s*[/-]\s*([a-z]{2})\b/.exec(t.slice(end));
      const plain = label.split("/")[0];
      cities.push({ name: suffix && UF_NAMES[suffix[1].toUpperCase()] ? `${plain}/${suffix[1].toUpperCase()}` : plain, start });
    }
  }
  // 2) nomes com inicial maiúscula após conectivos ("Compare Cascavel e Pato Branco", "em Maringá/PR").
  for (const item of original.matchAll(CITY_AFTER_CONNECTIVE)) {
    const phrase = item[1];
    const words = phrase.split(/\s+/);
    const phraseStart = foldText(original.slice(0, (item.index ?? 0) + item[0].indexOf(phrase))).length;
    // Tenta todas as sub-sequências (a primeira palavra pode ser um verbo: "Compare Cascavel").
    for (let from = 0; from < words.length; from += 1) {
      let matched = 0;
      for (let size = words.length - from; size >= 1; size -= 1) {
        const candidate = words.slice(from, from + size).join(" ");
        const normalized = normalizePlaceName(candidate);
        if (normalized.length < 3 || KEYWORDS.has(normalized) || STATE_NAME_PATTERNS.some((state) => state.folded === normalized)) continue;
        if (!hasMunicipalityName(normalized)) continue;
        const start = phraseStart + foldText(words.slice(0, from).join(" ")).length + (from > 0 ? 1 : 0);
        matched = size;
        if (overlaps(consumed, start, start + normalized.length)) break;
        if (cities.some((city) => normalizePlaceName(city.name.split("/")[0]) === normalized)) break;
        consumed.push({ value: normalized, start, end: start + normalized.length });
        const suffix = from + size === words.length && item[2] ? item[2].replace(/[^A-Z]/g, "") : "";
        cities.push({ name: suffix ? `${candidate}/${suffix}` : candidate, start });
        break;
      }
      if (matched > 0) from += matched - 1;
    }
  }
  // Lugar desconhecido depois de "em" ("em Xyzópolis"): vira menção de município para a
  // resolução responder "não encontrei" em vez de ignorar a restrição em silêncio.
  for (const item of original.matchAll(/\b(?:em|na cidade de|no município de|no municipio de)\s+((?:[A-ZÀ-Ý][\p{L}'’-]+)(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ý][\p{L}'’-]+){0,4})/gu)) {
    const normalized = normalizePlaceName(item[1]);
    const folded = foldText(item[1]);
    if (KEYWORDS.has(folded) || consumed.some((mention) => folded.includes(mention.value) || mention.value.includes(folded))) continue;
    if (STATE_NAME_PATTERNS.some((state) => state.folded === folded) || (folded.length === 2 && UF_NAMES[folded.toUpperCase()])) continue;
    if (hasMunicipalityName(normalized)) continue;
    cities.push({ name: item[1], start: foldText(original.slice(0, item.index ?? 0)).length });
  }

  // "São Paulo"/"Rio de Janeiro" sem "estado de": se a pergunta fala de cidades, é a cidade.
  const cityContext = cities.length > 0 || /\b(cidade|cidades|municipio|municipios|capital)\b/.test(t);
  for (const state of states) {
    const name = UF_NAMES[state.uf];
    const isCityName = hasMunicipalityName(normalizePlaceName(name));
    if (!state.explicitState && isCityName && (state.explicitCity || (cityContext && foldText(name).includes(" ")))) {
      cities.push({ name, start: state.start });
      state.uf = "";
    }
  }
  const stateCodes = states.filter((state) => state.uf).sort((left, right) => left.start - right.start).map((state) => state.uf);
  const cityNames = cities.sort((left, right) => left.start - right.start).map((city) => city.name);

  /* ---------- atividade (texto que sobra) */
  const activities: string[] = [...new Set(codes)];
  const leftover = t
    .split(/[^a-z0-9-]+/)
    .filter((word, index, all) => word.length >= 3 && !KEYWORDS.has(word) && !/^\d+$/.test(word) && all.indexOf(word) === index)
    .filter((word) => !consumed.some((mention) => mention.value.split(" ").includes(word)));
  const activityPhrase = /\b(?:empresas|escritorios|lojas|negocios|estabelecimentos|atividades?)\s+de\s+([a-z][a-z ]{2,40}?)(?=\s+(?:abert|ativ|em|no|na|nos|nas|do|da|com|que|entre|desde|ha|por|e|$)|[?.!,]|$)/.exec(t);
  if (activityPhrase && !KEYWORDS.has(activityPhrase[1].trim())) activities.push(activityPhrase[1].trim());
  else if (leftover.length > 0 && leftover.length <= 4 && codes.length === 0) {
    const phrase = leftover.join(" ");
    const known = Array.from(context.vocabulary.cnaes.values()).some((description) => {
      const words = foldText(description).split(/[^a-z0-9]+/);
      return leftover.some((token) => {
        const stem = token.length > 6 ? token.slice(0, token.length - 2) : token;
        return stem.length >= 4 && words.some((word) => word.startsWith(stem));
      });
    });
    if (known) activities.push(phrase);
  }
  if (activities.length > 0) f.activities = activities;

  /* ---------- busca textual explícita */
  if ((match = /\b(?:com nome|chamad[ao]s?|nome contendo|que contenham?|contendo)\s+["“']?([^"”']{2,60})["”']?/i.exec(original))) {
    f.text = match[1].trim();
  }

  /* ---------- ordenação e limite */
  if (/\b(maior(es)? capital|mais capital|capital mais alto)\b/.test(t)) plan.sort = "capital_desc";
  else if (/\b(menor(es)? capital)\b/.test(t)) plan.sort = "capital_asc";
  else if (/\b(mais recentes|mais novas|abertas por ultimo)\b/.test(t)) plan.sort = "opened_desc";
  else if (/\b(mais antigas|mais velhas)\b/.test(t)) plan.sort = "opened_asc";
  else if (/\b(ordem alfabetica|alfabeticamente|por nome)\b/.test(t)) plan.sort = "name";
  if ((match = /\b(?:top|primeir[ao]s|as|os)\s+(\d{1,2})\b(?!\s*(?:anos?|mes|meses|dias?)\b)/.exec(t))) {
    const value = Number(match[1]);
    if (value >= 1 && value <= 50) plan.limit = value;
  }

  /* ---------- dimensão de agrupamento */
  let groupBy: AiDimension | null = null;
  for (const pattern of [
    /\bpor\s+([a-z]+)/g,
    /\b(?:quais|qual)\s+(?:os|as|o|a)?\s*([a-z]+)/g,
    /\b([a-z]+)\s+(?:com|que tem|que possuem|que concentram|onde ha)\s+mais\b/g,
    /\bem quais?\s+([a-z]+)/g,
    /\b(?:ranking|top \d*|distribuicao)\s+(?:de|dos|das|por)?\s*([a-z]+)/g
  ]) {
    for (const item of t.matchAll(pattern)) {
      const dimension = dimensionOf(item[1]);
      if (dimension) {
        groupBy = dimension;
        break;
      }
    }
    if (groupBy) break;
  }
  if (!groupBy && /\b(evolucao|ano a ano|por ano|cada ano|historico de abertura)\b/.test(t)) groupBy = "openedYear";
  if (!groupBy && /\b(mes a mes|por mes|mensal)\b/.test(t)) groupBy = "openedMonth";
  // "nos últimos 2 anos" é período, não agrupamento.
  if (groupBy === "openedYear" && f.openedLastMonths && !/\b(por ano|cada ano|ano a ano|evolucao|quais (os )?anos)\b/.test(t)) groupBy = null;
  plan.groupBy = groupBy;

  /* ---------- intenção */
  const has = (pattern: RegExp) => pattern.test(t);
  const wantsMap = has(/\bmapa\b/) && (has(/\b(mostre|mostrar|mostra|exiba|exibir|veja|ver|abra|abrir|coloque|colocar|no mapa|pelo mapa|plote)\b/) || t.trim().length < 30);
  const wantsList = has(/\b(na lista|aba empresas|na tabela|abra a lista|abrir a lista|ver a lista|mostre na lista|mostrar na lista)\b/);
  const wantsIntel = has(/\b(inteligencia|painel|dashboard)\b/) && has(/\b(mostre|mostrar|abra|abrir|ver|veja|leve|va para|ir para|no|na)\b/);
  const wantsChart = has(/\b(grafico|graficos|chart|visualmente|plotar|barras)\b/);
  const wantsCompare = has(/\b(compar\w*|versus|vs|contra)\b/) || /\s+x\s+/.test(t);
  const wantsSummary = has(/\b(resum\w*|panorama|visao geral|perfil|indicadores|kpis?|estatisticas|numeros gerais)\b/);
  const wantsList2 = has(/\b(liste|listar|lista de|quais (sao )?as empresas|quais empresas|mostre as empresas|mostrar as empresas|ver as empresas|nomes|quem sao)\b/);
  const wantsCount = has(/\b(quant[oa]s|numero de|total de|qtd|conte|contar)\b/);
  const wantsAggregate = Boolean(groupBy) && (has(/\b(quais|qual|ranking|top|mais|maior|maiores|concentr|distribu|por|evolucao|onde)\b/) || wantsChart);
  const refine = has(/^(filtre|filtrar|aplique|aplicar|somente|apenas|so |agora|e |e?\s*se|tire|remova|sem )/) || has(/\b(filtre|filtrar|aplique o filtro|aplicar filtro)\b/);
  const hasEntities = Boolean(f.cities || cityNames.length || stateCodes.length || f.activities || f.sizes || f.status || f.openedLastMonths || f.openedYearFrom || f.contact || f.branch || f.capitalMin !== null || f.capitalMax !== null || f.text);

  if (/\b(tire|remova|remover|tirar|sem)\s+(o\s+)?filtro\s+de\s+([a-z]+)/.test(t)) {
    const word = /\bfiltro\s+de\s+([a-z]+)/.exec(t)?.[1] ?? "";
    const dimension = dimensionOf(word);
    const map: Partial<Record<AiDimension, NonNullable<typeof f.clear>[number]>> = {
      municipality: "cities",
      state: "states",
      cnae: "activities",
      size: "sizes",
      status: "status",
      capital: "capital",
      openedYear: "opened",
      openedMonth: "opened"
    };
    const clear = dimension ? map[dimension] : /abertura|data|periodo/.test(word) ? "opened" : /contato|telefone|email/.test(word) ? "contact" : null;
    if (clear) f.clear = [clear];
  }

  if (cityNames.length > 0) f.cities = cityNames;
  if (stateCodes.length > 0) f.states = Array.from(new Set(stateCodes));

  if (wantsCompare) {
    const regions = [...cityNames, ...Array.from(new Set(stateCodes)).filter(() => cityNames.length === 0)];
    if (regions.length >= 2) {
      plan.action = "compareRegions";
      plan.regions = regions;
      // As regiões comparadas não são filtro: cada coluna aplica a sua.
      if (cityNames.length > 0) f.cities = null;
      if (cityNames.length === 0) f.states = null;
      return plan;
    }
    if (regions.length === 0 && context.previousTool === "compareRegions" && !wantsChart) {
      // "Compare somente as ativas": mesmas regiões da comparação anterior, novo recorte.
      plan.action = "compareRegions";
      return plan;
    }
    if (regions.length === 1 && !wantsChart) {
      // "Compare com MG": o resolvedor completa com as regiões do contexto.
      plan.action = "compareRegions";
      plan.regions = regions;
      if (cityNames.length > 0) f.cities = null;
      else f.states = null;
      return plan;
    }
    if (!wantsChart) {
      plan.action = "clarify";
      plan.clarification = "Quais regiões você quer comparar? Cite dois ou mais municípios ou UFs — por exemplo, “Compare Cascavel e Pato Branco”.";
      return plan;
    }
  }

  if (wantsMap) {
    plan.action = "showOnMap";
    if (has(/\b(concentracao|calor|densidade|hexagon|h3)\b/)) plan.mapLayer = "concentration";
    else if (has(/\b(regioes|por municipio|municipios)\b/)) plan.mapLayer = "regions";
    else if (has(/\b(pontos|empresas no mapa|marcadores)\b/)) plan.mapLayer = "companies";
    return plan;
  }
  if (wantsList) {
    plan.action = "showInList";
    return plan;
  }
  if (wantsIntel && !wantsChart) {
    plan.action = "showIntelligence";
    return plan;
  }
  if (wantsChart) {
    plan.action = "createChart";
    if (!plan.groupBy) plan.groupBy = context.previousGroupBy;
    return plan;
  }
  if (wantsAggregate) {
    plan.action = "aggregateCompanies";
    return plan;
  }
  if (wantsSummary) {
    plan.action = "summarizeCompanies";
    return plan;
  }
  if (wantsList2 || wantsCount) {
    plan.action = cityNames.length === 1 && !f.activities && !wantsList2 ? "getCompaniesByCity" : "searchCompanies";
    if (wantsCount && !wantsList2 && plan.limit === null) plan.limit = 10;
    return plan;
  }
  if (refine || hasEntities || f.clear || plan.contextMode === "reset") {
    // "Filtre somente ME", "E em Pato Branco?": repete a análise anterior com o novo recorte.
    plan.action = context.previousTool && !["showOnMap", "showInList", "showIntelligence"].includes(context.previousTool) ? context.previousTool : "searchCompanies";
    if (plan.action === "createChart" || plan.action === "aggregateCompanies") plan.groupBy = plan.groupBy ?? context.previousGroupBy;
    plan.applyToView = has(/\b(filtre|filtrar|aplique|aplicar|tire|remova|limpe|limpar)\b/);
    return plan;
  }

  plan.action = "clarify";
  plan.clarification =
    "Não entendi a pergunta. Exemplos: “Quantas empresas ativas há no Paraná?”, “Quais municípios têm mais empresas?”, “Compare Cascavel e Pato Branco”, “Mostre no mapa”.";
  return plan;
}
