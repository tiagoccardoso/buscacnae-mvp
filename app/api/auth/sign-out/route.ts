import { NextResponse } from "next/server";
import { signOut } from "@/lib/auth/server";

export async function POST() {
  await signOut();

  return NextResponse.json({ ok: true });
}
