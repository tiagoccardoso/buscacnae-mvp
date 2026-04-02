"use client";

import { useFormStatus } from "react-dom";

export function PublicSearchSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="button button-lg" disabled={pending} aria-disabled={pending}>
      {pending ? "Calculando quantidade e valor..." : "Buscar e calcular valor"}
    </button>
  );
}
