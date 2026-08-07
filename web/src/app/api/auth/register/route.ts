import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { registerSchema } from "@/lib/validators";
import { getClientIp, rateLimit } from "@/server/rate-limit";

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!rateLimit(`register:${ip}`, 8, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
  }

  const passwordHash = await hash(parsed.data.password, 12);
  const user = await db.user.create({
    data: {
      name: parsed.data.name,
      email,
      passwordHash,
      companyName: parsed.data.companyName || null,
    },
  });

  await db.activityEvent.create({
    data: { userId: user.id, category: "account", message: "Account created." },
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
