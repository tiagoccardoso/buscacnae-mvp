import Link from "next/link";
import { resetPasswordAction } from "@/app/sign-in/server-actions";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Redefinir senha",
  description: "Defina uma nova senha para sua conta BuscaCNAE.",
  path: "/reset-password",
  robots: { index: false, follow: false }
});

type ResetPasswordPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = searchParams ? await searchParams : {};
  const token = typeof params.token === "string" ? params.token : "";
  const error = typeof params.error === "string" ? params.error : "";

  return (
    <main className="page">
      <section className="container auth-grid auth-grid-premium">
        <div className="surface-premium card-lg stack">
          <span className="eyebrow">Nova senha</span>
          <h1 className="display-title" style={{ fontSize: "clamp(2.4rem, 4vw, 4rem)" }}>
            Defina uma nova senha de acesso.
          </h1>
          <p className="lead-copy">Use o link recebido por e-mail para cadastrar uma nova senha.</p>
        </div>

        <div className="surface-premium card-lg stack auth-form-shell">
          <span className="eyebrow">Redefinição</span>
          <h2 className="section-title" style={{ fontSize: "2rem", marginBottom: 0 }}>
            Redefinir senha
          </h2>

          {!token ? <div className="notice danger">Token de recuperação ausente ou inválido. Solicite uma nova recuperação de senha.</div> : null}
          {error ? <div className="notice danger">{error}</div> : null}

          {token ? (
            <form action={resetPasswordAction} className="stack">
              <input type="hidden" name="token" value={token} />
              <div className="field">
                <label htmlFor="password">Nova senha</label>
                <input id="password" name="password" type="password" className="input input-premium" placeholder="Mínimo de 8 caracteres" autoComplete="new-password" minLength={8} required />
              </div>
              <div className="field">
                <label htmlFor="confirmPassword">Confirmar nova senha</label>
                <input id="confirmPassword" name="confirmPassword" type="password" className="input input-premium" placeholder="Repita a nova senha" autoComplete="new-password" minLength={8} required />
              </div>
              <button className="button full button-lg" type="submit">
                Salvar nova senha
              </button>
            </form>
          ) : null}

          <div className="inline-actions" style={{ justifyContent: "space-between" }}>
            <Link href="/forgot-password" className="button-ghost">
              Solicitar novo link
            </Link>
            <Link href="/sign-in" className="button-secondary">
              Voltar ao login
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
