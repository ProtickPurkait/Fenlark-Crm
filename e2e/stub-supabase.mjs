// ============================================================================
// A stand-in Supabase for the end-to-end tests.
// ============================================================================
// Speaks just enough GoTrue and PostgREST for the pages under test, backed by
// fixtures rather than a database.
//
// WHY FIXTURES AND NOT A REAL POSTGRES: the SQL is already covered, thoroughly
// and cheaply, by the 154 PGlite assertions in supabase/tests/smoke.sql. What
// nothing covered was the wiring — whether a page that queries correctly
// actually renders rows. /caller shipped twice in a state where the query was
// malformed and the page rendered an empty queue with no error anywhere. That
// is what this layer exists to catch, so it holds request shape to account and
// leaves SQL semantics to the suite that already tests them.
//
// It is deliberately strict. A request it does not recognise, or a Range
// header that is not two integers, fails loudly instead of quietly returning
// nothing — the quiet return is the bug.
import { createServer } from "node:http";

const PORT = Number(process.env.STUB_PORT ?? 54329);

// --- fixtures -------------------------------------------------------------
const TOTAL_LEADS = 1006;

const BUCKETS = ["overdue", "due_soon", "due_today", "scheduled", "unscheduled"];
const STATUSES = ["new", "attempted", "connected", "warm", "rescheduled"];

const ALL_LEADS = Array.from({ length: TOTAL_LEADS }, (_, i) => ({
  id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
  full_name: `Lead ${i + 1}`,
  phone: `98${String(10000000 + i)}`,
  email: null,
  city: "Kolkata",
  company: null,
  business_type: i % 3 === 0 ? "Cafe" : "Interior Decor",
  address: null,
  status: STATUSES[i % STATUSES.length],
  assigned_to: "00000000-0000-0000-0000-0000000000c1",
  assigned_at: new Date().toISOString(),
  scheduled_at: null,
  last_contacted_at: null,
  last_remark: null,
  sla_revoked_count: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  deleted_at: null,
  notes: null,
  source: "manual",
  source_meta: {},
  created_by: null,
  phone_normalized: `98${String(10000000 + i)}`,
  follow_up_bucket: BUCKETS[i % BUCKETS.length],
  queue_rank: 10 + (i % 5) * 10,
  sla_hours_remaining: null,
}));

const USER = {
  id: "00000000-0000-0000-0000-0000000000c1",
  aud: "authenticated",
  role: "authenticated",
  email: "caller@fenlark.test",
  user_metadata: { full_name: "Bina Caller" },
  app_metadata: {},
  created_at: new Date().toISOString(),
};

const SESSION = {
  access_token: "stub-access-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: "stub-refresh-token",
  user: USER,
};

/** Requests the stub could not answer. The tests assert this stays empty, so
 *  an unhandled call surfaces as a failure rather than an empty page. */
export const problems = [];

// --- PostgREST-ish --------------------------------------------------------
/** postgrest-js encodes .range(from, to) as ?offset=<from>&limit=<to-from+1>,
 *  NOT as a Range header — confirmed against the installed client rather than
 *  assumed. That matters here because the malformed case this suite exists to
 *  catch reaches the wire as `limit=NaN`, so that is what has to be rejected. */
function parsePaging(url) {
  const rawOffset = url.searchParams.get("offset");
  const rawLimit = url.searchParams.get("limit");
  if (rawLimit === null && rawOffset === null) return { from: 0, count: null };

  const from = rawOffset === null ? 0 : Number(rawOffset);
  const count = rawLimit === null ? null : Number(rawLimit);
  const ok =
    Number.isInteger(from) && from >= 0 &&
    (count === null || (Number.isInteger(count) && count > 0));
  if (!ok) return { bad: `offset=${rawOffset} limit=${rawLimit}` };
  return { from, count };
}

function filterLeads(url) {
  let rows = ALL_LEADS;
  const status = url.searchParams.get("status");
  if (status?.startsWith("eq.")) {
    rows = rows.filter((r) => r.status === status.slice(3));
  }
  const bucket = url.searchParams.get("follow_up_bucket");
  if (bucket?.startsWith("in.")) {
    const wanted = bucket.slice(3).replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/"/g, ""));
    rows = rows.filter((r) => wanted.includes(r.follow_up_bucket));
  }
  return rows;
}

