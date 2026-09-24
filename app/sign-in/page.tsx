import Link from "next/link";
import { signInWithPasswordAction } from "./server-actions";
import { buildPageMetadata } from "@/lib/seo";
import { AuthCard } from "@/components/ui/auth-card";
import { SubmitButton } from "@/components/ui/submit-button";

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
      <div className="container">
        <AuthCard
          title="Entrar no BuscaCNAE"
          subtitle="Use o mesmo e-mail da compra para manter histórico, checkout e listas liberadas no mesmo lugar."
          footer={
            <>
              <Link href={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ""}`}>Esqueci minha senha</Link>
              <Link href={signUpHref}>Criar conta</Link>
              <Link href="/onboarding">Ver como funciona</Link>
            </>
          }
        >
          {message ? <div className="notice success" role="status">{message}</div> : null}
          {error ? <div className="notice danger" role="alert">{error}</div> : null}

          <form action={signInWithPasswordAction} className="auth-form" data-analytics-event="login_started" data-analytics-label="Sign in form">
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="orderId" value={orderId} />
            <div className="field">
              <label htmlFor="email">E-mail</label>
              <input id="email" name="email" type="email" className="input" placeholder="voce@empresa.com" defaultValue={email} autoComplete="email" required />
            </div>
            <div className="field">
              <label htmlFor="password">Senha</label>
              <input id="password" name="password" type="password" className="input" placeholder="Sua senha" autoComplete="current-password" required />
            </div>
            <SubmitButton pendingLabel="Entrando...">Entrar</SubmitButton>
          </form>

          <p className="footnote auth-note">
            Sessão protegida por cookie seguro e senha criptografada. A pesquisa continua pública:{" "}
            <Link href="/" className="text-link">voltar para a pesquisa</Link>.
          </p>
        </AuthCard>
      </div>
    </main>
  );
}
