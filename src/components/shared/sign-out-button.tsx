"use client";

import { LogOut } from "lucide-react";
import { MotionButton } from "@/components/ui/motion-button";

export function SignOutButton() {
  async function handleSignOut() {
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    await supabase.auth.signOut();
    // A hard navigation, not router.push(): the client router cache (see
    // staleTimes in next.config.ts) is keyed by URL alone, not by session, so
    // a soft navigation back to /login can still serve another account's
    // cached /admin or /caller payload on the next sign-in within that
    // window. A full page load bypasses that cache entirely.
    window.location.assign("/login");
  }

  return (
    <MotionButton variant="ghost" size="sm" onClick={handleSignOut}>
      <LogOut className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Sign out</span>
    </MotionButton>
  );
}
