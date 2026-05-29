// O login/cadastro do projeto foi migrado para autenticação própria com a tabela public.users.
// Este arquivo permanece apenas para evitar imports antigos durante a transição.
export { getCurrentUser, signOut } from "@/lib/auth/server";
