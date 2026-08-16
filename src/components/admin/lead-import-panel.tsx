"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FileUp, Loader2, TriangleAlert, X } from "lucide-react";
import { MotionButton } from "@/components/ui/motion-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseLeadCsv, type CsvParseResult, type ImportRow } from "@/lib/csv";
import { normalizePhone } from "@/lib/phone";
import { springSoft } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface ImportResult {
  inserted: number;
  skipped_duplicate: number;
  skipped_invalid: number;
}

export function LeadImportPanel({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [mode, setMode] = useState<"csv" | "manual">("csv");

  return (
    <motion.section
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={springSoft}
      className="glass rounded-2xl p-5"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1">
          {(["csv", "manual"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                mode === m
                  ? "bg-white/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "csv" ? "CSV upload" : "Add one lead"}
            </button>
          ))}
        </div>
        <MotionButton variant="ghost" size="icon" onClick={onClose} aria-label="Close import panel">
          <X className="h-4 w-4" />
        </MotionButton>
      </div>

      {mode === "csv" ? (
        <CsvImport onImported={onImported} />
      ) : (
        <ManualEntry onImported={onImported} />
      )}
    </motion.section>
  );
}

// ---------------------------------------------------------------------------

function CsvImport({ onImported }: { onImported: () => void }) {
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Duplicates *within the file itself*. The database's unique index catches
  // these too, but reporting them here means "312 imported, 14 skipped" isn't
  // a surprise — the admin can see it before committing.
  const inFileDuplicates = (() => {
    if (!parsed) return 0;
    const seen = new Set<string>();
    let dupes = 0;
    for (const row of parsed.rows) {
      const key = normalizePhone(row.phone);
      if (seen.has(key)) dupes++;
      else seen.add(key);
    }
    return dupes;
  })();

  async function handleFile(file: File) {
    setError(null);
    setResult(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      const out = parseLeadCsv(text);
      setParsed(out);
      if (out.rows.length === 0) {
        setError(
          out.rejected.length > 0
            ? "No importable rows — every row was missing a name or a phone number."
            : "No rows found. Check the file has a header row with name and phone columns.",
        );
      }
    } catch {
      setError("Could not read that file.");
      setParsed(null);
    }
  }

  async function runImport() {
    if (!parsed || inFlight.current) return;
    inFlight.current = true;
    setImporting(true);
    setError(null);

    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("admin_import_leads", {
      p_rows: parsed.rows,
      p_source: "csv",
    });

    inFlight.current = false;
    setImporting(false);

    if (rpcError) {
      setError(
        rpcError.message.includes("forbidden")
          ? "Your account no longer has admin rights."
          : `Import failed: ${rpcError.message}`,
      );
      return;
    }

    setResult(data?.[0] ?? null);
    setParsed(null);
    setFileName(null);
    if (fileInput.current) fileInput.current.value = "";
    onImported();
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="csv-file" className="text-xs uppercase tracking-wider text-muted-foreground">
          CSV file
        </Label>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <input
            ref={fileInput}
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
            className="block w-full max-w-md text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-white/10 file:bg-white/5 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-white/10"
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Needs a header row with{" "}
          <span className="text-foreground/70">business name</span>,{" "}
          <span className="text-foreground/70">business contact</span>,{" "}
          business category and business address columns.
          Name and contact are required; category and address are optional.
          Common variants (&ldquo;Full Name&rdquo;, &ldquo;Mobile&rdquo;,
          &ldquo;Type&rdquo;) are recognised automatically.
        </p>
      </div>

      <AnimatePresence>
        {parsed && parsed.rows.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={springSoft}
            className="rounded-lg border border-white/10 bg-white/[0.03] p-4"
          >
            <p className="text-sm font-medium">
              {fileName} — {parsed.rows.length} row
              {parsed.rows.length === 1 ? "" : "s"} ready
            </p>

            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              <li>
                Columns matched:{" "}
                <span className="text-foreground/70">
                  {Object.entries(parsed.matchedHeaders)
                    .map(([field, header]) => `${header} → ${field}`)
                    .join(", ")}
                </span>
              </li>
              {parsed.unmappedHeaders.length > 0 && (
                <li>
                  Ignored columns:{" "}
                  <span className="text-[hsl(var(--neon-amber))]">
                    {parsed.unmappedHeaders.join(", ")}
                  </span>
                </li>
              )}
              {parsed.rejected.length > 0 && (
                <li>
                  <span className="text-[hsl(var(--neon-amber))]">
                    {parsed.rejected.length} row
                    {parsed.rejected.length === 1 ? "" : "s"} skipped
                  </span>{" "}
                  (line
                  {parsed.rejected.length === 1 ? " " : "s "}
                  {parsed.rejected.slice(0, 6).map((r) => r.line).join(", ")}
                  {parsed.rejected.length > 6 ? "…" : ""} — missing name or phone)
                </li>
              )}
              {inFileDuplicates > 0 && (
                <li>
                  <span className="text-[hsl(var(--neon-amber))]">
                    {inFileDuplicates} duplicate phone
                    {inFileDuplicates === 1 ? "" : "s"} inside this file
                  </span>{" "}
                  — only the first of each will be kept.
                </li>
              )}
            </ul>

            <div className="mt-4 overflow-x-auto scrollbar-slim">
              <table className="w-full min-w-[34rem] text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="pb-1.5 pr-4 font-medium">Business name</th>
                    <th className="pb-1.5 pr-4 font-medium">Business contact</th>
                    <th className="pb-1.5 pr-4 font-medium">Category</th>
                    <th className="pb-1.5 font-medium">Address</th>
                  </tr>
                </thead>
                <tbody className="text-foreground/70">
                  {parsed.rows.slice(0, 4).map((r, i) => (
                    <tr key={i}>
                      <td className="py-0.5 pr-4">{r.full_name}</td>
                      <td className="py-0.5 pr-4 font-mono">{r.phone}</td>
                      <td className="py-0.5 pr-4">{r.business_type ?? "—"}</td>
                      <td className="py-0.5">{r.address ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsed.rows.length > 4 && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  …and {parsed.rows.length - 4} more
                </p>
              )}
            </div>

            <MotionButton onClick={runImport} disabled={importing} className="mt-4">
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              {importing ? "Importing…" : `Import ${parsed.rows.length} lead${parsed.rows.length === 1 ? "" : "s"}`}
            </MotionButton>
          </motion.div>
        )}
      </AnimatePresence>

      <ResultBanner result={result} />
      <ErrorBanner error={error} />
    </div>
  );
}

// ---------------------------------------------------------------------------

const EMPTY_MANUAL: ImportRow = {
  full_name: "",
  phone: "",
  business_type: "",
  address: "",
};

function ManualEntry({ onImported }: { onImported: () => void }) {
  const [form, setForm] = useState<ImportRow>(EMPTY_MANUAL);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  function set(field: keyof ImportRow, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;

    if (!form.full_name?.trim()) return setError("Business name is required.");
    if (normalizePhone(form.phone).length < 10) {
      return setError("Enter a valid 10-digit contact number.");
    }

    inFlight.current = true;
    setSaving(true);
    setError(null);
    setResult(null);

    // Strip empties so the RPC stores NULL rather than "" for absent fields.
    const row = Object.fromEntries(
      Object.entries(form).filter(([, v]) => String(v ?? "").trim() !== ""),
    );

    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("admin_import_leads", {
      p_rows: [row],
      p_source: "manual",
    });

    inFlight.current = false;
    setSaving(false);

    if (rpcError) {
      setError(`Could not add the lead: ${rpcError.message}`);
      return;
    }

    const out = data?.[0] ?? null;
    setResult(out);
    if (out && out.inserted > 0) setForm(EMPTY_MANUAL);
    onImported();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Business name" required value={form.full_name ?? ""} onChange={(v) => set("full_name", v)} />
        <Field label="Business contact" required value={form.phone ?? ""} onChange={(v) => set("phone", v)} placeholder="98765 43210" mono />
        <Field label="Business category" value={form.business_type ?? ""} onChange={(v) => set("business_type", v)} />
        <Field label="Business address" value={form.address ?? ""} onChange={(v) => set("address", v)} />
      </div>

      <ResultBanner result={result} singular />
      <ErrorBanner error={error} />

      <MotionButton type="submit" disabled={saving}>
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        {saving ? "Adding…" : "Add lead"}
      </MotionButton>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  type = "text",
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
  placeholder?: string;
  mono?: boolean;
}) {
  const id = `manual-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
        {required && <span className="ml-1 text-[hsl(var(--neon-rose))]">*</span>}
      </Label>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={mono ? "font-mono" : undefined}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function ResultBanner({
  result,
  singular,
}: {
  result: ImportResult | null;
  singular?: boolean;
}) {
  if (!result) return null;

  const nothingHappened = result.inserted === 0;
  const parts = [
    `${result.inserted} imported`,
    result.skipped_duplicate > 0 && `${result.skipped_duplicate} duplicate skipped`,
    result.skipped_invalid > 0 && `${result.skipped_invalid} invalid skipped`,
  ].filter(Boolean);

  return (
    <motion.p
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springSoft}
      className={cn(
        "rounded-lg border p-3 text-sm",
        nothingHappened
          ? "border-[hsl(var(--neon-amber)/0.3)] bg-[hsl(var(--neon-amber)/0.1)] text-[hsl(var(--neon-amber))]"
          : "border-[hsl(var(--neon-emerald)/0.3)] bg-[hsl(var(--neon-emerald)/0.1)] text-[hsl(var(--neon-emerald))]",
      )}
    >
      {nothingHappened && singular && result.skipped_duplicate > 0
        ? "That phone number already exists in the pipeline."
        : parts.join(" · ")}
    </motion.p>
  );
}

function ErrorBanner({ error }: { error: string | null }) {
  return (
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
  );
}
