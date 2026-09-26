/**
 * Base sintética e determinística para o benchmark da Busca Avançada (Fase 7).
 *
 * Não há dados reais aqui: CNPJs são gerados com dígito verificador válido, nomes são
 * combinações de sobrenomes/termos comuns, e CNAE/municípios vêm dos catálogos públicos
 * já versionados no projeto (data/cnae-catalog.json e data/municipios-geo.json).
 * O objetivo é reproduzir o formato e a distribuição de `establishments`.
 */
import { readFileSync } from "node:fs";

export type BenchCompany = {
  cnpj: string;
  company_name: string;
  trade_name: string | null;
  primary_cnae_code: string;
  primary_cnae_description: string;
  city_name: string;
  city_ibge: string;
  state_code: string;
  registration_status: string;
  company_size: string;
  opened_at: string;
  secondary_cnaes: Array<{ codigo: string; descricao: string }>;
  provider_payload: Record<string, unknown>;
};

type CatalogEntry = { code: string; description: string };

const root = new URL("../../", import.meta.url);
const catalog = JSON.parse(readFileSync(new URL("data/cnae-catalog.json", root), "utf8")) as CatalogEntry[];
const municipalityData = JSON.parse(readFileSync(new URL("data/municipios-geo.json", root), "utf8")) as {
  cities: Array<[number, string, string, number, number, number]>;
};

export function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SURNAMES = [
  "Silva", "Santos", "Oliveira", "Souza", "Rodrigues", "Ferreira", "Alves", "Pereira", "Lima", "Gomes", "Costa", "Ribeiro",
  "Martins", "Carvalho", "Almeida", "Lopes", "Soares", "Fernandes", "Vieira", "Barbosa", "Rocha", "Dias", "Nascimento",
  "Andrade", "Moreira", "Nunes", "Marques", "Machado", "Mendes", "Freitas", "Cardoso", "Ramos", "Gonçalves", "Santana",
  "Teixeira", "Araújo", "Conceição", "Cavalcanti", "Müller", "Zanella", "Bortolini", "Tessaro", "Scheffer", "Grigolo",
  "Dalla Costa", "Piovesan", "Bittencourt", "Magalhães", "Brandão", "Figueiredo", "Guimarães", "Sá", "Simões", "Assunção"
];
const FIRST_NAMES = [
  "João", "José", "Antônio", "Francisco", "Carlos", "Paulo", "Pedro", "Lucas", "Luiz", "Marcos", "Maria", "Ana", "Francisca",
  "Antônia", "Adriana", "Juliana", "Márcia", "Fernanda", "Patrícia", "Aline", "Sebastião", "Luís", "Mônica", "Cláudia"
];
const PLACES = ["Sul", "Brasil", "Paraná", "Sudoeste", "Oeste", "Vale", "Serra", "Litoral", "Central", "Norte", "Nova Era", "Horizonte"];

/** Termos usados em nomes de empresa por família de CNAE (prefixo de 4 dígitos). */
const SECTOR_TERMS: Array<{ prefix: string; terms: string[]; weight: number }> = [
  { prefix: "4930", terms: ["Transportadora", "Transportes", "Logística", "Cargas", "Transportes e Logística"], weight: 9 },
  { prefix: "4721", terms: ["Padaria", "Panificadora", "Pão Quente", "Confeitaria"], weight: 6 },
  { prefix: "5611", terms: ["Restaurante", "Lanchonete", "Bar e Restaurante", "Churrascaria", "Pizzaria"], weight: 8 },
  { prefix: "4520", terms: ["Auto Mecânica", "Oficina Mecânica", "Auto Center", "Mecânica"], weight: 6 },
  { prefix: "4771", terms: ["Farmácia", "Drogaria", "Farma"], weight: 5 },
  { prefix: "4120", terms: ["Construtora", "Construções", "Engenharia e Construções"], weight: 5 },
  { prefix: "9602", terms: ["Salão de Beleza", "Studio", "Estética", "Barbearia"], weight: 6 },
  { prefix: "6201", terms: ["Tecnologia", "Software", "Sistemas", "Informática"], weight: 4 },
  { prefix: "8630", terms: ["Odontologia", "Clínica Odontológica", "Consultório"], weight: 3 },
  { prefix: "4711", terms: ["Supermercado", "Mercado", "Atacarejo"], weight: 4 },
  { prefix: "6911", terms: ["Advocacia", "Advogados Associados", "Sociedade de Advogados"], weight: 3 },
  { prefix: "6920", terms: ["Contabilidade", "Assessoria Contábil", "Escritório Contábil"], weight: 3 },
  { prefix: "5510", terms: ["Hotel", "Pousada", "Hotelaria"], weight: 2 },
  { prefix: "4744", terms: ["Materiais de Construção", "Home Center", "Depósito"], weight: 4 },
  { prefix: "0151", terms: ["Agropecuária", "Fazenda", "Pecuária"], weight: 3 }
];

