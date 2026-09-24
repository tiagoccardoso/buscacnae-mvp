import Link from "next/link";
import { signUpWithPasswordAction } from "@/app/sign-in/server-actions";
import { buildPageMetadata } from "@/lib/seo";
import { AuthCard } from "@/components/ui/auth-card";
import { SubmitButton } from "@/components/ui/submit-button";

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
      <div className="container">
        <AuthCard
          title="Criar conta"
          subtitle="Com uma conta você consulta histórico, leads salvos e listas liberadas no dashboard."
          footer={
            <>
              <Link href="/sign-in">Já tenho conta</Link>
              <Link href="/">Voltar para a pesquisa</Link>
            </>
          }
        >
          {error ? <div className="notice danger" role="alert">{error}</div> : null}

          <form action={signUpWithPasswordAction} className="auth-form" data-analytics-event="signup_started" data-analytics-label="Sign up form">
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="orderId" value={orderId} />
            <div className="field">
              <label htmlFor="name">Nome</label>
              <input id="name" name="name" className="input" placeholder="Seu nome" defaultValue={name} autoComplete="name" required />
            </div>
            <div className="field">
              <label htmlFor="email">E-mail</label>
              <input id="email" name="email" type="email" className="input" placeholder="voce@empresa.com" defaultValue={email} autoComplete="email" required />
            </div>
            <div className="field">
              <label htmlFor="password">Senha</label>
              <input id="password" name="password" type="password" className="input" placeholder="Mínimo de 8 caracteres" autoComplete="new-password" minLength={8} aria-describedby="password-help" required />
              <span id="password-help" className="field-help">Use pelo menos 8 caracteres. A senha é salva apenas como hash seguro.</span>
            </div>
            <div className="field">
              <label htmlFor="confirmPassword">Confirmar senha</label>
              <input id="confirmPassword" name="confirmPassword" type="password" className="input" placeholder="Repita a senha" autoComplete="new-password" minLength={8} required />
            </div>
            <SubmitButton pendingLabel="Criando conta...">Criar conta</SubmitButton>
          </form>
        </AuthCard>
      </div>
    </main>
  );
}
