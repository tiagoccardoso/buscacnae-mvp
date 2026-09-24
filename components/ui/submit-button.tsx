"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

type SubmitButtonProps = {
  children: ReactNode;
  pendingLabel?: ReactNode;
  className?: string;
};

/** Botão de envio que reflete o estado do formulário (carregando + desabilitado). */
export function SubmitButton({ children, pendingLabel, className = "button button-lg full" }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
