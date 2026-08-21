"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/logo";
import { NAV_ICONS, type NavItem } from "@/components/shared/dashboard-nav";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/**
 * Desk-side nav for admins: a fixed dark rail, the one place the otherwise
 * light product stays dark. Telecallers keep the shared top bar + bottom tab
 * bar (see (dashboard)/layout.tsx) — the rail is specifically an admin
 * pattern, so it's a separate component rather than a dark-mode branch
 * bolted onto DashboardNav.
 *
 * Hidden below `md:`; admin on a phone falls back to the same top
 * bar + MobileTabBar telecallers use (rendered by the parent layout).
 */
export function AdminSidebar({
  items,
  displayName,
}: {
  items: NavItem[];
  displayName: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    await supabase.auth.signOut();
    router.refresh();
    router.push("/login");
  }

  return (
    <aside
      className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col bg-[hsl(var(--rail))] px-3 py-4 pb-[env(safe-area-inset-bottom)] pt-[calc(1rem+env(safe-area-inset-top))] md:flex"
      style={{ colorScheme: "dark" }}
    >
      <Logo
        className="px-2 pb-5 text-[hsl(var(--rail-foreground))]"
        wordClassName="text-[hsl(var(--rail-foreground))]"
      />

      <nav className="flex flex-1 flex-col gap-0.5">
        {items.map((item) => {
          const active =
            item.href === "/admin"
              ? pathname === item.href
              : pathname.startsWith(item.href);
          const Icon = NAV_ICONS[item.icon];
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                active
                  ? "text-[hsl(var(--rail-foreground))]"
                  : "text-[hsl(var(--rail-muted))] hover:text-[hsl(var(--rail-foreground))]",
              )}
            >
              {active && (
                <motion.span
                  layoutId="admin-rail-active"
                  className="absolute inset-0 rounded-lg bg-[hsl(var(--rail-active))]"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              <Icon className="relative h-4 w-4 shrink-0" />
              <span className="relative">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-2.5 border-t border-white/10 px-2.5 pt-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-[11px] font-semibold text-[hsl(var(--primary-foreground))]">
          {initials(displayName)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-[hsl(var(--rail-foreground))]">
            {displayName}
          </div>
          <div className="text-[10.5px] text-[hsl(var(--rail-muted))]">Admin</div>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          aria-label="Sign out"
          className="shrink-0 rounded-md p-1.5 text-[hsl(var(--rail-muted))] transition-colors hover:text-[hsl(var(--rail-foreground))]"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
    </aside>
  );
}
