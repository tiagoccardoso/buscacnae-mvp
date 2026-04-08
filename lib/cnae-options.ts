import { formatCnaeCode, normalizeCnaeCode } from "@/lib/cnae-utils";

export type CnaeOption = {
  value: string;
  label: string;
};

type ExternalCnaeRow = Record<string, unknown>;

const CNAE_SOURCE_URL = "https://servicodados.ibge.gov.br/api/v2/cnae/subclasses";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const REMOTE_FETCH_TIMEOUT_MS = 5000;

let memoryCache:
  | {
      expiresAt: number;
      items: CnaeOption[];
    }
  | null = null;
let inflightPromise: Promise<CnaeOption[]> | null = null;


function sentenceCaseSegment(segment: string) {
  const trimmed = segment.trim();
  if (!trimmed) return "";

  const lower = trimmed.toLocaleLowerCase("pt-BR");
  return lower.replace(/(^|[\s([{-]+)([a-zà-ÿ])/u, (_, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase("pt-BR")}`);
}

function formatCnaeDescription(value: string) {
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned) return "";

  const shouldNormalize = cleaned === cleaned.toUpperCase();
  if (!shouldNormalize) return cleaned;

  return cleaned
    .split(/([:;]\s+)/)
    .map((segment, index) => (index % 2 === 0 ? sentenceCaseSegment(segment) : segment))
    .join("");
}

const FALLBACK_CNAE_OPTIONS: CnaeOption[] = [
  ["6201501", "Desenvolvimento de programas de computador sob encomenda"],
  ["6202300", "Desenvolvimento e licenciamento de programas de computador customizáveis"],
  ["6203100", "Desenvolvimento e licenciamento de programas de computador não-customizáveis"],
  ["6204000", "Consultoria em tecnologia da informação"],
  ["6209100", "Suporte técnico, manutenção e outros serviços em tecnologia da informação"],
  ["6311900", "Tratamento de dados, provedores de serviços de aplicação e serviços de hospedagem na internet"],
  ["6319400", "Portais, provedores de conteúdo e outros serviços de informação na internet"],
  ["7020400", "Atividades de consultoria em gestão empresarial"],
  ["7319002", "Promoção de vendas"],
  ["7319003", "Marketing direto"],
  ["7319004", "Consultoria em publicidade"],
  ["7320300", "Pesquisas de mercado e de opinião pública"],
  ["7490104", "Atividades de intermediação e agenciamento de serviços e negócios em geral"],
  ["8211300", "Serviços combinados de escritório e apoio administrativo"],
  ["8220200", "Atividades de teleatendimento"],
  ["8599604", "Treinamento em desenvolvimento profissional e gerencial"],
  ["8599605", "Cursos preparatórios para concursos"],
  ["8599699", "Outras atividades de ensino não especificadas anteriormente"],
  ["6920601", "Atividades de contabilidade"],
  ["6920602", "Atividades de consultoria e auditoria contábil e tributária"],
  ["6911701", "Serviços advocatícios"],
  ["7810800", "Seleção e agenciamento de mão-de-obra"],
  ["7820500", "Locação de mão-de-obra temporária"],
  ["7830200", "Fornecimento e gestão de recursos humanos para terceiros"],
  ["7020400", "Consultoria empresarial"],
  ["8230001", "Serviços de organização de feiras, congressos, exposições e festas"],
  ["8299799", "Outras atividades de serviços prestados principalmente às empresas"],
  ["8550302", "Atividades de apoio à educação"],
  ["1813001", "Impressão de material para uso publicitário"],
  ["1822999", "Serviços de acabamentos gráficos"],
].map(([value, description]) => ({ value, label: `${formatCnaeCode(value)} · ${formatCnaeDescription(description)}` }));

function mergeWithFallback(items: CnaeOption[]) {
  const unique = new Map<string, CnaeOption>();
  for (const item of [...items, ...FALLBACK_CNAE_OPTIONS]) {
    if (!item?.value || unique.has(item.value)) continue;
    unique.set(item.value, item);
  }
  return Array.from(unique.values()).sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));
}

function normalizeText(value: string) {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function pickFirstString(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const current = source[key];
    const text = readString(current);
    if (text) return text;

    if (typeof current === "number") {
      return String(current);
    }
  }

  return "";
}

function mapExternalRow(row: ExternalCnaeRow): CnaeOption | null {
  const code = normalizeCnaeCode(
    pickFirstString(row, ["id", "codigo", "subclasse", "subclasse_id", "idSubclasse", "id_subclasse"])
  );

  if (!code) return null;

  const classObject = readObject(row.classe);
  const groupObject = readObject(row.grupo);
  const divisionObject = readObject(row.divisao);
  const sectionObject = readObject(row.secao);

  const description =
    pickFirstString(row, ["descricao", "descricao_subclasse", "descricaoSubclasse", "denominacao"]) ||
    pickFirstString(classObject ?? {}, ["descricao"]) ||
    pickFirstString(groupObject ?? {}, ["descricao"]) ||
    pickFirstString(divisionObject ?? {}, ["descricao"]) ||
    pickFirstString(sectionObject ?? {}, ["descricao"]);

  return {
    value: code,
    label: description ? `${formatCnaeCode(code)} · ${formatCnaeDescription(description)}` : formatCnaeCode(code)
  };
}

async function fetchAllCnaesFromSource() {
  try {
    const response = await fetch(CNAE_SOURCE_URL, {
      headers: {
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS),
      next: {
        revalidate: 60 * 60 * 24 * 30
      }
    });

    if (!response.ok) {
      return mergeWithFallback([]);
    }

    const payload = (await response.json()) as unknown;
    const rows = Array.isArray(payload) ? payload : [];
    const unique = new Map<string, CnaeOption>();

    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const option = mapExternalRow(row as ExternalCnaeRow);
      if (!option || unique.has(option.value)) continue;
      unique.set(option.value, option);
    }

    return mergeWithFallback(Array.from(unique.values()));
  } catch (error) {
    console.error("Falha ao consultar catálogo remoto de CNAEs. Usando fallback local.", error);
    return mergeWithFallback([]);
  }
}

export async function getAllCnaeOptions() {
  const now = Date.now();
  if (memoryCache && memoryCache.expiresAt > now) {
    return memoryCache.items;
  }

  if (!inflightPromise) {
    inflightPromise = fetchAllCnaesFromSource()
      .then((items) => {
        memoryCache = {
          expiresAt: Date.now() + CACHE_TTL_MS,
          items
        };
        return items;
      })
      .finally(() => {
        inflightPromise = null;
      });
  }

  return inflightPromise;
}

export async function searchCnaeOptions(params: {
  query?: string;
  ids?: string[];
  limit?: number;
}) {
  const items = await getAllCnaeOptions();
  const ids = Array.from(new Set((params.ids ?? []).map((item) => normalizeCnaeCode(item)).filter(Boolean)));

  if (ids.length > 0) {
    const lookup = new Map(items.map((item) => [item.value, item]));
    return ids.map((id) => lookup.get(id) ?? { value: id, label: formatCnaeCode(id) }).filter(Boolean);
  }

  const normalizedQuery = normalizeText(params.query ?? "");
  const limit = Number.isFinite(params.limit) ? Math.min(Math.max(Number(params.limit), 1), 100) : 25;

  if (!normalizedQuery) {
    return items.slice(0, limit);
  }

  const codeQuery = normalizeCnaeCode(params.query ?? "");
  return items
    .filter((item) => {
      if (codeQuery && item.value.includes(codeQuery)) return true;
      return normalizeText(item.label).includes(normalizedQuery);
    })
    .slice(0, limit);
}
