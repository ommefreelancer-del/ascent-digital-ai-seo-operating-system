import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { NotificationsMenu } from "./notifications-menu";
import { MobileNav } from "./mobile-nav";

export function Topbar({ title }: { title?: string }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 lg:px-6">
      <MobileNav />
      {title ? <h1 className="truncate text-sm font-semibold lg:text-base">{title}</h1> : <div />}
      <div className="ml-auto flex items-center gap-1.5">
        <Button asChild size="sm" variant="outline" className="hidden sm:inline-flex">
          <Link href="/workspace">
            <Plus className="h-3.5 w-3.5" /> New task
          </Link>
        </Button>
        <NotificationsMenu />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
