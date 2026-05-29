import Link from "next/link";
import { requestAccessCodeAction, verifyAccessCodeAction } from "./server-actions";
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
  const email = typeof params.email === "string" ? params.email : "";
  const next = typeof params.next === "string" ? params.next : "/dashboard";
  const orderId = typeof params.order_id === "string" ? params.order_id : "";

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
              <strong>Código de acesso por e-mail</strong>
              <span className="muted">Receba o código de acesso e entre sem criar mais uma senha para a operação.</span>
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
            Receba um código de acesso no seu e-mail
          </h2>
          <p className="section-copy">Use o mesmo e-mail da compra para manter histórico, checkout e listas liberadas no mesmo lugar.</p>

          {message ? <div className="notice success">{message}</div> : null}
          {error ? <div className="notice danger">{error}</div> : null}

          <form action={requestAccessCodeAction} className="stack" data-analytics-event="login_started" data-analytics-label="Sign in form">
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="orderId" value={orderId} />
            <div className="field">
              <label htmlFor="email">E-mail de acesso</label>
              <input id="email" name="email" type="email" className="input input-premium" placeholder="voce@empresa.com" defaultValue={email} required />
            </div>
            <button className="button full button-lg" type="submit">
              Enviar código de acesso
            </button>
          </form>

          {email ? (
            <form action={verifyAccessCodeAction} className="stack" data-analytics-event="login_code_submitted" data-analytics-label="Sign in code form">
              <input type="hidden" name="email" value={email} />
              <input type="hidden" name="next" value={next} />
              <input type="hidden" name="orderId" value={orderId} />
              <div className="field">
                <label htmlFor="otp">Código recebido</label>
                <input id="otp" name="otp" className="input input-premium" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required />
              </div>
              <button className="button-secondary full button-lg" type="submit">
                Confirmar acesso
              </button>
            </form>
          ) : null}

          <div className="tiny">
            No primeiro acesso, o perfil é criado automaticamente para integrar autenticação, histórico e pedidos no mesmo fluxo.
          </div>
        </div>
      </section>
    </main>
  );
}
