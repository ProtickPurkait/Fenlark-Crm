// ============================================================================
// Repeatable security probe against a LIVE Supabase project.
//
//   node scripts/security-probe.mjs                  # read-only checks
//   node scripts/security-probe.mjs --write-probe    # + attempt the C-1 bypass
//
// Read-only mode asserts that `anon` cannot reach any table, view, or
// privileged RPC. --write-probe additionally signs in as a telecaller and
// tries to write straight to public.leads, which is the exploit migration
// 1000 closed: before it, a telecaller could skip log_call_interaction's
// remark requirement and future-date check entirely.
//
// The write probe needs a telecaller login. Supply it via env:
//   PROBE_EMAIL=... PROBE_PASSWORD=... node scripts/security-probe.mjs --write-probe
//
// It only ever writes to the lead it is already allowed to see, and restores
// the original status through the proper RPC afterwards. Run it against
// staging, or accept that it appends rows to the audit trail (by design —
// the trail is append-only, so a probe cannot hide itself).
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const env = Object.fromEntries(
  readFileSync(path.join(ROOT, ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const writeProbe = process.argv.includes("--write-probe");

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

let failures = 0;
function check(label, passed, detail) {
  if (!passed) failures++;
  console.log(`  ${passed ? green("PASS") : red("FAIL")}  ${label}`);
  if (detail) console.log(`        ${dim(detail)}`);
}

const anon = createClient(URL_, ANON);

console.log(`\nProbing ${new URL(URL_).hostname}\n`);
console.log("anon (no session) — every object must be denied");

const OBJECTS = [
  "leads",
  "users",
  "lead_history_logs",
  "system_settings",
  "lead_queue",
  "telecaller_directory",
  "app_settings",
];
for (const obj of OBJECTS) {
  const { data, error } = await anon.from(obj).select("*").limit(1);
  check(
    `anon cannot read ${obj}`,
    Boolean(error),
    error ? `${error.code}: ${error.message.slice(0, 60)}` : `!! returned ${data?.length} row(s)`,
  );
}

console.log("\nanon — privileged RPCs must be unreachable");
for (const fn of ["recycle_stale_leads", "admin_run_recycle_now", "admin_dashboard_summary", "sla_hours"]) {
  const { error } = await anon.rpc(fn, {});
  // 42501 = insufficient_privilege (grant or internal check). PGRST202 =
  // not exposed in the schema cache at all. Either is a pass.
  const ok = Boolean(error) && (error.code === "42501" || error.code === "PGRST202");
  check(`anon cannot execute ${fn}()`, ok, error ? `${error.code}: ${error.message.slice(0, 60)}` : "!! executed");
}

if (!writeProbe) {
  console.log(`\n${failures === 0 ? green("All read-only checks passed.") : red(`${failures} check(s) failed.`)}`);
  console.log(dim("Re-run with --write-probe to test the C-1 direct-write bypass.\n"));
  process.exit(failures === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Write probe — requires a telecaller login.
// ---------------------------------------------------------------------------
const email = process.env.PROBE_EMAIL;
const password = process.env.PROBE_PASSWORD;
if (!email || !password) {
  console.log(red("\n--write-probe needs PROBE_EMAIL and PROBE_PASSWORD in the environment.\n"));
  process.exit(1);
}

const caller = createClient(URL_, ANON);
const { data: session, error: signInErr } = await caller.auth.signInWithPassword({ email, password });
if (signInErr) {
  console.log(red(`\nSign-in failed: ${signInErr.message}\n`));
  process.exit(1);
}

console.log(`\nauthenticated telecaller (${session.user.email}) — direct writes must be denied`);

const { data: myLeads } = await caller.from("leads").select("id, status, full_name").limit(1);
if (!myLeads?.length) {
  console.log(dim("  (no leads assigned to this account — nothing to probe)"));
} else {
  const target = myLeads[0];

  const { error: e1 } = await caller
    .from("leads")
    .update({ status: "converted" })
    .eq("id", target.id);
  check(
    "cannot set status by direct table write",
    Boolean(e1),
    e1 ? `${e1.code}: ${e1.message.slice(0, 60)}` : "!! ALLOWED — RPC validation bypassed",
  );

  const { error: e2 } = await caller
    .from("leads")
    .update({ scheduled_at: "2099-01-01T00:00:00Z" })
    .eq("id", target.id);
  check(
    "cannot move own follow-up date to hide an overdue lead",
    Boolean(e2),
    e2 ? `${e2.code}: ${e2.message.slice(0, 60)}` : "!! ALLOWED — overdue counter is gameable",
  );

  const { error: e3 } = await caller
    .from("leads")
    .insert({ full_name: "Probe", phone: "9700000009" });
  check(
    "cannot insert leads",
    Boolean(e3),
    e3 ? `${e3.code}: ${e3.message.slice(0, 60)}` : "!! ALLOWED",
  );

  // The legitimate path must still work.
  const { error: rpcErr } = await caller.rpc("log_call_interaction", {
    p_lead_id: target.id,
    p_status: target.status,
    p_remark: "[security probe] verifying the RPC path still works",
    p_scheduled_at: null,
  });
  check("log_call_interaction still works for the owner", !rpcErr, rpcErr?.message?.slice(0, 70));
}

console.log("\nsettings lockdown");
const { data: full } = await caller.from("system_settings").select("*");
check("telecaller sees no rows in system_settings", (full?.length ?? 0) === 0);

const { data: appSettings, error: appErr } = await caller.from("app_settings").select("*").single();
check(
  "telecaller can still read app_settings (WhatsApp template)",
  !appErr && Boolean(appSettings?.whatsapp_template),
  appErr?.message?.slice(0, 70),
);

const { data: queue } = await caller.from("lead_queue").select("id, status, sla_hours_remaining");
const newLead = (queue ?? []).find((l) => l.status === "new");
check(
  "SLA countdown still resolves after the settings lockdown",
  !newLead || newLead.sla_hours_remaining !== null,
  newLead ? `sla_hours_remaining = ${newLead.sla_hours_remaining}` : "(no 'new' lead to check)",
);

console.log("\nprivileged RPCs as telecaller");
for (const fn of ["recycle_stale_leads", "admin_run_recycle_now", "admin_dashboard_summary"]) {
  const { error } = await caller.rpc(fn, {});
  check(`telecaller cannot execute ${fn}()`, Boolean(error), error?.message?.slice(0, 60));
}

await caller.auth.signOut();

console.log(`\n${failures === 0 ? green("All checks passed.") : red(`${failures} check(s) failed.`)}\n`);
process.exit(failures === 0 ? 0 : 1);
