import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/shared/sign-out-button";
import { RejectionBell } from "@/components/caller/rejection-bell";
import {
  DashboardNav,
  MobileTabBar,
  type NavItem,
} from "@/components/shared/dashboard-nav";
import { Logo } from "@/components/brand/logo";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { AdminSidebar } from "@/components/admin/admin-sidebar";

const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: "dashboard", shortLabel: "Home" },
  { href: "/admin/leads", label: "Leads", icon: "leads" },
  {
    href: "/admin/telecallers",
    label: "Telecallers",
    icon: "telecallers",
    shortLabel: "Callers",
  },
  { href: "/admin/sales", label: "Sales", icon: "sales" },
  { href: "/admin/settings", label: "Settings", icon: "settings" },
];

const CALLER_NAV: NavItem[] = [
  { href: "/caller", label: "My Queue", icon: "queue", shortLabel: "Queue" },
  { href: "/caller/history", label: "History", icon: "history" },
  { href: "/caller/earnings", label: "Earnings", icon: "earnings" },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Fast path: middleware.ts already ran getUser() and a profile query for
  // this exact request and forwarded the result via headers — reading them
  // here avoids repeating both network round trips on every navigation
  // between dashboard pages. See middleware.ts for why these can be trusted:
  // it always overwrites them after its own check, so a client cannot forge
  // its way in by sending the same header names.
  const hdrs = await headers();
  const headerUserId = hdrs.get("x-user-id");
  const headerRole = hdrs.get("x-user-role");

  let displayName: string;
  let isAdmin: boolean;

  if (headerUserId && headerRole) {
    displayName = decodeURIComponent(hdrs.get("x-user-full-name") ?? "");
    isAdmin = headerRole === "admin";
  } else {
    // Belt-and-suspenders: this only runs if middleware is ever bypassed
    // (e.g. a future route added outside its matcher), so paying for a full
    // getUser() + profile query here is the correct trade-off — it should
    // essentially never execute in normal operation.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/login");

    const { data: profile } = await supabase
      .from("users")
      .select("full_name, role")
      .eq("id", user.id)
      .single();

    displayName = profile?.full_name ?? user.email ?? "";
    isAdmin = profile?.role === "admin";
  }

  const navItems = isAdmin ? ADMIN_NAV : CALLER_NAV;

  return (
    <div className="min-h-svh">
      {isAdmin && <AdminSidebar items={navItems} displayName={displayName} />}

      {/* Sticky header. Admins get it only below `md:` — the rail carries
          the logo/name/sign-out from there up, so a second copy in a top bar
          would be redundant on desktop. Telecallers always see it; they
          never get a sidebar. pt-[env(safe-area-inset-top)] keeps it clear
          of the notch when the installed PWA runs full-screen. */}
      <header
        className={cn(
          "sticky top-0 z-40 border-b border-border bg-card pt-[env(safe-area-inset-top)]",
          isAdmin && "md:hidden",
        )}
      >
        <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-6">
            <Logo className="shrink-0 text-sm" />
            {!isAdmin && <DashboardNav items={navItems} />}
          </div>

          <div className="flex min-w-0 shrink items-center gap-2 sm:gap-3">
            <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
              <span className="truncate">{displayName}</span>
              {isAdmin && (
                <span className="shrink-0 rounded-full bg-[hsl(var(--neon-violet)/0.14)] px-2 py-0.5 text-xs font-medium text-[hsl(var(--neon-violet))] ring-1 ring-[hsl(var(--neon-violet)/0.35)]">
                  Admin
                </span>
              )}
            </span>
            {!isAdmin && <RejectionBell />}
            <SignOutButton />
          </div>
        </div>
      </header>

      {/* pb-20 on mobile clears the fixed bottom tab bar; sm: drops it since
          the tab bar is hidden from that breakpoint up. Admin content clears
          the fixed rail from md: up. */}
      <main
        className={cn(
          "mx-auto max-w-7xl p-4 pb-20 sm:p-6 sm:pb-6",
          isAdmin && "md:pl-56",
        )}
      >
        {children}
      </main>

      <MobileTabBar items={navItems} />
      <InstallPrompt />
    </div>
  );
}
