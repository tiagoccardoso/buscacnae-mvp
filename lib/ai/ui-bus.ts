"use client";

import { useEffect, useRef } from "react";
import type { CompanyTableFilters } from "@/lib/results/company-table-model";
import type { AiMapLayer, AiUiCommand, AiView } from "@/lib/ai/types";

/**
 * Canal CONTROLADO entre o assistente e as abas Empresas / Mapa / Inteligência.
 *
 * O assistente nunca manipula o DOM nem o estado interno das abas: ele emite um comando
 * tipado (visão + filtros da URL já validados no servidor + camada do mapa) e a aba ativa
 * aplica pelo MESMO `setFilters` que os controles da tela usam. Comando para outra aba vira
 * navegação normal com os filtros na URL (a aba nova lê os filtros ao montar).
 */

export const AI_COMMAND_EVENT = "buscacnae:ai-command";

export type AiCommandDetail = { view: AiView; filters: CompanyTableFilters; layer: AiMapLayer | null };

export function dispatchAiCommand(command: AiUiCommand) {
  const detail: AiCommandDetail = { view: command.view, filters: command.filters, layer: command.layer };
  window.dispatchEvent(new CustomEvent<AiCommandDetail>(AI_COMMAND_EVENT, { detail }));
}

/** Aba escuta os comandos destinados a ela (`null` = não escuta). */
export function useAiCommands(view: AiView | null, handler: (detail: AiCommandDetail) => void) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  useEffect(() => {
    if (!view) return;
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<AiCommandDetail>).detail;
      if (detail && detail.view === view) handlerRef.current(detail);
    };
    window.addEventListener(AI_COMMAND_EVENT, listener);
    return () => window.removeEventListener(AI_COMMAND_EVENT, listener);
  }, [view]);
}
