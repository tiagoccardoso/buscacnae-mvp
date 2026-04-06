"use client";

import { useState } from "react";

export function SearchImmersiveStage() {
  const [activePane, setActivePane] = useState<"core" | "main" | "cnaes" | "states" | "cities">("core");

  return (
    <div className="search-immersive-stage surface-premium">
      <div className="search-immersive-noise" />
      <div className="search-immersive-grid" />

      <div className="search-immersive-particle particle-a" />
      <div className="search-immersive-particle particle-b" />
      <div className="search-immersive-particle particle-c" />
      <div className="search-immersive-particle particle-d" />

      <svg className="search-immersive-lines" viewBox="0 0 600 560" aria-hidden="true">
        <defs>
          <linearGradient id="search-flow" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(124,92,255,0)" />
            <stop offset="35%" stopColor="rgba(124,92,255,0.95)" />
            <stop offset="100%" stopColor="rgba(69,160,255,0.9)" />
          </linearGradient>
        </defs>
        <path className="flow-line flow-line-a" d="M50 110 C 180 40, 250 80, 340 180 S 520 260, 560 200" />
        <path className="flow-line flow-line-b" d="M40 260 C 160 240, 220 260, 320 320 S 500 390, 560 330" />
        <path className="flow-line flow-line-c" d="M60 430 C 150 500, 260 470, 350 400 S 500 300, 560 280" />
      </svg>

      <button
        type="button"
        className={`search-immersive-core search-floating-window ${activePane === "core" ? "is-front" : ""}`}
        onClick={() => setActivePane("core")}
        onFocus={() => setActivePane("core")}
        aria-pressed={activePane === "core"}
      >
        <span className="eyebrow">Pesquise</span>
        <strong>Monte a lista em uma única tela.</strong>
        <span className="muted">
          Escolha CNAEs, estados e cidades com clareza e avance para a prévia da lista sem depender de outra jornada.
        </span>
      </button>

      <button
        type="button"
        className={`search-immersive-card search-floating-window card-main ${activePane === "main" ? "is-front" : ""}`}
        onClick={() => setActivePane("main")}
        onFocus={() => setActivePane("main")}
        aria-pressed={activePane === "main"}
      >
        <span className="kicker">Refine</span>
        <strong>Combine filtros sem perder a visão da lista</strong>
        <span className="muted">Adicione quantos CNAEs, UFs e cidades fizer sentido para o público que você quer alcançar.</span>
      </button>

      <button
        type="button"
        className={`search-immersive-card search-floating-window card-cnaes ${activePane === "cnaes" ? "is-front" : ""}`}
        onClick={() => setActivePane("cnaes")}
        onFocus={() => setActivePane("cnaes")}
        aria-pressed={activePane === "cnaes"}
      >
        <span className="kicker">CNAEs</span>
        <div className="mini-bar-chart">
          <span />
          <span />
          <span />
          <span />
        </div>
        <span className="muted">Busque por código ou descrição e encontre a atividade certa com mais rapidez.</span>
      </button>

      <button
        type="button"
        className={`search-immersive-card search-floating-window card-states ${activePane === "states" ? "is-front" : ""}`}
        onClick={() => setActivePane("states")}
        onFocus={() => setActivePane("states")}
        aria-pressed={activePane === "states"}
      >
        <span className="kicker">Estados</span>
        <div className="mini-nodes">
          <span />
          <span />
          <span />
        </div>
        <span className="muted">Amplie a cobertura territorial escolhendo um ou vários estados para comparar oportunidades.</span>
      </button>

      <button
        type="button"
        className={`search-immersive-card search-floating-window card-cities ${activePane === "cities" ? "is-front" : ""}`}
        onClick={() => setActivePane("cities")}
        onFocus={() => setActivePane("cities")}
        aria-pressed={activePane === "cities"}
      >
        <span className="kicker">Cidades</span>
        <strong>Filtro local ou visão estadual</strong>
        <span className="muted">Refine por município ou pesquise o estado inteiro quando preferir amplitude.</span>
      </button>
    </div>
  );
}
