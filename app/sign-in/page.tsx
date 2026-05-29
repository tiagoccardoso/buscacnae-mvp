import Link from "next/link";
import { requestPasswordRecoveryAction, signInWithPasswordAction, signUpWithPasswordAction } from "./server-actions";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Entrar",
  description: "Acesse o dashboard com login seguro por e-mail e senha usando Neon Auth.",
  path: "/sign-in",
  robots: { index: false, follow: false }
});

type SignInPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type AuthMode = "login" | "recover" | "signup";

function parseMode(value: string | string[] | undefined): AuthMode {
  if (value === "recover" || value === "signup") return value;
  return "login";
}

function getModeCopy(mode: AuthMode) {
  if (mode === "recover") {
    return {
      eyebrow: "Esqueci minha senha",
      title: "Receba as instruções para recuperar sua senha",
      description: "Informe o e-mail cadastrado. Por segurança, exibiremos a mesma confirmação mesmo que o endereço não exista na base."
    };
  }

  if (mode === "signup") {
    return {
      eyebrow: "Novo cadastro",
      title: "Crie sua conta para acessar o dashboard",
      description: "Use nome, e-mail e senha para centralizar histórico, listas liberadas e recompras no mesmo perfil."
    };
  }

  return {
    eyebrow: "Acesso ao dashboard",
    title: "Entre com e-mail e senha",
    description: "Use o e-mail cadastrado para acessar seu histórico, listas liberadas e leads salvos com autenticação Neon Auth."
  };
}

function AuthModeLinks({ mode, next, orderId, email }: { mode: AuthMode; next: string; orderId: string; email: string }) {
  const baseParams = new URLSearchParams();
  baseParams.set("next", next);
  if (orderId) baseParams.set("order_id", orderId);
  if (email) baseParams.set("email", email);

  const buildHref = (targetMode: AuthMode) => {
    const params = new URLSearchParams(baseParams);
    if (targetMode !== "login") params.set("mode", targetMode);
    return `/sign-in?${params.toString()}`;
  };

  return (
    <div className="inline-actions" style={{ justifyContent: "space-between" }}>
      {mode !== "login" ? (
        <Link href={buildHref("login")} className="button-ghost">
          Voltar para entrar
        </Link>
      ) : (
        <Link href={buildHref("recover")} className="button-ghost">
          Esqueci minha senha
        </Link>
      )}
      {mode !== "signup" ? (
        <Link href={buildHref("signup")} className="button-secondary">
          Criar nova conta
        </Link>
      ) : null}
    </div>
  );
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = searchParams ? await searchParams : {};
  const mode = parseMode(params.mode);
  const copy = getModeCopy(mode);
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
              <span className="kicker">Neon Auth</span>
              <strong>Login por e-mail e senha</strong>
              <span className="muted">Entre com credenciais reais, sem modo mock e sem mensagens de provedores antigos.</span>
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
          <span className="eyebrow">{copy.eyebrow}</span>
          <h2 className="section-title" style={{ fontSize: "2rem", marginBottom: 0 }}>
            {copy.title}
          </h2>
          <p className="section-copy">{copy.description}</p>

          {message ? <div className="notice success">{message}</div> : null}
          {error ? <div className="notice danger">{error}</div> : null}

          {mode === "login" ? (
            <form action={signInWithPasswordAction} className="stack" data-analytics-event="login_started" data-analytics-label="Sign in form">
              <input type="hidden" name="mode" value="login" />
              <input type="hidden" name="next" value={next} />
              <input type="hidden" name="orderId" value={orderId} />
              <div className="field">
                <label htmlFor="email">E-mail</label>
                <input id="email" name="email" type="email" className="input input-premium" placeholder="voce@empresa.com" defaultValue={email} autoComplete="email" required />
              </div>
              <div className="field">
                <label htmlFor="password">Senha</label>
                <input id="password" name="password" type="password" className="input input-premium" placeholder="Sua senha" autoComplete="current-password" required />
              </div>
              <button className="button full button-lg" type="submit">
                Entrar
              </button>
            </form>
          ) : null}

          {mode === "recover" ? (
            <form action={requestPasswordRecoveryAction} className="stack" data-analytics-event="password_recovery_started" data-analytics-label="Password recovery form">
              <input type="hidden" name="mode" value="recover" />
              <input type="hidden" name="next" value={next} />
              <input type="hidden" name="orderId" value={orderId} />
              <div className="field">
                <label htmlFor="recover-email">E-mail</label>
                <input id="recover-email" name="email" type="email" className="input input-premium" placeholder="voce@empresa.com" defaultValue={email} autoComplete="email" required />
              </div>
              <button className="button full button-lg" type="submit">
                Enviar recuperação de senha
              </button>
            </form>
          ) : null}

          {mode === "signup" ? (
            <form action={signUpWithPasswordAction} className="stack" data-analytics-event="signup_started" data-analytics-label="Sign up form">
              <input type="hidden" name="mode" value="signup" />
              <input type="hidden" name="next" value={next} />
              <input type="hidden" name="orderId" value={orderId} />
              <div className="field">
                <label htmlFor="name">Nome completo</label>
                <input id="name" name="name" className="input input-premium" placeholder="Seu nome completo" autoComplete="name" required />
              </div>
              <div className="field">
                <label htmlFor="signup-email">E-mail</label>
                <input id="signup-email" name="email" type="email" className="input input-premium" placeholder="voce@empresa.com" defaultValue={email} autoComplete="email" required />
              </div>
              <div className="field">
                <label htmlFor="signup-password">Senha</label>
                <input id="signup-password" name="password" type="password" className="input input-premium" placeholder="No mínimo 8 caracteres" autoComplete="new-password" minLength={8} required />
              </div>
              <div className="field">
                <label htmlFor="password-confirmation">Confirmação de senha</label>
                <input id="password-confirmation" name="passwordConfirmation" type="password" className="input input-premium" placeholder="Repita a senha" autoComplete="new-password" minLength={8} required />
              </div>
              <button className="button full button-lg" type="submit">
                Criar nova conta
              </button>
            </form>
          ) : null}

          <AuthModeLinks mode={mode} next={next} orderId={orderId} email={email} />

          <div className="tiny">
            A autenticação é feita pelo Neon Auth. Após entrar ou criar a conta, o perfil é sincronizado ao dashboard para manter histórico e pedidos no mesmo fluxo.
          </div>
        </div>
      </section>
    </main>
  );
}
