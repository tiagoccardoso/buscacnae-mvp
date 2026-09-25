import type { Bucket, TimePoint } from "@/lib/analytics/metrics";

/**
 * Opções Apache ECharts dos gráficos da Inteligência (funções PURAS, sem importar o
 * ECharts — testáveis no Node e reaproveitáveis por qualquer componente).
 *
 * Regras de visualização (skill dataviz + design system):
 * - uma única medida por gráfico (contagem de empresas) → um só eixo, uma só cor (acento);
 * - filtro ativo = segmento em cor cheia; os demais ficam esmaecidos (não mudam de cor);
 * - "Não informado" em cinza neutro (nunca parece uma categoria de dado); o excedente do
 *   ranking ("Outros") vai para texto, para não achatar as barras;
 * - grade e eixos recessivos, rótulos em tokens de texto, nunca na cor da série;
 * - a chave de cada barra fica em `keys[dataIndex]` para o drill-down.
 */
export type ChartPalette = {
  accent: string;
  accentMuted: string;
  neutral: string;
  label: string;
  labelSecondary: string;
  separator: string;
  surface: string;
  fontFamily: string;
};

export const OTHERS_KEY = "__outros__";

export type ChartModel = {
  /** Opção pronta para `chart.setOption(option, true)`. */
  option: Record<string, unknown>;
  /** Chave de filtro de cada barra (null = não clicável, ex.: "Outros"). */
  keys: Array<string | null>;
  /** Altura sugerida (px). */
  height: number;
  /**
   * Eixo das categorias: "y" (ranking horizontal) ou "x" (colunas). O componente usa isso
   * para aceitar clique em QUALQUER ponto da faixa da categoria (alvo maior que a barra).
   */
  categoryAxis: "x" | "y";
  /** Segmentos fora do top N (ranking): exibidos em texto, somam ao total. */
  others?: { segments: number; count: number } | null;
};

const numberFormat = new Intl.NumberFormat("pt-BR");

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function barColor(palette: ChartPalette, key: string | null, isSelected: (key: string) => boolean, hasSelection: boolean) {
  if (key === null || key === "na") return palette.neutral;
  if (!hasSelection) return palette.accent;
  return isSelected(key) ? palette.accent : palette.accentMuted;
}

function tooltip(palette: ChartPalette) {
  return {
    trigger: "item",
    confine: true,
    backgroundColor: palette.surface,
    borderColor: palette.separator,
    borderWidth: 1,
    padding: [6, 10],
    textStyle: { color: palette.label, fontFamily: palette.fontFamily, fontSize: 12 },
    extraCssText: "box-shadow: 0 4px 16px rgba(0,0,0,.12); border-radius: 8px;"
  };
}

/**
 * Ranking horizontal (municípios, UF, CNAE, porte, situação).
 * Mostra os `maxItems` maiores segmentos; o restante sai em `others` (texto) — barras +
 * others = total da distribuição. "Não informado" fica sempre separado, no fim.
 */
