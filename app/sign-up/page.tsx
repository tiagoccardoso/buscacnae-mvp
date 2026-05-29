import Link from "next/link";
import { signUpWithPasswordAction } from "@/app/sign-in/server-actions";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Criar conta",
  description: "Crie uma conta para acessar o dashboard, histórico de buscas e listas liberadas.",
  path: "/sign-up",
  robots: { index: false, follow: false }
});

type SignUpPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const params = searchParams ? await searchParams : {};
  const error = typeof params.error === "string" ? params.error : "";
  const name = typeof params.name === "string" ? params.name : "";
  const email = typeof params.email === "string" ? params.email : "";
  const next = typeof params.next === "string" ? params.next : "/dashboard";
  const orderId = typeof params.order_id === "string" ? params.order_id : "";

  return (
    <main className="page">
      <section className="container auth-grid auth-grid-premium">
        <div className="surface-premium card-lg stack">
          <span className="eyebrow">Nova conta</span>
          <h1 className="display-title" style={{ fontSize: "clamp(2.4rem, 4vw, 4rem)" }}>
            Cadastre-se para acessar o dashboard do BuscaCNAE.
          </h1>
          <p className="lead-copy">Informe seus dados para criar uma conta com e-mail e senha. Depois você poderá consultar histórico, leads salvos e listas liberadas.</p>

          <div className="hero-signal-grid compact-two">
            <div className="signal-card">
              <span className="kicker">Perfil</span>
              <strong>Dados na tabela profiles</strong>
              <span className="muted">O cadastro cria o usuário no Neon Auth e sincroniza os dados operacionais no perfil do sistema.</span>
            </div>
            <div className="signal-card">
              <span className="kicker">Segurança</span>
              <strong>Senha protegida pelo provedor</strong>
              <span className="muted">A senha é gerenciada pelo Neon Auth, sem gravação em texto puro na aplicação.</span>
            </div>
          </div>
        </div>

        <div className="surface-premium card-lg stack auth-form-shell">
          <span className="eyebrow">Cadastro</span>
          <h2 className="section-title" style={{ fontSize: "2rem", marginBottom: 0 }}>
            Criar novo cadastro
          </h2>
          <p className="section-copy">Preencha nome, e-mail, senha e confirmação de senha.</p>

          {error ? <div className="notice danger">{error}</div> : null}

          <form action={signUpWithPasswordAction} className="stack" data-analytics-event="signup_started" data-analytics-label="Sign up form">
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="orderId" value={orderId} />
            <div className="field">
              <label htmlFor="name">Nome</label>
              <input id="name" name="name" className="input input-premium" placeholder="Seu nome" defaultValue={name} autoComplete="name" required />
            </div>
            <div className="field">
              <label htmlFor="email">E-mail</label>
              <input id="email" name="email" type="email" className="input input-premium" placeholder="voce@empresa.com" defaultValue={email} autoComplete="email" required />
            </div>
            <div className="field">
              <label htmlFor="password">Senha</label>
              <input id="password" name="password" type="password" className="input input-premium" placeholder="Mínimo de 8 caracteres" autoComplete="new-password" minLength={8} required />
            </div>
            <div className="field">
              <label htmlFor="confirmPassword">Confirmar senha</label>
              <input id="confirmPassword" name="confirmPassword" type="password" className="input input-premium" placeholder="Repita a senha" autoComplete="new-password" minLength={8} required />
            </div>
            <button className="button full button-lg" type="submit">
              Criar conta
            </button>
          </form>

          <div className="inline-actions" style={{ justifyContent: "space-between" }}>
            <Link href="/sign-in" className="button-ghost">
              Já tenho conta
            </Link>
            <Link href="/" className="button-ghost">
              Voltar para a pesquisa
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