const RPCS = {
  my_dashboard_stats: () => [
    { calls_made_today: 2, followups_pending: 2, followups_overdue: 0, assigned_total: TOTAL_LEADS, untouched_new: 200 },
  ],
  my_current_attendance: () => [],
  admin_lead_categories: () => [
    { business_type: "Cafe", lead_count: 336, unassigned_count: 100 },
    { business_type: "Interior Decor", lead_count: 670, unassigned_count: 250 },
  ],
  admin_telecaller_activity: () => [],
};

const TABLES = {
  app_settings: () => [
    {
      whatsapp_template: "Hello {{name}}, this is {{agent}}.",
      report_timezone: "Asia/Kolkata",
      admin_whatsapp_number: "9811100001",
      daily_report_template: "Daily Report — {{date}}\n{{warm}}",
    },
  ],
  users: () => [{ full_name: "Bina Caller", role: "telecaller", is_active: true }],
  sales: () => [],
  attendance: () => [],
};

/** PostgREST returns a bare object, not a one-element array, when the client
 *  asks for one with .single()/.maybeSingle() — supabase-js signals that with
 *  an Accept of application/vnd.pgrst.object+json. Returning the array anyway
 *  is silently wrong: middleware read `profile.is_active` off an array, got
 *  undefined, and bounced every login as a deactivated account. */
function respondRows(req, res, rows, extraHeaders = {}) {
  const wantsObject = String(req.headers.accept ?? "").includes("vnd.pgrst.object+json");
  if (!wantsObject) return send(res, 200, rows, extraHeaders);

  if (rows.length === 0) {
    // What PostgREST does for zero rows under that Accept. .maybeSingle()
    // turns it into null; .single() surfaces it as an error, same as live.
    return send(res, 406, {
      code: "PGRST116",
      message: "JSON object requested, multiple (or no) rows returned",
    });
  }
  return send(res, 200, rows[0], extraHeaders);
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-expose-headers": "content-range",
    ...headers,
  });
  res.end(payload);
}

export function startStub() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const path = url.pathname;

    if (req.method === "OPTIONS") return send(res, 204, "");

    // --- GoTrue ---
    if (path.startsWith("/auth/v1/token")) return send(res, 200, SESSION);
    if (path === "/auth/v1/user") return send(res, 200, USER);
    if (path === "/auth/v1/logout") return send(res, 204, "");

    // --- RPC ---
    if (path.startsWith("/rest/v1/rpc/")) {
      const fn = path.slice("/rest/v1/rpc/".length);
      const handler = RPCS[fn];
      if (!handler) {
        problems.push(`unhandled rpc: ${fn}`);
        return send(res, 404, { message: `stub has no rpc ${fn}` });
      }
      return respondRows(req, res, handler());
    }

    // --- tables / views ---
    if (path.startsWith("/rest/v1/")) {
      const table = path.slice("/rest/v1/".length);
      const paging = parsePaging(url);

      // The bug this whole layer exists for. A page size that reached the
      // server as a client-reference proxy produced `.range(0, NaN)`, which
      // goes out as limit=NaN; PostgREST rejects it, the page renders an empty
      // queue, and nothing says why. Reject it here too, loudly.
      if (paging.bad) {
        problems.push(`malformed paging on ${table}: ${paging.bad}`);
        return send(res, 400, { message: `malformed paging: ${paging.bad}` });
      }

      let rows;
      if (table === "lead_queue") rows = filterLeads(url);
      else if (TABLES[table]) rows = TABLES[table]();
      else {
        problems.push(`unhandled table: ${table}`);
        return send(res, 404, { message: `stub has no table ${table}` });
      }

      const total = rows.length;
      const page =
        paging.count === null
          ? rows.slice(paging.from)
          : rows.slice(paging.from, paging.from + paging.count);
      const last = Math.max(paging.from, paging.from + page.length - 1);
      return respondRows(req, res, page, {
        "content-range": `${paging.from}-${last}/${total}`,
      });
    }

    problems.push(`unhandled path: ${path}`);
    send(res, 404, { message: `stub has no route ${path}` });
  });

  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

if (process.argv[1]?.endsWith("stub-supabase.mjs")) {
  await startStub();
  console.log(`stub supabase listening on http://127.0.0.1:${PORT}`);
}
