// Fallback only — middleware.ts redirects every request to "/" before this
// ever renders (to /login, or to /admin or /caller once authenticated).
export default function RootPage() {
  return null;
}