export function rankingChartModel(
  buckets: readonly Bucket[],
  options: {
    palette: ChartPalette;
    isSelected: (key: string) => boolean;
    hasSelection: boolean;
    maxItems?: number;
    labelWidth?: number;
    total: number;
  }
): ChartModel {
  const maxItems = options.maxItems ?? 10;
  const informed = buckets.filter((bucket) => bucket.key !== "na");
  const notInformed = buckets.find((bucket) => bucket.key === "na");
  const head = informed.slice(0, maxItems);
  const rest = informed.slice(maxItems);
  const rows: Array<{ key: string | null; label: string; count: number; filterable: boolean }> = head.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    count: bucket.count,
    filterable: bucket.filterable
  }));
  // O excedente NÃO vira barra (uma barra "Outros" gigante achataria o ranking);
  // o componente mostra "Outros N segmentos: X empresas" em texto e na tabela.
  const others = rest.length > 0 ? { segments: rest.length, count: rest.reduce((sum, bucket) => sum + bucket.count, 0) } : null;
  if (notInformed) rows.push({ key: "na", label: notInformed.label, count: notInformed.count, filterable: notInformed.filterable });

  const { palette } = options;
  const labelWidth = options.labelWidth ?? 150;
  const total = options.total;

  return {
    keys: rows.map((row) => (row.filterable ? row.key : null)),
    height: Math.max(96, rows.length * 30 + 16),
    categoryAxis: "y",
    others,
    option: {
      animation: false,
      aria: { enabled: true },
      textStyle: { fontFamily: palette.fontFamily },
      grid: { left: 8, right: 56, top: 4, bottom: 4, containLabel: true },
      tooltip: {
        ...tooltip(palette),
        formatter: (params: { dataIndex: number }) => {
          const row = rows[params.dataIndex];
          if (!row) return "";
          const pct = total > 0 ? ` (${((row.count / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)` : "";
          return `${escapeHtml(row.label)}<br/><strong>${numberFormat.format(row.count)}</strong> empresa(s)${pct}`;
        }
      },
      xAxis: { type: "value", show: false, minInterval: 1 },
      yAxis: {
        type: "category",
        inverse: true,
        data: rows.map((row) => row.label),
        axisLine: { show: false },
        axisTick: { show: false },
        triggerEvent: true,
        axisLabel: {
          color: palette.labelSecondary,
          fontSize: 12,
          width: labelWidth,
          overflow: "truncate",
          formatter: (value: string) => truncate(value, 42)
        }
      },
      series: [
        {
          type: "bar",
          barMaxWidth: 18,
          barCategoryGap: "30%",
          cursor: "pointer",
          data: rows.map((row) => ({
            value: row.count,
            itemStyle: {
              color: barColor(palette, row.key, options.isSelected, options.hasSelection),
              borderRadius: [0, 4, 4, 0]
            },
            cursor: row.filterable && row.key !== null ? "pointer" : "default"
          })),
          label: {
            show: true,
            position: "right",
            color: palette.label,
            fontSize: 12,
            formatter: (params: { value: number }) => numberFormat.format(params.value)
          },
          emphasis: { disabled: true }
        }
      ]
    }
  };
}

/** Barras verticais em categoria ordenada (faixas de capital, anos, meses). */
export function columnChartModel(
  points: ReadonlyArray<{ key: string; label: string; count: number; filterable?: boolean }>,
  options: {
    palette: ChartPalette;
    isSelected: (key: string) => boolean;
    hasSelection: boolean;
    total: number;
    height?: number;
    /** Rótulo de valor acima de cada barra (use só com poucas barras). */
    showValues?: boolean;
    rotateLabels?: boolean;
  }
): ChartModel {
  const { palette, total } = options;
  return {
    keys: points.map((point) => (point.filterable === false ? null : point.key)),
    height: options.height ?? 240,
    categoryAxis: "x",
    option: {
      animation: false,
      aria: { enabled: true },
      textStyle: { fontFamily: palette.fontFamily },
      grid: { left: 8, right: 8, top: options.showValues ? 22 : 10, bottom: 4, containLabel: true },
      tooltip: {
        ...tooltip(palette),
        formatter: (params: { dataIndex: number }) => {
          const point = points[params.dataIndex];
          if (!point) return "";
          const pct = total > 0 ? ` (${((point.count / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)` : "";
          return `${escapeHtml(point.label)}<br/><strong>${numberFormat.format(point.count)}</strong> empresa(s)${pct}`;
        }
      },
      xAxis: {
        type: "category",
        data: points.map((point) => point.label),
        axisLine: { lineStyle: { color: palette.separator } },
        axisTick: { show: false },
        axisLabel: { color: palette.labelSecondary, fontSize: 11, hideOverlap: true, rotate: options.rotateLabels ? 40 : 0 }
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        splitNumber: 4,
        axisLabel: { color: palette.labelSecondary, fontSize: 11, formatter: (value: number) => numberFormat.format(value) },
        splitLine: { lineStyle: { color: palette.separator } }
      },
      series: [
        {
          type: "bar",
          barMaxWidth: 28,
          barCategoryGap: "20%",
          data: points.map((point) => ({
            value: point.count,
            itemStyle: {
              color: barColor(palette, point.filterable === false ? null : point.key, options.isSelected, options.hasSelection),
              borderRadius: [4, 4, 0, 0]
            }
          })),
          label: options.showValues
            ? {
                show: true,
                position: "top",
                color: palette.label,
                fontSize: 11,
                formatter: (params: { value: number }) => (params.value > 0 ? numberFormat.format(params.value) : "")
              }
            : { show: false },
          emphasis: { disabled: true }
        }
      ]
    }
  };
}

export function timeChartModel(points: readonly TimePoint[], options: Parameters<typeof columnChartModel>[1]) {
  return columnChartModel(points, options);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
