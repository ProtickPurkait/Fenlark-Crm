import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseWs = supabaseUrl.replace(/^https/, "wss");
const isDev = process.env.NODE_ENV === "development";

// Content Security Policy.
//
// Two deliberate relaxations, both load-bearing rather than lazy:
//   * style-src 'unsafe-inline' — Framer Motion writes inline styles on every
//     animated element on every frame, and Next injects an inline <style> for
//     CSS. A nonce cannot cover runtime-generated style attributes, so there
//     is no strict alternative short of dropping the animation library.
//   * script-src 'unsafe-eval' — DEV ONLY, required by the webpack HMR
//     runtime. It is absent from production builds.
//
// connect-src must list both the Supabase REST origin and its wss:// form,
// otherwise Realtime subscriptions fail silently when they are added later.
const csp = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob:`,
  `font-src 'self' data:`,
  `connect-src 'self' ${supabaseUrl} ${supabaseWs}${isDev ? " ws://localhost:* http://localhost:*" : ""}`,
  // Both are required for the PWA: without manifest-src the browser refuses
  // to fetch the webmanifest (and the app silently stops being installable),
  // and worker-src is what allows /sw.js to register.
  `manifest-src 'self'`,
  `worker-src 'self'`,
  // Clickjacking defence for modern browsers; X-Frame-Options below is the
  // legacy fallback for older ones.
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `object-src 'none'`,
  // PRODUCTION ONLY. This directive rewrites every http:// request to
  // https://, and it does not exempt localhost — so on the dev server it
  // upgraded Next's own same-origin RSC fetches to https://localhost:3100,
  // which has no TLS listener. Every one failed with ERR_SSL_PROTOCOL_ERROR
  // and Next fell back to a full browser navigation, turning every in-app
  // link into a whole page reload. The symptom is "navigation takes seconds"
  // with nothing obviously broken; the tell is
  // "Failed to fetch RSC payload ... Falling back to browser navigation"
  // in the console. Harmless (and wanted) in production, which is HTTPS.
  ...(isDev ? [] : [`upgrade-insecure-requests`]),
]
  .filter(Boolean)
  .join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Stop advertising the framework and its version to attackers.
  poweredByHeader: false,

  experimental: {
    // Client-side router cache lifetimes.
    //
    // Next 15 defaults `dynamic` to 0, which means a prefetched or
    // already-visited dynamic route is thrown away immediately — so moving
    // between the four nav tabs refetched the full RSC payload every single
    // time. Each of those refetches pays middleware's two sequential Supabase
    // round trips (getUser + the profile lookup), measured at ~460ms TTFB,
    // which is what made navigation feel laggy even with nothing else wrong.
    //
    // With a non-zero value, going back to a tab visited in the last 30s uses
    // the cached payload and issues *no request at all* — genuinely instant.
    //
    // 30s is deliberately short for a CRM: a telecaller's queue changes as
    // they work. It is also not the only freshness mechanism — every mutation
    // path already calls router.refresh() (admin screens) or refetches
    // client-side (the disposition drawer), both of which bust this cache
    // immediately, so a save is never hidden behind it.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          // Ignored over plain HTTP, so harmless on localhost and active the
          // moment this is served over TLS.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
