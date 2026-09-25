import type * as Cesium from "cesium";
import { buildColorBins, colorForValue, sequentialRamp, type ColorBin } from "@/lib/map/intelligence/color-scale";
import type { H3Cell } from "@/lib/map/intelligence/h3-grid";
import { cssColorToRgba, type MapPalette } from "@/lib/map/palette";
import type { LayerContext, MapLayer, PickTarget } from "@/lib/map/cesium/layers/types";

/**
 * Camada "Concentração" no 3D: colunas H3 extrudadas (altura proporcional à quantidade
 * de empresas na célula). Um único Primitive com uma GeometryInstance por célula; é
 * recriado só quando os dados, a resolução H3, a seleção ou o tema mudam — nunca a
 * cada movimento de câmera.
 */
export type H3ColumnsLayer = MapLayer & {
  setCells(cells: H3Cell[]): ColorBin[];
  setSelectedCell(cellId: string | null): void;
};

const COLOR_STEPS = 6;

export function createH3ColumnsLayer(context: LayerContext): H3ColumnsLayer {
  const { C, viewer } = context;
  let palette = context.palette;
  let cells: H3Cell[] = [];
  let bins: ColorBin[] = [];
  let primitive: Cesium.Primitive | null = null;
  let visible = false;
  let selectedCellId: string | null = null;

  function clear() {
    if (primitive && !viewer.isDestroyed()) viewer.scene.primitives.remove(primitive);
    primitive = null;
  }

  function computeBins() {
    const ramp = sequentialRamp(cssColorToRgba(palette.bgElevated), cssColorToRgba(palette.accent), COLOR_STEPS, 235);
    bins = buildColorBins(
      cells.map((cell) => cell.count),
      ramp
    );
  }

  function rebuild() {
    clear();
    if (!visible || cells.length === 0 || viewer.isDestroyed()) {
      context.requestRender();
      return;
    }
    const maxCount = cells.reduce((max, cell) => Math.max(max, cell.count), 1);
    const highlight = C.Color.fromCssColorString(palette.label);

    const instances = cells.map((cell) => {
      // Altura linear (sem exagero): a coluna mais alta mede ~6× o lado da célula.
      const side = Math.sqrt(cell.areaKm2) * 1000;
      const height = Math.max(side * 0.15, side * 6 * (cell.count / maxCount));
      const positions = C.Cartesian3.fromDegreesArray(cell.polygon.slice(0, -1).flat());
      const rgba = colorForValue(cell.count, bins);
      const color = cell.id === selectedCellId ? highlight : C.Color.fromBytes(rgba[0], rgba[1], rgba[2], rgba[3]);
      return new C.GeometryInstance({
        geometry: new C.PolygonGeometry({
          polygonHierarchy: new C.PolygonHierarchy(positions),
          height: 0,
          extrudedHeight: height,
          vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT
        }),
        attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(color) },
        id: { kind: "h3", cellId: cell.id } satisfies PickTarget
      });
    });

    primitive = viewer.scene.primitives.add(
      new C.Primitive({
        geometryInstances: instances,
        appearance: new C.PerInstanceColorAppearance({ translucent: false, closed: true }),
        asynchronous: false
      })
    ) as Cesium.Primitive;
    context.requestRender();
  }

  return {
    id: "h3",
    setCells(next) {
      cells = next;
      computeBins();
      rebuild();
      return bins;
    },
    setSelectedCell(cellId) {
      if (selectedCellId === cellId) return;
      selectedCellId = cellId;
      rebuild();
    },
    setVisible(next) {
      if (visible === next) return;
      visible = next;
      rebuild();
    },
    setPalette(next: MapPalette) {
      palette = next;
      computeBins();
      rebuild();
    },
    destroy() {
      visible = false;
      clear();
    }
  };
}
