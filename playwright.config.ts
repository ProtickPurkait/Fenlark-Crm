import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// End-to-end checks for the pages themselves.
//
// These cover the layer the PGlite suite cannot reach. supabase/tests/smoke.sql
// proves the SQL is right; nothing proved that a page whose query is right
// actually puts rows on the screen. /caller shipped twice in a state where it
// did not, and no check in the project could have noticed.
//
// The app runs against e2e/stub-supabase.mjs rather than a real project, so
// the suite needs no credentials, no Docker and no network, and can run in CI
// unchanged.
//
// Built, not dev-served: NEXT_PUBLIC_* values are inlined at build time and
// the failure being guarded against was a build-time transform, so testing a
// dev server would test the wrong artifact.
const PREINSTALLED_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const STUB_PORT = 54329;
const APP_PORT = 3100;

const appEnv = {
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${STUB_PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "stub-anon-key",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Sandboxed CI images ship a Chromium that Playwright did not install
        // and whose build number will not match this package's expectation.
        // Use it when it is there rather than downloading a second copy;
        // fall back to Playwright's own browsers everywhere else, so a
        // developer's machine needs nothing but `npx playwright install`.
        ...(existsSync(PREINSTALLED_CHROMIUM)
          ? { launchOptions: { executablePath: PREINSTALLED_CHROMIUM } }
          : {}),
      },
    },
  ],
  webServer: [
    {
      command: "node e2e/stub-supabase.mjs",
      url: `http://127.0.0.1:${STUB_PORT}/auth/v1/user`,
      // Never reuse. The app server's command *builds* the app, so a server
      // left running from an earlier run serves an earlier build — and this
      // suite exists precisely because "the artifact under test was not the
      // artifact I changed" is a bug that reaches production. Paying ~20s a
      // run is the point, not an inconvenience.
      reuseExistingServer: false,
      stdout: "pipe",
    },
    {
      command: `npm run build && npx next start -p ${APP_PORT}`,
      url: `http://127.0.0.1:${APP_PORT}/login`,
      reuseExistingServer: false,
      timeout: 240_000,
      env: appEnv,
    },
  ],
});