const LEGAL_SUFFIXES = ["LTDA", "LTDA", "LTDA", "LTDA ME", "EIRELI", "S/A", "LTDA EPP", "Comércio e Serviços LTDA"];
const STATUSES = ["ATIVA", "ATIVA", "ATIVA", "ATIVA", "ATIVA", "ATIVA", "ATIVA", "BAIXADA", "INAPTA", "SUSPENSA"];
const SIZES = ["ME", "ME", "ME", "EPP", "DEMAIS"];

function pick<T>(random: () => number, list: readonly T[]): T {
  return list[Math.floor(random() * list.length)];
}

function cnpjDigit(base: string, weights: number[]) {
  let sum = 0;
  for (let index = 0; index < weights.length; index += 1) sum += Number(base[index]) * weights[index];
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function makeCnpj(rootNumber: number, order: number) {
  const base = `${String(rootNumber).padStart(8, "0")}${String(order).padStart(4, "0")}`;
  const first = cnpjDigit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = cnpjDigit(`${base}${first}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base}${first}${second}`;
}

export function generateCompanies(size: number, seed = 20260926) {
  const random = mulberry32(seed);
  const cnaeByPrefix = new Map<string, CatalogEntry[]>();
  for (const entry of catalog) {
    const digits = entry.code.replace(/\D/g, "");
    const prefix = digits.slice(0, 4);
    const list = cnaeByPrefix.get(prefix) ?? [];
    list.push({ code: digits, description: entry.description });
    cnaeByPrefix.set(prefix, list);
  }
  const sectorPool: Array<(typeof SECTOR_TERMS)[number]> = [];
  for (const sector of SECTOR_TERMS) for (let index = 0; index < sector.weight; index += 1) sectorPool.push(sector);

  // Cidades: capitais e polos regionais pesam mais; Pato Branco/PR incluída como polo (exemplo do enunciado).
  const cities = municipalityData.cities;
  const heavy = cities.filter(
    ([, name, uf, , , capital]) =>
      capital === 1 || ["Pato Branco", "Londrina", "Maringá", "Cascavel", "Joinville", "Campinas", "Francisco Beltrão"].includes(name) && ["PR", "SC", "SP"].includes(uf)
  );

  const rows: BenchCompany[] = [];
  const usedRoots = new Set<number>();
  for (let index = 0; index < size; index += 1) {
    let root = 10_000_000 + Math.floor(random() * 89_999_999);
    while (usedRoots.has(root)) root = 10_000_000 + Math.floor(random() * 89_999_999);
    usedRoots.add(root);
    const order = random() < 0.85 ? 1 : 2 + Math.floor(random() * 5);

    const useSector = random() < 0.7;
    const sector = useSector ? pick(random, sectorPool) : null;
    const cnaeOptions = sector ? cnaeByPrefix.get(sector.prefix) ?? [] : [];
    const cnae = cnaeOptions.length > 0 ? pick(random, cnaeOptions) : (() => {
      const entry = pick(random, catalog);
      return { code: entry.code.replace(/\D/g, ""), description: entry.description };
    })();
    const sectorTerm = sector ? pick(random, sector.terms) : cnae.description.split(/[ ,]/).slice(0, 2).join(" ");

    const city = random() < 0.35 ? pick(random, heavy) : pick(random, cities);
    const isMei = random() < 0.22;
    let companyName: string;
    let tradeName: string | null = null;
    if (isMei) {
      const cpf = String(Math.floor(random() * 99_999_999_999)).padStart(11, "0");
      companyName = `${pick(random, FIRST_NAMES)} ${pick(random, SURNAMES)} ${pick(random, SURNAMES)} ${cpf}`.toUpperCase();
      tradeName = `${sectorTerm} ${pick(random, FIRST_NAMES)}`;
    } else {
      const style = random();
      const family = style < 0.4 ? pick(random, SURNAMES) : style < 0.6 ? `${pick(random, SURNAMES)} & ${pick(random, SURNAMES)}` : pick(random, PLACES);
      companyName = `${sectorTerm} ${family} ${pick(random, LEGAL_SUFFIXES)}`;
      if (random() < 0.55) tradeName = `${sectorTerm} ${pick(random, [...PLACES, ...SURNAMES])}`;
    }
    // A fonte frequentemente devolve razão social em maiúsculas e sem acento.
    if (random() < 0.4) companyName = companyName.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

    const year = 1975 + Math.floor(random() * 51);
    rows.push({
      cnpj: makeCnpj(root, order),
      company_name: companyName,
      trade_name: tradeName,
      primary_cnae_code: cnae.code,
      primary_cnae_description: cnae.description,
      city_name: city[1],
      city_ibge: String(city[0]),
      state_code: city[2],
      registration_status: pick(random, STATUSES),
      company_size: isMei ? "ME" : pick(random, SIZES),
      opened_at: `${year}-${String(1 + Math.floor(random() * 12)).padStart(2, "0")}-15`,
      secondary_cnaes: [],
      provider_payload: { casadosdados_detalhe_em: new Date(Date.UTC(2026, 8, 1 + Math.floor(random() * 25))).toISOString() }
    });
  }
  return rows;
}
