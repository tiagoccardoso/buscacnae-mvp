import { auth } from "@/lib/auth/neon";

export default auth.middleware({
  loginUrl: "/sign-in"
});

export const config = {
  matcher: ["/dashboard/:path*"]
};
