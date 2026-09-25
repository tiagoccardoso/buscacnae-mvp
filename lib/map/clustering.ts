import Supercluster, { type ClusterProperties, type PointFeature } from "supercluster";
import { heightToZoom } from "@/lib/map/geo";
import type { GeoBounds, LocationPrecision, MapCompany } from "@/lib/map/types";

/**
 * Clusterização das empresas (independente do Cesium, testável em Node).
 *
 * Usa supercluster (índice KD-tree): construir o índice é O(n log n) e cada consulta
 * de viewport devolve só os clusters/pontos visíveis — o custo de desenho depende do
 * que está na tela, não do total de empresas. O índice é refeito apenas quando os
 * dados mudam; mudanças de câmera só consultam o índice.
 */
export type CompanyPointProps = {
  companyId: string;
  precision: LocationPrecision;
};

export type ClusterProps = {
  /** Empresas com localização aproximada dentro do cluster. */
  approximate: number;
};

export type MapCluster = {
  kind: "cluster";
  clusterId: number;
  count: number;
  latitude: number;
  longitude: number;
  approximate: number;
};

export type MapPoint = {
  kind: "company";
  companyId: string;
  latitude: number;
  longitude: number;
  precision: LocationPrecision;
};

export type MapRenderItem = MapCluster | MapPoint;

export const CLUSTER_MAX_ZOOM = 16;

export type CompanyClusterIndex = {
  size: number;
  query(bounds: GeoBounds, zoom: number): MapRenderItem[];
  expansionZoom(clusterId: number): number;
  leaves(clusterId: number, limit?: number): string[];
};

export function createCompanyClusterIndex(companies: MapCompany[], options: { radius?: number } = {}): CompanyClusterIndex {
  const features: Array<PointFeature<CompanyPointProps>> = [];
  for (const company of companies) {
    const location = company.location;
    if (!location) continue;
    features.push({
      type: "Feature",
      properties: { companyId: company.id, precision: location.precision },
      geometry: { type: "Point", coordinates: [location.displayLongitude, location.displayLatitude] }
    });
  }

  const index = new Supercluster<CompanyPointProps, ClusterProps>({
    radius: options.radius ?? 60,
    maxZoom: CLUSTER_MAX_ZOOM,
    minPoints: 2,
    map: (props) => ({ approximate: props.precision === "exact" || props.precision === "address" ? 0 : 1 }),
    reduce: (accumulated, props) => {
      accumulated.approximate += props.approximate;
    }
  });
  index.load(features);

  return {
    size: features.length,
    query(bounds, zoom) {
      if (features.length === 0) return [];
      const safeZoom = Math.max(0, Math.min(Math.round(zoom), CLUSTER_MAX_ZOOM + 1));
      const boxes: Array<[number, number, number, number]> =
        bounds.west <= bounds.east
          ? [[bounds.west, bounds.south, bounds.east, bounds.north]]
          : [
              [bounds.west, bounds.south, 180, bounds.north],
              [-180, bounds.south, bounds.east, bounds.north]
            ];

      const items: MapRenderItem[] = [];
      for (const box of boxes) {
        for (const feature of index.getClusters(box, safeZoom)) {
          const [longitude, latitude] = feature.geometry.coordinates;
          const props = feature.properties as Partial<ClusterProperties & ClusterProps> & Partial<CompanyPointProps>;
          if (props.cluster) {
            items.push({
              kind: "cluster",
              clusterId: props.cluster_id as number,
              count: props.point_count as number,
              latitude,
              longitude,
              approximate: props.approximate ?? 0
            });
          } else {
            items.push({
              kind: "company",
              companyId: props.companyId as string,
              latitude,
              longitude,
              precision: props.precision as LocationPrecision
            });
          }
        }
      }
      return items;
    },
    expansionZoom(clusterId) {
      try {
        return index.getClusterExpansionZoom(clusterId);
      } catch {
        return CLUSTER_MAX_ZOOM;
      }
    },
    leaves(clusterId, limit = 50) {
      try {
        return index.getLeaves(clusterId, limit).map((leaf) => leaf.properties.companyId);
      } catch {
        return [];
      }
    }
  };
}

/** Consulta o índice a partir da altura da câmera (atalho usado pela camada). */
export function queryClustersForCamera(index: CompanyClusterIndex, bounds: GeoBounds, cameraHeightMeters: number) {
  return index.query(bounds, heightToZoom(cameraHeightMeters));
}

/** Rótulo curto de contagem, no padrão pt-BR (1.284 / 12,4 mil). */
export function formatClusterCount(count: number) {
  if (count < 10_000) return new Intl.NumberFormat("pt-BR").format(count);
  if (count < 1_000_000) {
    return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(count / 1000)} mil`;
  }
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(count / 1_000_000)} mi`;
}
