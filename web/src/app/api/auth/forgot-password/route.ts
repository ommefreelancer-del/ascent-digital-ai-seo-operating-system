import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { forgotPasswordSchema } from "@/lib/validators";
import { sendPasswordResetEmail } from "@/server/mailer";
import { getClientIp, rateLimit } from "@/server/rate-limit";

const TOKEN_TTL_MS = 60 * 60 * 1000;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!rateLimit(`forgot:ip:${ip}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase().trim();

  // Always report success, whether or not the account exists, and whether or
  // not this specific email is being rate-limited below -- this never
  // reveals which emails have accounts (a real security boundary, not a
  // corner cut).
  if (rateLimit(`forgot:email:${email}`, 3, 60 * 60 * 1000)) {
    const user = await db.user.findUnique({ where: { email } });
    if (user) {
      // Invalidate any previously issued, still-unused tokens so only the
      // newest reset link is ever valid.
      await db.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      const token = randomBytes(32).toString("hex");
      await db.passwordResetToken.create({
        data: { token, userId: user.id, expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
      });
      const resetUrl = `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/reset-password?token=${token}`;
      await sendPasswordResetEmail(email, resetUrl);
    }
  }

  return NextResponse.json({ ok: true });
}
