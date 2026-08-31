"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Users,
  Settings,
  Inbox,
  History,
  ListChecks,
  Wallet,
  HandCoins,
  ClipboardList,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type NavIcon =
  | "dashboard"
  | "leads"
  | "telecallers"
  | "settings"
  | "queue"
  | "history"
  | "earnings"
  | "sales"
  | "report";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** Shorter label for the bottom bar, where width is tight. */
  shortLabel?: string;
}

// Mapped by name rather than passing component references as props: nav items
// are defined in the server-rendered layout, and a function/component cannot
// cross the RSC boundary.
export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  leads: ListChecks,
  telecallers: Users,
  settings: Settings,
  queue: Inbox,
  history: History,
  earnings: Wallet,
  sales: HandCoins,
  report: ClipboardList,
};

function useIsActive() {
  const pathname = usePathname();
  return (href: string) =>
    // Exact match for index routes, prefix match for the rest — otherwise
    // "/admin" would light up on every /admin/* page.
    href === "/admin" || href === "/caller"
      ? pathname === href
      : pathname.startsWith(href);
}

/** Inline nav for the top bar. Hidden on phones in favour of MobileTabBar. */
export function DashboardNav({ items }: { items: NavItem[] }) {
  const isActive = useIsActive();

  return (
    <nav className="hidden items-center gap-1 sm:flex">
      {items.map((item) => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "relative rounded-lg px-3 py-1.5 text-sm transition-colors",
              active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {/* Shared layoutId makes the pill glide between tabs rather than
                cross-fading — the signature nav micro-interaction. */}
            {active && (
              <motion.span
                layoutId="nav-active-pill"
                className="absolute inset-0 rounded-lg border border-border bg-foreground/[0.05]"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            )}
            <span className="relative">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Bottom tab bar for phones.
 *
 * Telecallers work one-handed while dialling, so navigation lives within
 * thumb reach at the bottom rather than in a top bar. It also makes the
 * installed PWA read as a native app rather than a website in a frame.
 * `pb-[env(safe-area-inset-bottom)]` keeps the labels clear of the iOS home
 * indicator.
 */
export function MobileTabBar({ items }: { items: NavItem[] }) {
  const isActive = useIsActive();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      <div className="flex items-stretch justify-around">
        {items.map((item) => {
          const active = isActive(item.href);
          const Icon = NAV_ICONS[item.icon];
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              // min-h-14 keeps every tab at/above the ~44px minimum touch
              // target, which icon+label alone would not guarantee.
              className={cn(
                "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-medium transition-colors",
                active ? "text-[hsl(var(--neon-blue))]" : "text-muted-foreground",
              )}
            >
              {active && (
                <motion.span
                  layoutId="mobile-tab-indicator"
                  className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-[hsl(var(--neon-blue))]"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              <Icon className="h-5 w-5" />
              <span className="leading-none">{item.shortLabel ?? item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
