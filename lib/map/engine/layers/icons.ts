import type { MapPalette } from "@/lib/map/engine/palette";
import { formatClusterCount } from "@/lib/map/clustering";

/**
 * Ícones desenhados em canvas (2x para telas retina) e reutilizados via cache.
 * Um único canvas por variação — milhares de billboards compartilham a mesma textura.
 */
const PIXEL_RATIO = 2;

export type IconCache = {
  cluster(count: number, approximateShare: number): { image: HTMLCanvasElement; key: string };
  company(variant: "precise" | "approximate", selected: boolean): { image: HTMLCanvasElement; key: string };
  clear(): void;
};

export const ICON_SCALE = 1 / PIXEL_RATIO;

export function clusterDiameter(count: number) {
  return Math.round(Math.min(58, 30 + Math.log10(Math.max(count, 2)) * 9));
}

export function createIconCache(palette: MapPalette): IconCache {
  const cache = new Map<string, HTMLCanvasElement>();

  function make(key: string, size: number, draw: (context: CanvasRenderingContext2D, size: number) => void) {
    const existing = cache.get(key);
    if (existing) return existing;
    const canvas = document.createElement("canvas");
    canvas.width = size * PIXEL_RATIO;
    canvas.height = size * PIXEL_RATIO;
    const context = canvas.getContext("2d");
    if (context) {
      context.scale(PIXEL_RATIO, PIXEL_RATIO);
      draw(context, size);
    }
    cache.set(key, canvas);
    return canvas;
  }

  return {
    cluster(count, approximateShare) {
      const diameter = clusterDiameter(count);
      const label = formatClusterCount(count);
      // Clusters majoritariamente aproximados usam anel tracejado (legenda explica).
      const dashed = approximateShare >= 0.5;
      const key = `cluster:${diameter}:${label}:${dashed ? 1 : 0}`;
      const image = make(key, diameter + 10, (context, size) => {
        const center = size / 2;
        const radius = diameter / 2;
        context.beginPath();
        context.arc(center, center, radius + 4, 0, Math.PI * 2);
        context.fillStyle = palette.accentSoft;
        context.fill();

        context.beginPath();
        context.arc(center, center, radius, 0, Math.PI * 2);
        context.fillStyle = palette.accent;
        context.shadowColor = "rgba(0,0,0,0.18)";
        context.shadowBlur = 6;
        context.shadowOffsetY = 1;
        context.fill();
        context.shadowColor = "transparent";

        context.lineWidth = 2;
        context.strokeStyle = palette.accentContrast;
        if (dashed) context.setLineDash([3, 3]);
        context.beginPath();
        context.arc(center, center, radius - 1, 0, Math.PI * 2);
        context.stroke();
        context.setLineDash([]);

        context.fillStyle = palette.accentContrast;
        const fontSize = label.length > 5 ? 11 : label.length > 3 ? 12 : 13;
        context.font = `600 ${fontSize}px ${palette.fontFamily}`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(label, center, center + 0.5);
      });
      return { image, key };
    },
    company(variant, selected) {
      const key = `company:${variant}:${selected ? 1 : 0}`;
      const size = selected ? 30 : 18;
      const image = make(key, size, (context, canvasSize) => {
        const center = canvasSize / 2;
        const radius = selected ? 9 : 6;
        if (selected) {
          context.beginPath();
          context.arc(center, center, radius + 5, 0, Math.PI * 2);
          context.fillStyle = palette.accentSoft;
          context.fill();
        }
        context.beginPath();
        context.arc(center, center, radius, 0, Math.PI * 2);
        if (variant === "precise") {
          context.fillStyle = palette.accent;
          context.fill();
          context.lineWidth = 2;
          context.strokeStyle = palette.accentContrast;
          context.stroke();
        } else {
          // Localização aproximada: marcador vazado, nunca igual ao marcador exato.
          context.fillStyle = palette.bgElevated;
          context.fill();
          context.lineWidth = 2.5;
          context.strokeStyle = palette.accent;
          context.setLineDash([2.5, 2]);
          context.stroke();
          context.setLineDash([]);
          context.beginPath();
          context.arc(center, center, 1.8, 0, Math.PI * 2);
          context.fillStyle = palette.accent;
          context.fill();
        }
      });
      return { image, key };
    },
    clear() {
      cache.clear();
    }
  };
}
