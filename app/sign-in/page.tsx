import Link from "next/link";
import { signInWithPasswordAction } from "./server-actions";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Entrar",
  description: "Acesse sua conta com e-mail e senha para consultar histórico, listas liberadas, leads salvos e recompras.",
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
  const email = typeof params.email === "string" ? params.email : "";
  const next = typeof params.next === "string" ? params.next : "/dashboard";
  const orderId = typeof params.order_id === "string" ? params.order_id : "";
  const signUpHref = `/sign-up?next=${encodeURIComponent(next)}${orderId ? `&order_id=${encodeURIComponent(orderId)}` : ""}${email ? `&email=${encodeURIComponent(email)}` : ""}`;

  return (
    <main className="page">
      <section className="container auth-grid auth-grid-premium">
        <div className="surface-premium card-lg stack">
          <span className="eyebrow">Entrar</span>
          <h1 className="display-title" style={{ fontSize: "clamp(2.4rem, 4vw, 4rem)" }}>
            Acesse sua conta para organizar histórico, leads salvos e recompras.
          </h1>
          <p className="lead-copy">
            Entre com e-mail e senha para visualizar suas buscas, abrir listas liberadas e continuar seus pedidos com segurança.
          </p>

          <div className="hero-signal-grid compact-two">
            <div className="signal-card">
              <span className="kicker">Conta segura</span>
              <strong>Login por e-mail e senha</strong>
              <span className="muted">Sua sessão é protegida por cookie seguro e senha criptografada.</span>
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
            Entre com seu e-mail e senha
          </h2>
          <p className="section-copy">Use o mesmo e-mail da compra para manter histórico, checkout e listas liberadas no mesmo lugar.</p>

          {message ? <div className="notice success">{message}</div> : null}
          {error ? <div className="notice danger">{error}</div> : null}

          <form action={signInWithPasswordAction} className="stack" data-analytics-event="login_started" data-analytics-label="Sign in form">
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="orderId" value={orderId} />
            <div className="field">
              <label htmlFor="email">E-mail</label>
              <input id="email" name="email" type="email" className="input input-premium" placeholder="voce@empresa.com" defaultValue={email} autoComplete="email" required />
            </div>
            <div className="field">
              <label htmlFor="password">Senha</label>
              <input id="password" name="password" type="password" className="input input-premium" placeholder="Digite sua senha" autoComplete="current-password" required />
            </div>
            <button className="button full button-lg" type="submit">
              Entrar
            </button>
          </form>

          <div className="inline-actions" style={{ justifyContent: "space-between" }}>
            <Link href={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ""}`} className="button-ghost">
              Esqueci minha senha
            </Link>
            <Link href={signUpHref} className="button-secondary">
              Criar conta
            </Link>
          </div>

          <div className="tiny">Se ainda não tiver cadastro, crie uma conta para acessar o dashboard e acompanhar seus pedidos.</div>
        </div>
      </section>
    </main>
  );
}
