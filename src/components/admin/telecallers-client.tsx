"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Trash2,
  TriangleAlert,
  UserPlus,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { MotionButton } from "@/components/ui/motion-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { springSoft, staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/supabase/database.types";

export interface TelecallerRow {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  assigned_total: number;
  open_total: number;
}

// Unambiguous character set — no 0/O, 1/l/I, so a password read aloud or
// typed off a screenshot doesn't trip on lookalikes.
const PASSWORD_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";

function generatePassword(length = 12): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join("");
}

export function TelecallersClient({
  initial,
  currentUserId,
}: {
  initial: TelecallerRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);

  const activeAdmins = rows.filter((r) => r.role === "admin" && r.is_active).length;

  async function withRow(id: string, fn: () => Promise<string | null>) {
    if (busyRef.current) return;
    busyRef.current = id;
    setBusyId(id);
    setError(null);

    const message = await fn();

    busyRef.current = null;
    setBusyId(null);
    if (message) setError(message);
    else router.refresh();
  }

  function toggleActive(row: TelecallerRow) {
    return withRow(row.id, async () => {
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("admin_set_user_active", {
        p_user_id: row.id,
        p_active: !row.is_active,
      });
      if (rpcError) {
        return rpcError.message.includes("last active admin")
          ? "You cannot deactivate the only active admin — promote someone else first."
          : "Could not update that account. Try again.";
      }
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, is_active: !r.is_active } : r)),
      );
      return null;
    });
  }

  function setRole(row: TelecallerRow, role: UserRole) {
    return withRow(row.id, async () => {
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("admin_set_user_role", {
        p_user_id: row.id,
        p_role: role,
      });
      if (rpcError) return "Could not change that role. Try again.";
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, role } : r)));
      return null;
    });
  }

  function deleteUser(row: TelecallerRow) {
    return withRow(row.id, async () => {
      let payload: { error?: string } = {};
      try {
        const res = await fetch("/api/admin/delete-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: row.id }),
        });
        payload = await res.json();
        if (!res.ok) throw new Error(payload.error ?? "Could not delete that account.");
      } catch (err) {
        return err instanceof Error ? err.message : "Could not delete that account.";
      }
      setConfirmDeleteId(null);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      return null;
    });
  }

  return (
    <motion.div
      variants={staggerContainer(0.07)}
      initial="hidden"
      animate="show"
      className="space-y-5"
    >
      <motion.div
        variants={staggerItem}
        className="flex flex-wrap items-end justify-between gap-3"
      >
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Telecallers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {rows.filter((r) => r.is_active && r.role === "telecaller").length}{" "}
            active · {rows.length} total. Only active telecallers receive
            round-robin assignments.
          </p>
        </div>
      </motion.div>

      <motion.div variants={staggerItem}>
        <CreateUserForm onCreated={() => router.refresh()} />
      </motion.div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={springSoft}
            className="flex items-start gap-2 rounded-lg border border-[hsl(var(--neon-rose)/0.3)] bg-[hsl(var(--neon-rose)/0.1)] p-3 text-sm text-[hsl(var(--neon-rose))]"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Phone layout: one card per account, so role toggles and the
          activate switch stay reachable without sideways scrolling. */}
      <motion.div variants={staggerItem} className="space-y-2 lg:hidden">
        {rows.map((row) => {
          const isSelf = row.id === currentUserId;
          const isLastActiveAdmin =
            row.role === "admin" && row.is_active && activeAdmins <= 1;
          const lastAdmin = row.role === "admin" && activeAdmins <= 1;
          const busy = busyId === row.id;
          const confirming = confirmDeleteId === row.id;

          return (
            <div
              key={row.id}
              className={cn(
                "glass rounded-xl p-4",
                !row.is_active && "opacity-55",
                confirming && "bg-[hsl(var(--neon-rose)/0.05)]",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium tracking-tight">
                    {row.full_name}
                    {isSelf && (
                      <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {row.email}
                  </div>
                </div>
                {busy ? (
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <Switch
                    checked={row.is_active}
                    onCheckedChange={() => toggleActive(row)}
                    label={`${row.is_active ? "Deactivate" : "Activate"} ${row.full_name}`}
                  />
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {(["telecaller", "admin"] as UserRole[]).map((role) => {
                  const selectedRole = row.role === role;
                  const blocked =
                    busy || (lastAdmin && role === "telecaller") || selectedRole;
                  return (
                    <button
                      key={role}
                      type="button"
                      disabled={blocked}
                      onClick={() => setRole(row, role)}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors",
                        selectedRole
                          ? role === "admin"
                            ? "bg-[hsl(var(--neon-violet)/0.16)] text-[hsl(var(--neon-violet))] ring-[hsl(var(--neon-violet)/0.4)]"
                            : "bg-[hsl(var(--neon-blue)/0.16)] text-[hsl(var(--neon-blue))] ring-[hsl(var(--neon-blue)/0.4)]"
                          : "text-muted-foreground ring-white/10",
                        blocked && !selectedRole && "cursor-not-allowed opacity-40",
                      )}
                    >
                      {role === "admin" ? "Admin" : "Telecaller"}
                    </button>
                  );
                })}
                <span className="ml-auto font-mono text-xs text-muted-foreground">
                  {row.open_total}/{row.assigned_total} open
                </span>
              </div>

              <div className="mt-3 border-t border-white/5 pt-3">
                {confirming ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-[hsl(var(--neon-rose))]">
                      Delete permanently?
                    </span>
                    <MotionButton
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() => deleteUser(row)}
                    >
                      {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                      Confirm
                    </MotionButton>
                    <MotionButton
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      Cancel
                    </MotionButton>
                  </div>
                ) : (
                  <MotionButton
                    variant="ghost"
                    size="sm"
                    disabled={isSelf || isLastActiveAdmin || busy}
                    onClick={() => setConfirmDeleteId(row.id)}
                    className="text-muted-foreground"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete account
                  </MotionButton>
                )}
              </div>
            </div>
          );
        })}

        {rows.length === 0 && (
          <div className="glass rounded-2xl px-6 py-16 text-center text-sm text-muted-foreground">
            No accounts yet. Create your first telecaller above.
          </div>
        )}
      </motion.div>

      <motion.div
        variants={staggerItem}
        className="glass hidden overflow-hidden rounded-2xl lg:block"
      >
        <div className="overflow-x-auto scrollbar-slim">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 text-right font-medium">Assigned</th>
                <th className="px-4 py-3 text-right font-medium">Open</th>
                <th className="px-4 py-3 text-center font-medium">Active</th>
                <th className="px-4 py-3 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isSelf = row.id === currentUserId;
                const isLastActiveAdmin = row.role === "admin" && row.is_active && activeAdmins <= 1;
                // Demoting the last active admin would leave is_admin() false
                // for everyone and lock the settings panel permanently. The
                // database guards this for deactivation but NOT for role
                // changes, so the guard has to live here.
                const lastAdmin = row.role === "admin" && activeAdmins <= 1;
                const busy = busyId === row.id;
                const confirming = confirmDeleteId === row.id;

                return (
                  <tr
                    key={row.id}
                    className={cn(
                      "border-b border-white/5 transition-colors last:border-0 hover:bg-white/[0.03]",
                      !row.is_active && "opacity-55",
                      confirming && "bg-[hsl(var(--neon-rose)/0.05)]",
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium tracking-tight">
                        {row.full_name}
                        {isSelf && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (you)
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{row.email}</div>
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {(["telecaller", "admin"] as UserRole[]).map((role) => {
                          const selected = row.role === role;
                          const blocked =
                            busy || (lastAdmin && role === "telecaller") || selected;
                          return (
                            <button
                              key={role}
                              type="button"
                              disabled={blocked}
                              onClick={() => setRole(row, role)}
                              title={
                                lastAdmin && role === "telecaller"
                                  ? "Promote another admin before demoting the last one"
                                  : undefined
                              }
                              className={cn(
                                "rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 transition-colors",
                                selected
                                  ? role === "admin"
                                    ? "bg-[hsl(var(--neon-violet)/0.16)] text-[hsl(var(--neon-violet))] ring-[hsl(var(--neon-violet)/0.4)]"
                                    : "bg-[hsl(var(--neon-blue)/0.16)] text-[hsl(var(--neon-blue))] ring-[hsl(var(--neon-blue)/0.4)]"
                                  : "text-muted-foreground ring-white/10 hover:bg-white/5 hover:text-foreground",
                                blocked && !selected && "cursor-not-allowed opacity-40",
                              )}
                            >
                              {role === "admin" ? "Admin" : "Telecaller"}
                            </button>
                          );
                        })}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {row.assigned_total}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {row.open_total > 0 ? (
                        row.open_total
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex justify-center">
                        {busy ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : (
                          <Switch
                            checked={row.is_active}
                            onCheckedChange={() => toggleActive(row)}
                            label={`${row.is_active ? "Deactivate" : "Activate"} ${row.full_name}`}
                          />
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-right">
                      <AnimatePresence mode="wait" initial={false}>
                        {confirming ? (
                          <motion.div
                            key="confirm"
                            initial={{ opacity: 0, x: 8 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0 }}
                            transition={springSoft}
                            className="flex items-center justify-end gap-1.5 whitespace-nowrap"
                          >
                            <span className="text-xs text-[hsl(var(--neon-rose))]">
                              Delete permanently?
                            </span>
                            <MotionButton
                              variant="destructive"
                              size="sm"
                              disabled={busy}
                              onClick={() => deleteUser(row)}
                            >
                              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                              Confirm
                            </MotionButton>
                            <MotionButton
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              Cancel
                            </MotionButton>
                          </motion.div>
                        ) : (
                          <motion.div key="trigger" initial={false}>
                            <button
                              type="button"
                              disabled={isSelf || isLastActiveAdmin || busy}
                              onClick={() => setConfirmDeleteId(row.id)}
                              title={
                                isSelf
                                  ? "You cannot delete your own account"
                                  : isLastActiveAdmin
                                    ? "Promote another admin before deleting the last one"
                                    : "Delete account"
                              }
                              className={cn(
                                "rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-[hsl(var(--neon-rose)/0.12)] hover:text-[hsl(var(--neon-rose))]",
                                (isSelf || isLastActiveAdmin) &&
                                  "cursor-not-allowed opacity-30 hover:bg-transparent hover:text-muted-foreground",
                              )}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {rows.length === 0 && (
          <p className="px-6 py-16 text-center text-sm text-muted-foreground">
            No accounts yet. Create your first telecaller above.
          </p>
        )}
      </motion.div>

      <motion.p variants={staggerItem} className="text-xs text-muted-foreground">
        Deactivating keeps every past call and audit entry intact — it only
        removes the account from round-robin distribution and blocks sign-in.
        Deleting is permanent: the login is gone for good, though past calls
        and audit history stay attached to the lead, credited to &ldquo;a
        deleted user&rdquo; rather than disappearing. Leads already assigned
        to a deleted account stay assigned; reassign them from the Leads
        screen.
      </motion.p>
    </motion.div>
  );
}

function CreateUserForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState(() => generatePassword());
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);

    let payload: { error?: string; email?: string } = {};
    try {
      const res = await fetch("/api/admin/create-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, full_name: fullName, password }),
      });
      payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Could not create that account.");
    } catch (err) {
      inFlight.current = false;
      setSaving(false);
      setError(err instanceof Error ? err.message : "Could not create that account.");
      return;
    }

    inFlight.current = false;
    setSaving(false);
    // Held onto so the admin has time to copy it — this is the only moment
    // the plaintext password exists anywhere outside their own head; Supabase
    // never stores or returns it again after this response.
    setCreated({ email: payload.email ?? email, password });
    setEmail("");
    setFullName("");
    setPassword(generatePassword());
    setShowPassword(false);
    onCreated();
  }

  async function copyCredentials() {
    if (!created) return;
    await navigator.clipboard.writeText(`Email: ${created.email}\nPassword: ${created.password}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!open && !created) {
    return (
      <MotionButton onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" />
        Create telecaller
      </MotionButton>
    );
  }

  if (created) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springSoft}
        className="glass space-y-3 rounded-2xl border border-[hsl(var(--neon-emerald)/0.25)] p-5"
      >
        <div className="flex items-center gap-2">
          <Check className="h-4 w-4 text-[hsl(var(--neon-emerald))]" />
          <h2 className="font-medium tracking-tight">Account created</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Send these to {created.email.split("@")[0]} yourself — nothing was
          emailed. This password won&apos;t be shown again after you leave this
          screen.
        </p>
        <div className="space-y-1 rounded-lg border border-white/10 bg-white/[0.03] p-3 font-mono text-sm">
          <div>
            <span className="text-muted-foreground">Email: </span>
            {created.email}
          </div>
          <div>
            <span className="text-muted-foreground">Password: </span>
            {created.password}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <MotionButton variant="glass" size="sm" onClick={copyCredentials}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy credentials"}
          </MotionButton>
          <MotionButton
            variant="ghost"
            size="sm"
            onClick={() => {
              setCreated(null);
              setOpen(false);
            }}
          >
            Done
          </MotionButton>
          <MotionButton
            variant="ghost"
            size="sm"
            onClick={() => {
              setCreated(null);
              setOpen(true);
            }}
          >
            Create another
          </MotionButton>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.form
      onSubmit={submit}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springSoft}
      className="glass space-y-4 rounded-2xl p-5"
    >
      <div className="flex items-center gap-2">
        <UserPlus className="h-4 w-4 text-[hsl(var(--neon-blue))]" />
        <h2 className="font-medium tracking-tight">Create a telecaller account</h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="create-name" className="text-xs uppercase tracking-wider text-muted-foreground">
            Full name
          </Label>
          <Input
            id="create-name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Priya Nair"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="create-email" className="text-xs uppercase tracking-wider text-muted-foreground">
            Email
          </Label>
          <Input
            id="create-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="priya@fenlark.in"
          />
          <p className="text-xs text-muted-foreground">
            Used as their username — no email is actually sent.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="create-password" className="text-xs uppercase tracking-wider text-muted-foreground">
          Password
        </Label>
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <Input
              id="create-password"
              type={showPassword ? "text" : "password"}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pr-9 font-mono"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <MotionButton
            type="button"
            variant="glass"
            size="icon"
            onClick={() => {
              setPassword(generatePassword());
              setShowPassword(true);
            }}
            aria-label="Generate a new password"
            title="Generate a new password"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </MotionButton>
        </div>
        <p className="text-xs text-muted-foreground">
          A random password is pre-filled — edit it or generate a new one, then
          share it with the telecaller yourself.
        </p>
      </div>

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={springSoft}
            className="flex items-start gap-2 rounded-lg border border-[hsl(var(--neon-rose)/0.3)] bg-[hsl(var(--neon-rose)/0.1)] p-3 text-sm text-[hsl(var(--neon-rose))]"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </motion.p>
        )}
      </AnimatePresence>

      <p className="text-xs text-muted-foreground">
        New accounts always start as telecallers — promote to admin from the
        table below.
      </p>

      <div className="flex items-center gap-2">
        <MotionButton type="submit" disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saving ? "Creating…" : "Create account"}
        </MotionButton>
        <MotionButton
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancel
        </MotionButton>
      </div>
    </motion.form>
  );
}
