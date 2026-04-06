"use client";

import { useFormStatus } from "react-dom";

export function PublicSearchSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="button button-lg" disabled={pending} aria-disabled={pending}>
      {pending ? "Buscando empresas e calculando o lote..." : "Ver quantidade e valor da lista"}
    </button>
  );
}
