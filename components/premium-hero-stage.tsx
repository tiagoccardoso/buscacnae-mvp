"use client";

import { useState } from "react";

const orbitCards = [
  {
    eyebrow: "Escolha clara",
    title: "Recorte comercial mais preciso",
    copy: "A proposta da tela é ajudar você a combinar filtros com mais segurança antes de liberar a lista."
  },
  {
    eyebrow: "Leitura rápida",
    title: "Volume fácil de entender",
    copy: "Os elementos visuais ajudam a perceber rapidamente o tamanho da oportunidade encontrada."
  },
  {
    eyebrow: "Preço transparente",
    title: "Pagamento por resultado",
    copy: "Você vê a quantidade encontrada antes de pagar e libera somente o que fizer sentido para a sua operação."
  },
  {
    eyebrow: "Uso imediato",
    title: "Pesquisa pronta para prospecção",
    copy: "A navegação prioriza o que mais importa para o usuário: filtrar bem, entender o valor e acessar a lista."
  }
];

const nodes = [
  { left: "12%", top: "28%", delay: "0s" },
  { left: "22%", top: "62%", delay: "1.4s" },
  { left: "39%", top: "18%", delay: "0.8s" },
  { left: "48%", top: "54%", delay: "1.8s" },
  { left: "66%", top: "28%", delay: "0.4s" },
  { left: "78%", top: "64%", delay: "1.2s" }
];

const particles = [
  { left: "10%", top: "18%", size: "sm", delay: "0s" },
  { left: "18%", top: "70%", size: "xs", delay: "1.3s" },
  { left: "33%", top: "34%", size: "md", delay: "0.6s" },
  { left: "52%", top: "16%", size: "xs", delay: "2.1s" },
  { left: "58%", top: "74%", size: "sm", delay: "1.7s" },
  { left: "71%", top: "44%", size: "md", delay: "0.9s" },
  { left: "84%", top: "22%", size: "xs", delay: "1.1s" },
  { left: "88%", top: "72%", size: "sm", delay: "2.4s" }
];

export function PremiumHeroStage() {
  const [activePane, setActivePane] = useState<"main" | "chart" | "curve">("main");

  return (
    <div className="hero-stage-shell surface-premium">
      <div className="hero-stage-topline">
        <span className="badge-glow">Pesquisa orientada a resultado</span>
        <span className="hero-stage-note">Escolha filtros, avalie o volume encontrado e avance para a lista com rapidez.</span>
      </div>

      <div className="hero-stage-canvas hero-stage-canvas-network">
        <div className="hero-network-grid" aria-hidden="true" />
        <svg className="hero-network-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="heroLineGradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="rgba(124, 92, 255, 0.9)" />
              <stop offset="100%" stopColor="rgba(69, 160, 255, 0.85)" />
            </linearGradient>
          </defs>
          <path d="M12 28 L39 18 L66 28 L78 64" className="hero-network-path hero-network-path-a" />
          <path d="M22 62 L48 54 L66 28" className="hero-network-path hero-network-path-b" />
          <path d="M39 18 L48 54 L78 64" className="hero-network-path hero-network-path-c" />
          <path d="M12 28 L22 62 L48 54 L78 64" className="hero-network-path hero-network-path-d" />
        </svg>

        <div className="hero-glow-orb hero-glow-orb-a" aria-hidden="true" />
        <div className="hero-glow-orb hero-glow-orb-b" aria-hidden="true" />
        <div className="hero-glow-orb hero-glow-orb-c" aria-hidden="true" />

        {particles.map((particle, index) => (
          <span
            key={`${particle.left}-${particle.top}-${index}`}
            className={`hero-particle hero-particle-${particle.size}`}
            style={{ left: particle.left, top: particle.top, animationDelay: particle.delay }}
            aria-hidden="true"
          />
        ))}

        {nodes.map((node, index) => (
          <span
            key={`${node.left}-${node.top}-${index}`}
            className="hero-node"
            style={{ left: node.left, top: node.top, animationDelay: node.delay }}
            aria-hidden="true"
          />
        ))}

        <button
          type="button"
          className={`hero-data-card hero-floating-window hero-data-card-main ${activePane === "main" ? "is-front" : ""}`}
          onClick={() => setActivePane("main")}
          onFocus={() => setActivePane("main")}
          aria-pressed={activePane === "main"}
        >
          <span className="eyebrow">Pesquisa comercial</span>
          <strong>Encontre empresas com um recorte mais preciso para prospecção.</strong>
          <span className="muted">
            Selecione CNAE e região, veja o volume encontrado e libere a lista somente quando o resultado fizer sentido.
          </span>
          <div className="hero-kpi-strip">
            <div>
              <span className="kicker">Recorte</span>
              <strong>CNAE + região</strong>
            </div>
            <div>
              <span className="kicker">Preço</span>
              <strong>R$ 0,05 até R$ 0,20</strong>
            </div>
          </div>
        </button>

        <button
          type="button"
          className={`hero-data-card hero-floating-window hero-data-card-chart ${activePane === "chart" ? "is-front" : ""}`}
          onClick={() => setActivePane("chart")}
          onFocus={() => setActivePane("chart")}
          aria-pressed={activePane === "chart"}
        >
          <span className="kicker">Estimativa de volume</span>
          <div className="hero-mini-bars" aria-hidden="true">
            <span className="bar-delay-1" />
            <span className="bar-delay-2" />
            <span className="bar-delay-3" />
            <span className="bar-delay-4" />
            <span className="bar-delay-5" />
          </div>
          <span className="muted">Visual pronto para entender rapidamente o tamanho da oportunidade.</span>
        </button>

        <button
          type="button"
          className={`hero-data-card hero-floating-window hero-data-card-curve ${activePane === "curve" ? "is-front" : ""}`}
          onClick={() => setActivePane("curve")}
          onFocus={() => setActivePane("curve")}
          aria-pressed={activePane === "curve"}
        >
          <span className="kicker">Cobertura da pesquisa</span>
          <svg viewBox="0 0 180 70" className="hero-curve-svg" aria-hidden="true">
            <path d="M4 58 C28 54, 36 30, 58 32 S92 64, 116 42 S150 10, 176 14" className="hero-curve-path" />
          </svg>
          <span className="muted">Combine filtros nacionais, estaduais e locais sem perder o controle do recorte.</span>
        </button>
      </div>

      <div className="hero-stage-grid">
        {orbitCards.map((item) => (
          <div className="hero-stage-card" key={item.title}>
            <span className="eyebrow">{item.eyebrow}</span>
            <strong>{item.title}</strong>
            <span className="muted">{item.copy}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
