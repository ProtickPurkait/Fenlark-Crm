import type { CapacitorConfig } from "@capacitor/cli";

// Remote-URL mode: the native shell's WebView loads the live production site
// directly rather than bundling a local copy of it. That is deliberate — this
// app is server-rendered (Supabase auth via cookies, live RPCs, no static
// export), so there is no meaningful "offline bundle" to ship, and pointing at
// the same URL the PWA already uses means the native app and the browser PWA
// are always running the exact same code with nothing to keep in sync.
//
// The only thing this native shell adds is CallTrackerPlugin (see
// android/app/src/main/java/llp/fenlark/trace/CallTrackerPlugin.kt) — real
// telephony call-state events, which no browser can ever expose.
const config: CapacitorConfig = {
  appId: "llp.fenlark.trace",
  appName: "Trace",
  webDir: "public",
  server: {
    url: process.env.CAPACITOR_SERVER_URL || "https://fenlark-crm.vercel.app",
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
