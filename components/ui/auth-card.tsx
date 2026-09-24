import type { ReactNode } from "react";

type AuthCardProps = {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
};

/** Cartão centralizado para login, cadastro e recuperação de senha. */
export function AuthCard({ title, subtitle, children, footer }: AuthCardProps) {
  return (
    <div className="auth">
      <div className="auth-card enter">
        <div className="auth-card-header">
          <span className="brand-mark" aria-hidden="true">BC</span>
          <h1 className="title-1">{title}</h1>
          {subtitle ? <p className="section-copy">{subtitle}</p> : null}
        </div>
        {children}
        {footer ? <nav className="auth-links" aria-label="Outras opções de acesso">{footer}</nav> : null}
      </div>
    </div>
  );
}
