"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { MotionButton } from "@/components/ui/motion-button";

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    await supabase.auth.signOut();
    router.refresh();
    router.push("/login");
  }

  return (
    <MotionButton variant="ghost" size="sm" onClick={handleSignOut}>
      <LogOut className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Sign out</span>
    </MotionButton>
  );
}
