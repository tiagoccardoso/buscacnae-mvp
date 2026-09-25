import type * as Cesium from "cesium";
import type { CesiumModule } from "@/lib/map/cesium/cesium-loader";
import type { MapPalette } from "@/lib/map/palette";
import type { MapCluster, MapPoint } from "@/lib/map/clustering";
import type { GeoBounds, MapCompany } from "@/lib/map/types";

/**
 * Contrato das camadas do Mapa Empresarial.
 *
 * Inspirado no contrato de camadas do God's Eye View (init/enable/disable/update/destroy
 * em src/layers/*, MIT © 2026 Bilawal Sidhu), simplificado: cada camada é dona dos
 * próprios primitives, reage a dados/viewport e libera tudo em destroy().
 * Nenhuma camada recria o viewer; trocar dados não reinicia o Cesium.
 */
export type LayerContext = {
  C: CesiumModule;
  viewer: Cesium.Viewer;
  palette: MapPalette;
  requestRender(): void;
};

export type ViewState = {
  bounds: GeoBounds;
  cameraHeight: number;
  /** Retorna false para posições atrás do horizonte (globo 3D). */
  isVisible(position: Cesium.Cartesian3): boolean;
};

export type RenderFrame = {
  view: ViewState;
  clusters: MapCluster[];
  points: MapPoint[];
  companiesById: Map<string, MapCompany>;
  selectedId: string | null;
};

export type PickTarget =
  | { kind: "cluster"; clusterId: number; latitude: number; longitude: number }
  | { kind: "company"; companyId: string }
  | { kind: "h3"; cellId: string };

export interface MapLayer {
  readonly id: "companies" | "clusters" | "h3";
  setVisible(visible: boolean): void;
  render?(frame: RenderFrame): void;
  setCompanies?(companies: MapCompany[]): void;
  setPalette?(palette: MapPalette): void;
  destroy(): void;
}
