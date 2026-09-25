import type * as Cesium from "cesium";
import { buildDensityGrid, type DensityGrid } from "@/lib/map/density";
import { boundsFromPoints } from "@/lib/map/geo";
import { cssColorToRgba, type MapPalette } from "@/lib/map/engine/palette";
import type { LayerContext, MapLayer } from "@/lib/map/engine/layers/types";
import type { MapCompany } from "@/lib/map/types";

/**
 * Camada "density": concentração de empresas como uma única imagem drapeada no globo.
 * A grade é recalculada só quando os dados mudam (não a cada movimento de câmera).
 */
function colorize(grid: DensityGrid, palette: MapPalette) {
  const canvas = document.createElement("canvas");
  canvas.width = grid.width;
  canvas.height = grid.height;
  const context = canvas.getContext("2d");
  if (!context) return canvas;

  const low = cssColorToRgba(palette.accent);
  const high = cssColorToRgba(palette.warning);
  const image = context.createImageData(grid.width, grid.height);

  for (let index = 0; index < grid.values.length; index += 1) {
    const value = grid.values[index];
    if (value < 0.04) continue;
    const mix = Math.max(0, (value - 0.55) / 0.45);
    const offset = index * 4;
    image.data[offset] = Math.round(low[0] + (high[0] - low[0]) * mix);
    image.data[offset + 1] = Math.round(low[1] + (high[1] - low[1]) * mix);
    image.data[offset + 2] = Math.round(low[2] + (high[2] - low[2]) * mix);
    image.data[offset + 3] = Math.round(Math.min(0.82, 0.12 + value * 0.75) * 255);
  }

  context.putImageData(image, 0, 0);
  return canvas;
}

export function createDensityLayer(context: LayerContext): MapLayer {
  const { C, viewer } = context;
  let palette = context.palette;
  let companies: MapCompany[] = [];
  let layer: Cesium.ImageryLayer | null = null;
  let visible = false;
  let dirty = true;

  function clear() {
    if (layer && !viewer.isDestroyed()) viewer.imageryLayers.remove(layer, true);
    layer = null;
  }

  function rebuild() {
    clear();
    dirty = false;
    const points = companies
      .filter((company) => company.location)
      .map((company) => ({ latitude: company.location!.displayLatitude, longitude: company.location!.displayLongitude }));
    const bounds = boundsFromPoints(points, 0.15);
    if (!bounds) return;
    const grid = buildDensityGrid(points, bounds, { resolution: 320 });
    if (!grid) return;

    const canvas = colorize(grid, palette);
    const provider = new C.SingleTileImageryProvider({
      url: canvas.toDataURL("image/png"),
      tileWidth: grid.width,
      tileHeight: grid.height,
      rectangle: C.Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north)
    });
    layer = viewer.imageryLayers.addImageryProvider(provider);
    layer.alpha = 0.9;
  }

  return {
    id: "density",
    setCompanies(next) {
      companies = next;
      dirty = true;
      if (visible) {
        rebuild();
        context.requestRender();
      } else {
        clear();
      }
    },
    setVisible(next) {
      visible = next;
      if (visible && (dirty || !layer)) rebuild();
      if (layer) layer.show = visible;
      context.requestRender();
    },
    setPalette(next) {
      palette = next;
      dirty = true;
      if (visible) {
        rebuild();
        context.requestRender();
      }
    },
    destroy() {
      clear();
    }
  };
}
