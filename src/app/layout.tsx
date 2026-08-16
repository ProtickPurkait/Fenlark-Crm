import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegistrar } from "@/components/pwa/service-worker-registrar";

// Without this, mobile browsers assume a ~980px desktop canvas and zoom the
// whole page out — every screen renders unreadably small before a single CSS
// rule matters. This is the foundation of the mobile experience, not a detail.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the app paint into the notch/home-indicator area; the safe-area-inset
  // padding in globals.css and the layouts is what keeps content clear of it.
  viewportFit: "cover",
  // Tints the Android status bar and the iOS standalone header to match the
  // app background, so an installed Trace looks native rather than framed.
  themeColor: "#030711",
  // Deliberately NOT setting maximumScale/userScalable: blocking pinch-zoom is
  // an accessibility failure. The iOS focus-zoom problem is solved properly by
  // giving inputs a >=16px font size (see ui/input.tsx), not by disabling zoom.
};

export const metadata: Metadata = {
  // `template` gives every child route "<Page> · Trace" for free once the admin
  // screens land and start exporting their own titles.
  title: {
    default: "Trace",
    template: "%s · Trace",
  },
  description: "Lead & telecaller pipeline management — Fenlark Technologies LLP",
  applicationName: "Trace",
  // Declared here and served from /public rather than using the app/icon.svg
  // file convention. Next's metadata-route loader interpolates the file's
  // absolute path into a single-quoted JS string without escaping it, and the
  // apostrophe in this machine's path ("Protick's Laptop") closes that string
  // early — the whole app then fails to compile with `Module parse failed`.
  // A public/ asset skips that loader. See README → "Windows path caveat".
  // The same reasoning applies to the manifest: app/manifest.ts is another
  // metadata file convention, so it is a static public/ asset here instead.
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    // iOS ignores the manifest for the home-screen icon and reads this instead.
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: "Trace",
    // The app paints its own dark background behind the status bar.
    statusBarStyle: "black-translucent",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // Dark is forced rather than toggled: this is a dark-only product, and
    // `colorScheme` makes the browser render native controls (scrollbars, the
    // datetime-local picker in the disposition drawer) in dark too — without
    // it those render as bright white boxes against the glass panels.
    <html lang="en" className="dark" style={{ colorScheme: "dark" }}>
      <body className="min-h-svh antialiased">
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
