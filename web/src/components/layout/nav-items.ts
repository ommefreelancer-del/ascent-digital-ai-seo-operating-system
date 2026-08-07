import {
  LayoutDashboard,
  MessagesSquare,
  ScanSearch,
  PenSquare,
  KeyRound,
  FolderKanban,
  BarChart3,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "AI Workspace", href: "/workspace", icon: MessagesSquare },
  { label: "SEO Audit", href: "/seo-audit", icon: ScanSearch },
  { label: "Content Generator", href: "/content", icon: PenSquare },
  { label: "Keyword Research", href: "/keywords", icon: KeyRound },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Reports", href: "/reports", icon: BarChart3 },
  { label: "Settings", href: "/settings", icon: Settings },
];
