import { NOT_INFORMED, cnaeKey, formatCnaeCode, municipalityDimensionKey, sizeKey, statusKey } from "@/lib/analytics/dimensions";

type LabelSource = {
  municipalityKey: string | null | undefined;
  municipalityLabel: string | null | undefined;
  cnae: string | null | undefined;
  cnaeDescription: string | null | undefined;
  size: string | null | undefined;
  status: string | null | undefined;
};

export type FilterLabelMaps = {
  municipality: Map<string, string>;
  cnae: Map<string, string>;
  size: Map<string, string>;
  status: Map<string, string>;
};

/** Rótulos das chaves de filtro a partir das próprias empresas (primeira ocorrência, determinístico). */
export function buildFilterLabelMaps(sources: Iterable<LabelSource>): FilterLabelMaps {
  const maps: FilterLabelMaps = { municipality: new Map(), cnae: new Map(), size: new Map(), status: new Map() };
  for (const source of sources) {
    const municipality = municipalityDimensionKey(source.municipalityKey);
    if (municipality !== NOT_INFORMED && source.municipalityLabel && !maps.municipality.has(municipality))
      maps.municipality.set(municipality, source.municipalityLabel);
    const cnae = cnaeKey(source.cnae);
    if (cnae !== NOT_INFORMED && !maps.cnae.has(cnae))
      maps.cnae.set(cnae, source.cnaeDescription ? `${formatCnaeCode(cnae)} · ${source.cnaeDescription}` : formatCnaeCode(cnae));
    const size = sizeKey(source.size);
    if (size !== NOT_INFORMED && source.size && !maps.size.has(size)) maps.size.set(size, source.size.trim());
    const status = statusKey(source.status);
    if (status !== NOT_INFORMED && source.status && !maps.status.has(status)) {
      const text = source.status.trim();
      maps.status.set(status, text.charAt(0).toUpperCase() + text.slice(1).toLowerCase());
    }
  }
  return maps;
}
