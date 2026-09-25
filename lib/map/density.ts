import type { GeoBounds } from "@/lib/map/types";

/**
 * Densidade empresarial (heatmap) — cálculo puro, sem Cesium nem DOM.
 *
 * As empresas são acumuladas em uma grade regular sobre o retângulo dos dados e
 * suavizadas com um kernel gaussiano separável. O resultado (0..1) é colorizado no
 * navegador em um canvas e drapeado no globo como uma única imagem, então o custo de
 * renderização não cresce com o número de empresas.
 */
export type DensityGrid = {
  bounds: GeoBounds;
  width: number;
  height: number;
  /** Valores normalizados 0..1, linha a linha (norte → sul). */
  values: Float32Array;
  max: number;
};

function gaussianKernel(radius: number) {
  const sigma = Math.max(radius / 2, 0.5);
  const kernel: number[] = [];
  let sum = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel.push(weight);
    sum += weight;
  }
  return kernel.map((weight) => weight / sum);
}

function blur(source: Float32Array, width: number, height: number, radius: number) {
  if (radius <= 0) return source;
  const kernel = gaussianKernel(radius);
  const temp = new Float32Array(source.length);
  const output = new Float32Array(source.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let acc = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const sx = Math.min(width - 1, Math.max(0, x + k));
        acc += source[y * width + sx] * kernel[k + radius];
      }
      temp[y * width + x] = acc;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let acc = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const sy = Math.min(height - 1, Math.max(0, y + k));
        acc += temp[sy * width + x] * kernel[k + radius];
      }
      output[y * width + x] = acc;
    }
  }

  return output;
}

export function buildDensityGrid(
  points: Array<{ latitude: number; longitude: number }>,
  bounds: GeoBounds,
  options: { resolution?: number; blurRadius?: number } = {}
): DensityGrid | null {
  if (points.length === 0) return null;
  const lngSpan = bounds.east - bounds.west;
  const latSpan = bounds.north - bounds.south;
  if (!(lngSpan > 0) || !(latSpan > 0)) return null;

  const resolution = Math.max(32, Math.min(options.resolution ?? 256, 1024));
  const aspect = lngSpan / latSpan;
  const width = aspect >= 1 ? resolution : Math.max(16, Math.round(resolution * aspect));
  const height = aspect >= 1 ? Math.max(16, Math.round(resolution / aspect)) : resolution;
  const counts = new Float32Array(width * height);

  for (const point of points) {
    const x = Math.floor(((point.longitude - bounds.west) / lngSpan) * width);
    const y = Math.floor(((bounds.north - point.latitude) / latSpan) * height);
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    counts[y * width + x] += 1;
  }

  const blurRadius = options.blurRadius ?? Math.max(2, Math.round(resolution / 48));
  const smoothed = blur(counts, width, height, blurRadius);
  let max = 0;
  for (const value of smoothed) if (value > max) max = value;
  if (max <= 0) return null;

  // Escala raiz quadrada: realça regiões medianas sem saturar os polos de concentração.
  const values = new Float32Array(smoothed.length);
  for (let index = 0; index < smoothed.length; index += 1) {
    values[index] = Math.sqrt(smoothed[index] / max);
  }

  return { bounds, width, height, values, max };
}
