/**
 * Escala de cores por quantis (padrão de "Color scale: quantile" do Kepler.gl), usada nas
 * camadas Concentração (H3) e Regiões. Classes por quantil evitam que um único outlier
 * (ex.: capital) deixe todas as outras células com a mesma cor.
 */
export type Rgba = [number, number, number, number];

export type ColorBin = { min: number; max: number; color: Rgba };

export function quantileBreaks(values: readonly number[], steps: number): number[] {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const breaks: number[] = [];
  for (let index = 1; index < steps; index += 1) {
    const value = sorted[Math.min(sorted.length - 1, Math.floor((index / steps) * sorted.length))];
    if (breaks.length === 0 || value > breaks[breaks.length - 1]) breaks.push(value);
  }
  return breaks;
}

/** Interpola do fundo até a cor de destaque (mesmo matiz: legível e sem semântica de alerta). */
export function sequentialRamp(from: Rgba, to: Rgba, steps: number, alpha = 210): Rgba[] {
  const ramp: Rgba[] = [];
  for (let index = 0; index < steps; index += 1) {
    const t = steps === 1 ? 1 : 0.22 + (0.78 * index) / (steps - 1);
    ramp.push([
      Math.round(from[0] + (to[0] - from[0]) * t),
      Math.round(from[1] + (to[1] - from[1]) * t),
      Math.round(from[2] + (to[2] - from[2]) * t),
      alpha
    ]);
  }
  return ramp;
}

/** Classes [min, max] contíguas a partir das quebras; a última vai até o máximo real. */
export function buildColorBins(values: readonly number[], ramp: readonly Rgba[]): ColorBin[] {
  const positive = values.filter((value) => value > 0);
  if (positive.length === 0 || ramp.length === 0) return [];
  const max = Math.max(...positive);
  const min = Math.min(...positive);
  const breaks = quantileBreaks(positive, ramp.length);
  const edges = [min, ...breaks.filter((value) => value > min), max + 1];
  const bins: ColorBin[] = [];
  const colorOffset = ramp.length - (edges.length - 1);
  for (let index = 0; index < edges.length - 1; index += 1) {
    const lower = edges[index];
    const upper = edges[index + 1] - 1;
    if (upper < lower) continue;
    bins.push({ min: lower, max: upper, color: ramp[Math.max(0, colorOffset + index)] });
  }
  return bins;
}

export function colorForValue(value: number, bins: readonly ColorBin[]): Rgba {
  for (const bin of bins) if (value <= bin.max) return bin.color;
  return bins.length ? bins[bins.length - 1].color : [0, 0, 0, 0];
}
