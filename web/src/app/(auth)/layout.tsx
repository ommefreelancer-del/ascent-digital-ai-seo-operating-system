import Link from "next/link";
import { Sparkles } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-primary p-12 text-primary-foreground lg:flex">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.08),transparent_45%),radial-gradient(circle_at_80%_80%,rgba(255,255,255,0.06),transparent_45%)]" />
        <Link href="/" className="relative z-10 flex items-center gap-2 text-lg font-semibold">
          <Sparkles className="h-5 w-5" />
          ADASOS
        </Link>
        <div className="relative z-10 max-w-md space-y-4">
          <p className="text-2xl font-medium leading-snug">
            One operating system for SEO strategy, content, outreach, and client operations -- orchestrated by AI, approved by you.
          </p>
          <p className="text-sm text-primary-foreground/70">
            27 specialist agents. One Boss Agent. Real audit trails on every decision.
          </p>
        </div>
        <p className="relative z-10 text-xs text-primary-foreground/50">© {new Date().getFullYear()} Ascent Digital. All rights reserved.</p>
      </div>
      <div className="flex w-full flex-1 items-center justify-center bg-background px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
