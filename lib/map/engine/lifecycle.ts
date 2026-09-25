/**
 * Pilha de descarte do mapa.
 *
 * Adaptado do padrão `defer(cleanup)` de `src/app/application.js` do God's Eye View
 * (MIT, © 2026 Bilawal Sidhu): cada recurso adquirido (viewer, handlers, listeners,
 * timers, camadas) registra seu descarte imediatamente após ser criado; o descarte
 * roda em ordem inversa, tolera falhas individuais e é idempotente.
 */
export type Disposer = () => void;

export function createDisposerStack() {
  const disposers: Disposer[] = [];
  let disposed = false;

  return {
    get disposed() {
      return disposed;
    },
    /** Registra um descarte. Se a pilha já foi descartada, executa imediatamente. */
    defer(dispose: Disposer) {
      if (disposed) {
        try {
          dispose();
        } catch {
          /* recurso adquirido após o descarte: liberado na hora */
        }
        return;
      }
      disposers.push(dispose);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      while (disposers.length) {
        const next = disposers.pop()!;
        try {
          next();
        } catch (error) {
          console.warn("[map] falha ao liberar recurso", error instanceof Error ? error.message : error);
        }
      }
    }
  };
}

export type DisposerStack = ReturnType<typeof createDisposerStack>;

/** Debounce com cancelamento explícito (registrado na pilha de descarte). */
export function debounce<T extends unknown[]>(fn: (...args: T) => void, waitMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = (...args: T) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };
  run.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return run;
}
