import Link from "next/link";
import { requestPasswordResetAction } from "@/app/sign-in/server-actions";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Recuperar senha",
  description: "Solicite a recuperação de senha da sua conta BuscaCNAE.",
  path: "/forgot-password",
  robots: { index: false, follow: false }
});

type ForgotPasswordPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const params = searchParams ? await searchParams : {};
  const message = typeof params.message === "string" ? params.message : "";
  const error = typeof params.error === "string" ? params.error : "";
  const email = typeof params.email === "string" ? params.email : "";

  return (
    <main className="page">
      <section className="container auth-grid auth-grid-premium">
        <div className="surface-premium card-lg stack">
          <span className="eyebrow">Recuperação</span>
          <h1 className="display-title" style={{ fontSize: "clamp(2.4rem, 4vw, 4rem)" }}>
            Recupere o acesso à sua conta.
          </h1>
          <p className="lead-copy">Informe o e-mail cadastrado para receber as instruções de redefinição de senha.</p>
        </div>

        <div className="surface-premium card-lg stack auth-form-shell">
          <span className="eyebrow">Esqueci minha senha</span>
          <h2 className="section-title" style={{ fontSize: "2rem", marginBottom: 0 }}>
            Solicitar recuperação
          </h2>
          <p className="section-copy">Por segurança, a mensagem será a mesma mesmo que o e-mail não esteja cadastrado.</p>

          {message ? <div className="notice success">{message}</div> : null}
          {error ? <div className="notice danger">{error}</div> : null}

          <form action={requestPasswordResetAction} className="stack">
            <div className="field">
              <label htmlFor="email">E-mail</label>
              <input id="email" name="email" type="email" className="input input-premium" placeholder="voce@empresa.com" defaultValue={email} autoComplete="email" required />
            </div>
            <button className="button full button-lg" type="submit">
              Recuperar senha
            </button>
          </form>

          <div className="inline-actions" style={{ justifyContent: "space-between" }}>
            <Link href="/sign-in" className="button-ghost">
              Voltar ao login
            </Link>
            <Link href="/sign-up" className="button-secondary">
              Criar conta
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
