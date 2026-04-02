import Link from "next/link";
import { requestMagicLinkAction } from "./server-actions";

type SignInPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = searchParams ? await searchParams : {};
  const message = typeof params.message === "string" ? params.message : "";
  const error = typeof params.error === "string" ? params.error : "";

  return (
    <main className="page">
      <section className="container auth-grid auth-grid-premium">
        <div className="surface-premium card-lg stack">
          <span className="eyebrow">Acesso premium</span>
          <h1 className="display-title" style={{ fontSize: "clamp(2.4rem, 4vw, 4rem)" }}>
            Entre no dashboard com uma experiência executiva e sem fricção.
          </h1>
          <p className="lead-copy">
            O link mágico conecta autenticação, histórico, governança e detalhamento de listas em um fluxo pensado para operações comerciais.
          </p>

          <div className="hero-signal-grid compact-two">
            <div className="signal-card">
              <span className="kicker">Auth</span>
              <strong>Magic link</strong>
              <span className="muted">Entrada segura sem senha para agilizar o começo da jornada.</span>
            </div>
            <div className="signal-card">
              <span className="kicker">Onboarding</span>
              <strong>Leitura guiada</strong>
              <span className="muted">A experiência encaixa pesquisa pública e governança sem parecer um sistema pesado.</span>
            </div>
          </div>

          <div className="inline-actions">
            <Link href="/onboarding" className="button-secondary">
              Ver onboarding corporativo
            </Link>
            <Link href="/" className="button-ghost">
              Voltar para a pesquisa
            </Link>
          </div>
        </div>

        <div className="surface-premium card-lg stack auth-form-shell">
          <span className="eyebrow">Entrar</span>
          <h2 className="section-title" style={{ fontSize: "2rem", marginBottom: 0 }}>
            Receba um link de acesso no seu email
          </h2>
          <p className="section-copy">Sem senha, sem fricção e com a mesma linguagem premium do restante da plataforma.</p>

          {message ? <div className="notice success">{message}</div> : null}
          {error ? <div className="notice danger">{error}</div> : null}

          <form action={requestMagicLinkAction} className="stack">
            <div className="field">
              <label htmlFor="email">Email corporativo</label>
              <input id="email" name="email" type="email" className="input input-premium" placeholder="voce@empresa.com" required />
            </div>
            <button className="button full button-lg" type="submit">
              Enviar link mágico
            </button>
          </form>

          <div className="tiny">
            No primeiro acesso, o trigger do banco cria o perfil automaticamente para integrar auth, histórico e billing em um mesmo fluxo.
          </div>
        </div>
      </section>
    </main>
  );
}
