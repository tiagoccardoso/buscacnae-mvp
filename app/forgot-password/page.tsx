import Link from "next/link";
import { requestPasswordResetAction } from "@/app/sign-in/server-actions";
import { buildPageMetadata } from "@/lib/seo";
import { AuthCard } from "@/components/ui/auth-card";
import { SubmitButton } from "@/components/ui/submit-button";

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
      <div className="container">
        <AuthCard
          title="Recuperar acesso"
          subtitle="Informe o e-mail cadastrado para receber as instruções de redefinição de senha."
          footer={
            <>
              <Link href="/sign-in">Voltar ao login</Link>
              <Link href="/sign-up">Criar conta</Link>
            </>
          }
        >
          {message ? <div className="notice success" role="status">{message}</div> : null}
          {error ? <div className="notice danger" role="alert">{error}</div> : null}

          <form action={requestPasswordResetAction} className="auth-form">
            <div className="field">
              <label htmlFor="email">E-mail</label>
              <input id="email" name="email" type="email" className="input" placeholder="voce@empresa.com" defaultValue={email} autoComplete="email" aria-describedby="forgot-help" required />
              <span id="forgot-help" className="field-help">Por segurança, a mensagem será a mesma mesmo que o e-mail não esteja cadastrado.</span>
            </div>
            <SubmitButton pendingLabel="Enviando...">Recuperar senha</SubmitButton>
          </form>
        </AuthCard>
      </div>
    </main>
  );
}
