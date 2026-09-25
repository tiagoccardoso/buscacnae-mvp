"use client";

import { useEffect, useRef, useState } from "react";
import type { ChartModel, ChartPalette } from "@/lib/analytics/chart-options";
import { cssColorToRgba } from "@/lib/map/palette";

/**
 * Componente reutilizável de gráfico Apache ECharts (Apache-2.0).
 *
 * - Carrega o ECharts sob demanda e com tree-shaking (`echarts/core` + só Bar, Grid,
 *   Tooltip, Aria e o renderizador SVG): nada disso entra no bundle inicial da página.
 * - Uma instância por gráfico, criada uma vez; mudanças de dados/tema usam `setOption`.
 * - Redimensiona com ResizeObserver e descarta a instância no desmonte.
 * - Clique numa barra → `onSelect(chave)` (drill-down). Chave null = barra não clicável.
 * - Cores lidas dos tokens do design system (claro/escuro) e reaplicadas ao trocar o tema.
 */
type EChartsModule = typeof import("echarts/core");
type EChartsInstance = ReturnType<EChartsModule["init"]>;

let loader: Promise<EChartsModule> | null = null;

export function loadECharts() {
  loader ??= import("@/components/intelligence/echarts-setup").then((module) => module.echarts);
  return loader;
}

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string) {
  return styles.getPropertyValue(name).trim() || fallback;
}

/** Mesma cor com opacidade (o ECharts precisa de rgba explícito; não resolve color-mix). */
function withAlpha(color: string, alpha: number) {
  const [red, green, blue] = cssColorToRgba(color);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function readChartPalette(): ChartPalette {
  const styles = getComputedStyle(document.documentElement);
  const accent = readVar(styles, "--accent", "#0A5CE6");
  return {
    accent,
    accentMuted: withAlpha(accent, 0.3),
    neutral: readVar(styles, "--label-quaternary", "#C7C7CC"),
    label: readVar(styles, "--label", "#1D1D1F"),
    labelSecondary: readVar(styles, "--label-secondary", "#6E6E73"),
    separator: readVar(styles, "--separator", "rgba(0,0,0,0.1)"),
    surface: readVar(styles, "--bg-elevated", "#FFFFFF"),
    fontFamily: readVar(styles, "--font-sans", "system-ui, sans-serif")
  };
}

/** Paleta atual + reação à troca de tema (prefers-color-scheme ou data-theme). */
export function useChartPalette() {
  const [palette, setPalette] = useState<ChartPalette | null>(null);
  useEffect(() => {
    const update = () => setPalette(readChartPalette());
    update();
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    media?.addEventListener?.("change", update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => {
      media?.removeEventListener?.("change", update);
      observer.disconnect();
    };
  }, []);
  return palette;
}

type EChartProps = {
  model: ChartModel;
  label: string;
  onSelect?(key: string): void;
};

export function EChart({ model, label, onSelect }: EChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsInstance | null>(null);
  const keysRef = useRef(model.keys);
  const categoryRef = useRef(model.categoryAxis);
  const selectRef = useRef(onSelect);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    keysRef.current = model.keys;
    categoryRef.current = model.categoryAxis;
    selectRef.current = onSelect;
  }, [model.keys, model.categoryAxis, onSelect]);

  // Cria a instância uma vez.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    let disposed = false;
    let observer: ResizeObserver | null = null;

    loadECharts()
      .then((echarts) => {
        if (disposed || !containerRef.current) return;
        const chart = echarts.init(containerRef.current, null, { renderer: "svg" });
        chartRef.current = chart;
        const select = (index: number) => {
          const key = keysRef.current[index];
          if (key && selectRef.current) selectRef.current(key);
        };
        // Clique no rótulo da categoria (fora da área do gráfico).
        chart.on("click", (params) => {
          if (params.componentType === "yAxis" || params.componentType === "xAxis") {
            const index = (chart.getOption() as { [axis: string]: Array<{ data?: unknown[] }> })[`${categoryRef.current}Axis`]?.[0]?.data?.indexOf(
              (params as { value?: unknown }).value
            );
            if (typeof index === "number" && index >= 0) select(index);
          }
        });
        // Clique em qualquer ponto da faixa da categoria (alvo maior que a barra fina).
        const zr = chart.getZr();
        const indexAt = (x: number, y: number) => {
          if (!chart.containPixel("grid", [x, y])) return -1;
          const value = chart.convertFromPixel({ seriesIndex: 0 }, [x, y]) as number[] | null;
          if (!value) return -1;
          const index = Math.round(categoryRef.current === "y" ? value[1] : value[0]);
          return index >= 0 && index < keysRef.current.length ? index : -1;
        };
        zr.on("click", (event) => {
          const index = indexAt(event.offsetX, event.offsetY);
          if (index >= 0) select(index);
        });
        zr.on("mousemove", (event) => {
          const index = indexAt(event.offsetX, event.offsetY);
          zr.setCursorStyle(index >= 0 && keysRef.current[index] ? "pointer" : "default");
        });
        observer = new ResizeObserver(() => chart.resize());
        observer.observe(element);
        setReady(true);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });

    return () => {
      disposed = true;
      observer?.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  // Dados/tema → setOption (substitui a opção inteira: sem resíduo de séries antigas).
  useEffect(() => {
    if (!ready || !chartRef.current) return;
    chartRef.current.setOption(model.option, true);
    chartRef.current.resize();
  }, [model, ready]);

  if (failed) {
    return <p className="footnote">Não foi possível carregar o gráfico. Os mesmos números estão na tabela abaixo.</p>;
  }

  return (
    <div
      ref={containerRef}
      className="echart"
      role="img"
      aria-label={label}
      style={{ height: model.height }}
      data-ready={ready ? "true" : undefined}
    />
  );
}
