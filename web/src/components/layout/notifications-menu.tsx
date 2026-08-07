"use client";

import * as React from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatRelativeTime, truncate } from "@/lib/utils";

interface ActivityItem {
  id: string;
  category: string;
  message: string;
  createdAt: string;
}

export function NotificationsMenu() {
  const [items, setItems] = React.useState<ActivityItem[]>([]);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/activity?limit=6")
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((data) => {
        if (!cancelled) setItems(data.items ?? []);
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-4 w-4" />
          {items.length > 0 ? <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" /> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Recent activity</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {!loaded ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">Loading...</p>
        ) : items.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">No activity yet. Run a workflow to see it here.</p>
        ) : (
          items.map((item) => (
            <DropdownMenuItem key={item.id} className="flex-col items-start gap-0.5">
              <span className="text-sm">{truncate(item.message, 80)}</span>
              <span className="text-[11px] text-muted-foreground">{formatRelativeTime(item.createdAt)}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
