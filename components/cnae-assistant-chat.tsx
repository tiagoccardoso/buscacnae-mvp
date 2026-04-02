"use client";

import { useState } from "react";
import { formatCnaeCode } from "@/lib/cnae-utils";

type CnaeSuggestion = {
  code: string;
  label: string;
  reason: string;
};

const QUICK_PROMPTS = [
  "Quero CNAEs para software, SaaS e consultoria em tecnologia.",
  "Me sugira CNAEs para marketing, geração de leads e publicidade.",
  "Quais CNAEs combinam com contabilidade, BPO financeiro e consultoria empresarial?"
];

export function CnaeAssistantChat({
  selectedCodes,
  onAddSuggestion
}: {
  selectedCodes: string[];
  onAddSuggestion: (suggestion: CnaeSuggestion) => void;
}) {
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState("");
  const [suggestions, setSuggestions] = useState<CnaeSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function askAssistant(prompt?: string) {
    const finalPrompt = (prompt ?? message).trim();
    if (!finalPrompt || loading) return;

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/chat/cnae-assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: finalPrompt,
          selectedCodes
        })
      });

      const payload = (await response.json()) as {
        answer?: string;
        suggestions?: CnaeSuggestion[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível consultar o assistente agora.");
      }

      setAnswer(payload.answer || "");
      setSuggestions(Array.isArray(payload.suggestions) ? payload.suggestions : []);
      if (!prompt) {
        setMessage("");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível consultar o assistente agora.");
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="cnae-chat-shell surface-soft">
      <div className="cnae-chat-header">
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">Assistente de CNAEs</span>
          <strong className="cnae-chat-title">Descreva o negócio e receba sugestões prontas para adicionar.</strong>
          <span className="muted">
            O chat ajuda a encontrar CNAEs aderentes ao contexto e você pode incluir qualquer sugestão com um clique.
          </span>
        </div>
      </div>

      <div className="cnae-chat-form">
        <textarea
          className="textarea input-premium cnae-chat-input"
          placeholder="Ex.: empresa de software sob demanda, implantação de ERP e suporte técnico..."
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
        <div className="cnae-chat-actions">
          <button type="button" className="button button-lg" onClick={() => askAssistant()} disabled={loading || !message.trim()}>
            {loading ? "Consultando..." : "Pedir sugestões"}
          </button>
          <div className="cnae-chat-prompts">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                type="button"
                key={prompt}
                className="button-ghost cnae-chat-prompt"
                onClick={() => {
                  setMessage(prompt);
                  void askAssistant(prompt);
                }}
                disabled={loading}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error ? <div className="notice danger">{error}</div> : null}

      {answer ? <div className="cnae-chat-answer">{answer}</div> : null}

      {suggestions.length > 0 ? (
        <div className="cnae-chat-suggestions">
          {suggestions.map((suggestion) => {
            const alreadySelected = selectedCodes.includes(suggestion.code);
            return (
              <button
                type="button"
                key={`${suggestion.code}-${suggestion.label}`}
                className={`cnae-suggestion-card${alreadySelected ? " is-selected" : ""}`}
                onClick={() => onAddSuggestion(suggestion)}
                disabled={alreadySelected}
              >
                <span className="cnae-suggestion-code">{formatCnaeCode(suggestion.code)}</span>
                <strong>{suggestion.label}</strong>
                <span className="muted">{suggestion.reason}</span>
                <span className="cnae-suggestion-cta">{alreadySelected ? "Já adicionado" : "Adicionar à pesquisa"}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
