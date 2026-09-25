import rawDataset from "@/data/municipios-geo.json";
import { boundsContain } from "@/lib/map/geo";
import type { GeoBounds } from "@/lib/map/types";

/**
 * Coordenadas das sedes municipais e centros dos estados.
 *
 * Fonte: kelvins/municipios-brasileiros (MIT), derivado de dados públicos do IBGE.
 * Uso exclusivamente no servidor — o arquivo não é enviado ao navegador.
 * Serve para: (1) localizar empresas quando só o município é conhecido e
 * (2) converter a área visível do mapa em municípios para "Buscar nesta área".
 */
export type Municipality = {
  ibge: string;
  name: string;
  stateCode: string;
  latitude: number;
  longitude: number;
  capital: boolean;
};

export type StateCentroid = {
  stateCode: string;
  ibge: string;
  name: string;
  latitude: number;
  longitude: number;
  region: string;
};

type RawDataset = {
  states: Array<{ uf: string; ibge: number; nome: string; latitude: number; longitude: number; regiao: string }>;
  cities: Array<[number, string, string, number, number, number]>;
};

const dataset = rawDataset as unknown as RawDataset;

export function normalizePlaceName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

let municipalities: Municipality[] | null = null;
let byIbge: Map<string, Municipality> | null = null;
let byNameAndState: Map<string, Municipality> | null = null;
let states: Map<string, StateCentroid> | null = null;

function ensureIndexes() {
  if (municipalities && byIbge && byNameAndState && states) return;

  municipalities = dataset.cities.map(([ibge, name, stateCode, latitude, longitude, capital]) => ({
    ibge: String(ibge),
    name,
    stateCode,
    latitude,
    longitude,
    capital: capital === 1
  }));
  byIbge = new Map(municipalities.map((item) => [item.ibge, item]));
  byNameAndState = new Map(municipalities.map((item) => [`${normalizePlaceName(item.name)}|${item.stateCode}`, item]));
  states = new Map(
    dataset.states.map((item) => [
      item.uf,
      { stateCode: item.uf, ibge: String(item.ibge), name: item.nome, latitude: item.latitude, longitude: item.longitude, region: item.regiao }
    ])
  );
}

export function listMunicipalities(): readonly Municipality[] {
  ensureIndexes();
  return municipalities!;
}

export function findMunicipality(input: { ibge?: string | null; name?: string | null; stateCode?: string | null }) {
  ensureIndexes();
  const ibge = (input.ibge ?? "").replace(/\D/g, "");
  if (ibge.length === 7) {
    const match = byIbge!.get(ibge);
    if (match) return match;
  }

  const stateCode = (input.stateCode ?? "").trim().toUpperCase();
  const name = normalizePlaceName(input.name ?? "");
  if (!name || stateCode.length !== 2) return null;
  return byNameAndState!.get(`${name}|${stateCode}`) ?? null;
}

export function findStateCentroid(stateCode: string | null | undefined) {
  ensureIndexes();
  const code = (stateCode ?? "").trim().toUpperCase();
  return code ? states!.get(code) ?? null : null;
}

/** Municípios cuja sede está dentro do retângulo, ordenados por proximidade do centro. */
export function municipalitiesInBounds(bounds: GeoBounds) {
  const centerLat = (bounds.north + bounds.south) / 2;
  const centerLng = bounds.west <= bounds.east ? (bounds.west + bounds.east) / 2 : bounds.west;
  return listMunicipalities()
    .filter((item) => boundsContain(bounds, item.latitude, item.longitude))
    .map((item) => ({ item, distance: (item.latitude - centerLat) ** 2 + (item.longitude - centerLng) ** 2 }))
    .sort((left, right) => left.distance - right.distance)
    .map(({ item }) => item);
}
