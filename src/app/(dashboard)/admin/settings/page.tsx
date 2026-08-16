import { createClient } from "@/lib/supabase/server";
import { SettingsClient } from "@/components/admin/settings-client";

export const metadata = { title: "Settings" };

export default async function AdminSettingsPage() {
  const supabase = await createClient();

  // The full row, not app_settings — this page is admin-only and needs the
  // fields the telecaller view deliberately hides.
  const { data: settings } = await supabase
    .from("system_settings")
    .select("*")
    .single();

  if (!settings) {
    // RLS returns an empty set rather than an error for a non-admin, so a
    // missing row here means either "not an admin" (middleware should have
    // caught it) or the seed migration never ran.
    return (
      <div className="glass max-w-3xl rounded-2xl px-6 py-16 text-center">
        <p className="text-sm font-medium">Settings unavailable</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
          The system_settings row could not be read. Confirm the seed migration
          ran and that this account still has the admin role.
        </p>
      </div>
    );
  }

  let updatedByName: string | null = null;
  if (settings.updated_by) {
    const { data: actor } = await supabase
      .from("telecaller_directory")
      .select("full_name")
      .eq("id", settings.updated_by)
      .single();
    updatedByName = actor?.full_name ?? null;
  }

  return <SettingsClient initial={settings} updatedByName={updatedByName} />;
}
