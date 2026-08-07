import { compare } from "bcryptjs";
import { getServerSession, type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { db } from "@/server/db";
import { getClientIpFromHeaderRecord, rateLimit } from "@/server/rate-limit";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials.password) {
          return null;
        }
        const email = credentials.email.toLowerCase().trim();
        const ip = getClientIpFromHeaderRecord(req?.headers as Record<string, unknown> | undefined);
        if (!rateLimit(`login:${ip}:${email}`, 10, 15 * 60 * 1000)) {
          throw new Error("Too many sign-in attempts. Please wait a few minutes and try again.");
        }
        const user = await db.user.findUnique({ where: { email } });
        if (!user) {
          return null;
        }
        const valid = await compare(credentials.password, user.passwordHash);
        if (!valid) {
          return null;
        }
        return { id: user.id, name: user.name, email: user.email, companyName: user.companyName };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.companyName = (user as { companyName: string | null }).companyName;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.companyName = token.companyName;
      }
      return session;
    },
  },
};

export function getServerAuthSession() {
  return getServerSession(authOptions);
}
