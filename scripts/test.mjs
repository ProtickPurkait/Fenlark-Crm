// ============================================================================
// Runs every migration and the full smoke test against a real Postgres, with
// no Docker and no daemon. PGlite is Postgres compiled to WASM, running in
// this Node process.
//
//   npm test
//
// What this does NOT cover (needs a real Supabase project — see README):
//   - pg_cron scheduling. The extension is absent here, so migration 0800
//     logs a notice and skips cron.schedule(). The function it would call is
//     fully exercised below via admin_run_recycle_now().
//   - The trigger on Supabase's real auth.users, which scripts/pglite-shim.sql
//     stands in for.
// ============================================================================
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function fail(label, e) {
  console.error(`\n${red('FAIL')}  ${label}\n`);
  for (const line of String(e.message ?? e).split('\n')) console.error(`      ${line}`);
  for (const [k, v] of [['DETAIL', e.detail], ['HINT', e.hint], ['WHERE', e.where]]) {
    if (v) console.error(`      ${k}: ${v}`);
  }
  process.exit(1);
}

const db = await PGlite.create({});

// --- schema ---------------------------------------------------------------
try {
  await db.exec(read('scripts/pglite-shim.sql'));
} catch (e) {
  fail('scripts/pglite-shim.sql', e);
}

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
if (files.length === 0) fail('migrations', new Error('no .sql files found'));

console.log('\nMigrations');
for (const f of files) {
  try {
    await db.exec(readFileSync(path.join(MIGRATIONS, f), 'utf8'));
    console.log(`  ${green('applied')}  ${f}`);
  } catch (e) {
    fail(f, e);
  }
}

// --- smoke test -----------------------------------------------------------
// Any failed assertion raises inside the transaction, so a thrown error here
// is a real failure. Reaching the end means every assertion passed.
let results;
try {
  results = await db.exec(read('supabase/tests/smoke.sql'));
} catch (e) {
  fail('supabase/tests/smoke.sql', e);
}

// The last result set with rows is the zz_log summary the test selects out
// just before rolling back.
const rows = results.flatMap((r) => r.rows ?? []).filter((r) => r?.kind && r?.label);

if (rows.length === 0) {
  fail(
    'supabase/tests/smoke.sql',
    new Error(
      'The smoke test ran without error but reported no assertions.\n' +
      'That means its self-reporting broke, not that the schema is sound —\n' +
      'check that smoke.sql still selects from zz_log before its rollback.'
    )
  );
}

let ok = 0;
let blocked = 0;
for (const r of rows) {
  if (r.kind === 'section') {
    console.log(`\n${r.label}`);
  } else if (r.kind === 'blocked') {
    blocked++;
    console.log(`  ${green('blocked')}  ${r.label}`);
    if (r.detail) console.log(`           ${dim(r.detail)}`);
  } else {
    ok++;
    console.log(`  ${green('ok')}       ${r.label}`);
  }
}

console.log(
  `\n${green('PASS')}  ${ok + blocked} assertions — ` +
  `${ok} positive, ${blocked} rejections correctly blocked.\n`
);
