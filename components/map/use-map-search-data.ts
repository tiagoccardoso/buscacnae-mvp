"use client";

import { useCallback, useEffect, useState } from "react";
import type { MapSearchData } from "@/lib/map/types";

export type MapDataStatus = "idle" | "loading" | "ready" | "error";

type Settled = {
  key: string;
  data: MapSearchData | null;
  error: string | null;
};

/**
 * Carrega os dados do mapa de uma busca salva.
 * Cada troca de busca cancela a requisição anterior (AbortController), evitando que
 * uma resposta antiga sobrescreva a atual. Enquanto a nova busca carrega, os dados
 * anteriores continuam visíveis (sem piscar o mapa).
 */
export function useMapSearchData(searchId: string | null) {
  const [reloadToken, setReloadToken] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const requestKey = searchId ? `${searchId}#${reloadToken}` : null;

  useEffect(() => {
    if (!searchId || !requestKey) return;
    const controller = new AbortController();

    fetch(`/api/map/searches/${encodeURIComponent(searchId)}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store"
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (MapSearchData & { error?: string }) | null;
        if (!response.ok || !body || body.error) {
          throw new Error(body?.error || "Não foi possível carregar o mapa agora.");
        }
        return body;
      })
      .then((data) => {
        if (!controller.signal.aborted) setSettled({ key: requestKey, data, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof Error && error.message ? error.message : "Não foi possível carregar o mapa agora.";
        setSettled((previous) => ({ key: requestKey, data: previous?.data ?? null, error: message }));
      });

    return () => controller.abort();
  }, [searchId, requestKey]);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  let status: MapDataStatus = "idle";
  if (requestKey) {
    status = settled?.key === requestKey ? (settled.error ? "error" : "ready") : "loading";
  }

  return {
    status,
    data: requestKey ? settled?.data ?? null : null,
    error: status === "error" ? settled?.error ?? null : null,
    reload
  };
}
