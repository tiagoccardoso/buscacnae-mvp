"use client";

import { useFormStatus } from "react-dom";

export function PublicSearchSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="button button-lg" disabled={pending} aria-disabled={pending}>
      {pending ? "Pesquisando e calculando o valor da lista..." : "Ver volume e valor da lista"}
    </button>
  );
}
