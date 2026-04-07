import Link from "next/link";
import { requestMagicLinkAction } from "./server-actions";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Entrar",
  description: "Acesse o dashboard para histórico, listas liberadas, leads salvos e recompra usando um link de acesso por e-mail.",
  path: "/sign-in",
  robots: { index: false, follow: false }
});

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
          <span className="eyebrow">Entrar</span>
          <h1 className="display-title" style={{ fontSize: "clamp(2.4rem, 4vw, 4rem)" }}>
            Acesse o dashboard para organizar histórico, leads salvos e recompras.
          </h1>
          <p className="lead-copy">
            O login não é obrigatório para pesquisar. Ele existe para guardar suas buscas, abrir listas liberadas depois e facilitar o próximo pedido.
          </p>

          <div className="hero-signal-grid compact-two">
            <div className="signal-card">
              <span className="kicker">Sem senha</span>
              <strong>Link de acesso por e-mail</strong>
              <span className="muted">Receba o link mágico e entre sem criar mais uma senha para a operação.</span>
            </div>
            <div className="signal-card">
              <span className="kicker">Uso prático</span>
              <strong>Histórico, listas e recompra</strong>
              <span className="muted">O dashboard ajuda a repetir filtros, salvar leads e reabrir listas já compradas.</span>
            </div>
          </div>

          <div className="inline-actions">
            <Link href="/onboarding" className="button-secondary">
              Ver como funciona
            </Link>
            <Link href="/" className="button-ghost">
              Voltar para a pesquisa
            </Link>
          </div>
        </div>

        <div className="surface-premium card-lg stack auth-form-shell">
          <span className="eyebrow">Acesso ao dashboard</span>
          <h2 className="section-title" style={{ fontSize: "2rem", marginBottom: 0 }}>
            Receba um link de acesso no seu e-mail
          </h2>
          <p className="section-copy">Use o mesmo e-mail da compra para manter histórico, checkout e listas liberadas no mesmo lugar.</p>

          {message ? <div className="notice success">{message}</div> : null}
          {error ? <div className="notice danger">{error}</div> : null}

          <form action={requestMagicLinkAction} className="stack" data-analytics-event="login_started" data-analytics-label="Sign in form">
            <div className="field">
              <label htmlFor="email">E-mail de acesso</label>
              <input id="email" name="email" type="email" className="input input-premium" placeholder="voce@empresa.com" required />
            </div>
            <button className="button full button-lg" type="submit">
              Enviar link de acesso
            </button>
          </form>

          <div className="tiny">
            No primeiro acesso, o perfil é criado automaticamente para integrar autenticação, histórico e pedidos no mesmo fluxo.
          </div>
        </div>
      </section>
    </main>
  );
}
