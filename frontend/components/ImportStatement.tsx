"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, FileUp, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "@/lib/bus";
import { ALL_CATS, catLabel, errorText, kindFor } from "@/lib/categories";
import { fmtCents } from "@/lib/privacy";

interface PreviewRow {
  date: string; description: string; merchant: string; amount: number;
  kind: "income" | "expense"; category: string; transfer: boolean; duplicate: boolean; hash: string;
  /** a merchant refund: files as negative spending in its category */
  refund?: boolean;
}
interface Preview {
  rows: PreviewRow[];
  counts: { total: number; new: number; duplicates: number; transfers: number };
}
interface Row extends PreviewRow { include: boolean }
interface Rule { id: number; pattern: string; category: string; kind: string | null }

const MAX_BYTES = 5 * 1024 * 1024;
const PAGE = 150;

const shortDate = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
};

export default function ImportStatement({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [flip, setFlip] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Preview["counts"] | null>(null);
  const [changed, setChanged] = useState<Record<string, { category: string; remember: boolean }>>({});
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [rules, setRules] = useState<Rule[]>([]);
  const [rulesOpen, setRulesOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const loadRules = useCallback(() => api.get<Rule[]>("/api/rules").then(setRules).catch(() => {}), []);
  useEffect(() => { loadRules(); closeRef.current?.focus(); }, [loadRules]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const runPreview = useCallback(async (f: { name: string; content: string }, flipSign: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const p = await api.post<Preview>("/api/import/preview", { filename: f.name, content: f.content, flip_sign: flipSign });
      setRows(p.rows.map((r) => ({ ...r, include: !r.duplicate && !r.transfer })));
      setCounts(p.counts);
      setChanged({});
      setShown(PAGE);
    } catch (e) {
      setRows([]);
      setCounts(null);
      setError(errorText(e, "I couldn't read that file. Try a CSV, OFX or QFX export from your bank."));
    } finally {
      setBusy(false);
    }
  }, []);

  const pickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > MAX_BYTES) {
      setError("That file is too big (5 MB max). Try exporting a shorter date range.");
      return;
    }
    let content = "";
    try { content = await f.text(); } catch {
      setError("I couldn't open that file. Try saving it again from your bank.");
      return;
    }
    const next = { name: f.name, content };
    setFile(next);
    runPreview(next, flip);
  };

  const toggleFlip = (v: boolean) => {
    setFlip(v);
    if (file) runPreview(file, v);
  };

  const setCategory = (idx: number, category: string) => {
    const merchant = rows[idx].merchant;
    const key = merchant.toLowerCase();
    setRows((rs) => rs.map((r) =>
      r.merchant.toLowerCase() === key ? { ...r, category, kind: kindFor(category) } : r));
    setChanged((c) => ({ ...c, [merchant]: { category, remember: c[merchant]?.remember ?? true } }));
  };

  const setInclude = (idx: number, v: boolean) =>
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, include: v } : r)));

  const selected = useMemo(() => rows.filter((r) => r.include), [rows]);

  const commit = async () => {
    if (!selected.length) return;
    setSaving(true);
    setError(null);
    try {
      const remember = Object.entries(changed)
        .filter(([, v]) => v.remember)
        .map(([pattern, v]) => ({ pattern, category: v.category, kind: kindFor(v.category) }));
      const res = await api.post<{ inserted: number; duplicates: number }>("/api/import/commit", {
        rows: selected.map((r) => ({
          date: r.date, merchant: r.merchant, description: r.description, amount: r.amount,
          kind: r.kind, category: r.category, hash: r.hash, refund: r.refund ?? false,
        })),
        remember,
      });
      const dup = res.duplicates ? ` (${res.duplicates} already there)` : "";
      toast(`Imported ${res.inserted} transaction${res.inserted === 1 ? "" : "s"}${dup}`);
      onDone();
      onClose();
    } catch (e) {
      setError(errorText(e, "I couldn't save those. Please try again."));
      setSaving(false);
    }
  };

  const removeRule = async (id: number) => {
    await api.del(`/api/rules/${id}`).catch(() => {});
    loadRules();
  };

  const changedList = Object.entries(changed);
  const rangeText = rows.length
    ? `${shortDate(rows.reduce((a, r) => (r.date < a ? r.date : a), rows[0].date))} – ${shortDate(rows.reduce((a, r) => (r.date > a ? r.date : a), rows[0].date))}`
    : "";

  const sheet = (
    <div className="fixed inset-0 z-[85] bg-black/60 flex items-end sm:items-center justify-center"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Import a statement"
           className="bg-bg sm:bg-panel w-full sm:max-w-2xl h-[100dvh] sm:h-[90vh] sm:rounded-2xl sm:border sm:border-edge
                      flex flex-col overflow-hidden pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-edge">
          <h2 className="flex-1 text-base font-extrabold text-txt">Import a statement</h2>
          <button ref={closeRef} onClick={onClose} aria-label="Close"
                  className="h-10 w-10 -mr-2 flex items-center justify-center rounded-full text-dim hover:bg-panel2
                             focus-visible:outline-2 focus-visible:outline-up">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="p-4 space-y-3">
            <p className="text-[12px] text-dim leading-snug">
              Download a CSV, OFX or QFX file from your bank or card, then pick it here. You can review everything
              before it is added.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="btn btn-primary !min-h-10 cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-up">
                <FileUp size={14} />{file ? "Choose another file" : "Choose a file"}
                <input type="file" accept=".csv,.ofx,.qfx,text/csv" className="sr-only" onChange={pickFile} />
              </label>
              {file && <span className="text-[12px] text-dim truncate min-w-0 flex-1">{file.name}</span>}
            </div>
            <label className="flex items-center gap-3 min-h-10 text-[13px] text-txt cursor-pointer">
              <input type="checkbox" className="h-5 w-5 accent-up shrink-0" checked={flip}
                     onChange={(e) => toggleFlip(e.target.checked)} />
              Charges show as positive (credit card)
            </label>

            {error && (
              <p role="alert" className="text-[12px] text-down bg-panel2 border border-edge rounded-lg px-3 py-2">{error}</p>
            )}
            {busy && <p className="text-[12px] text-dim">Reading your file…</p>}

            {counts && !busy && (
              <p className="text-[13px] text-txt tabular-nums">
                <b>{counts.new} new</b> · {counts.duplicates} already imported · {counts.transfers} transfer{counts.transfers === 1 ? "" : "s"} skipped
                {rangeText && <span className="block text-[11px] text-faint">{rangeText}</span>}
              </p>
            )}

            {changedList.length > 0 && (
              <div className="rounded-lg border border-edge bg-panel2 p-3 space-y-1">
                <div className="text-[11px] font-bold text-dim uppercase tracking-widest">Remember these choices?</div>
                {changedList.map(([merchant, v]) => (
                  <label key={merchant} className="flex items-center gap-3 min-h-10 text-[13px] text-txt cursor-pointer">
                    <input type="checkbox" className="h-5 w-5 accent-up shrink-0" checked={v.remember}
                           onChange={(e) => setChanged((c) => ({ ...c, [merchant]: { ...v, remember: e.target.checked } }))} />
                    <span className="min-w-0">Remember for <b className="break-words">{merchant}</b> as {catLabel(v.category)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {rows.length > 0 && !busy && (
            <ul className="border-t border-edge">
              {rows.slice(0, shown).map((r, i) => (
                <li key={r.hash} className={`flex flex-wrap sm:flex-nowrap items-center gap-x-2 gap-y-1 px-3 py-1.5 border-b border-edge ${r.include ? "" : "opacity-60"}`}>
                  <label className="h-10 w-10 flex items-center justify-center shrink-0 cursor-pointer">
                    <input type="checkbox" className="h-5 w-5 accent-up" checked={r.include}
                           aria-label={`Include ${r.merchant}`} onChange={(e) => setInclude(i, e.target.checked)} />
                  </label>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-txt truncate">{r.merchant}</div>
                    <div className="text-[11px] text-faint truncate">
                      <span className="tabular-nums">{shortDate(r.date)}</span>
                      {r.duplicate && <span className="text-amber"> · already imported</span>}
                      {r.transfer && !r.duplicate && <span className="text-cyan"> · transfer</span>}
                      {r.refund && !r.duplicate && <span className="text-up"> · refund</span>}
                    </div>
                  </div>
                  <div className={`ml-auto shrink-0 text-[13px] font-bold tabular-nums ${r.kind === "income" || r.refund ? "text-up" : "text-down"}`}>
                    {r.kind === "income" || r.refund ? "+" : "−"}{fmtCents(Math.abs(r.amount))}
                  </div>
                  <div className="w-full sm:w-36 shrink-0">
                    <select className="field !h-10 !text-[13px]" value={r.category}
                            aria-label={`Category for ${r.merchant}`} onChange={(e) => setCategory(i, e.target.value)}>
                      {ALL_CATS.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
                    </select>
                  </div>
                </li>
              ))}
              {rows.length > shown && (
                <li className="p-3">
                  <button className="btn w-full !min-h-10" onClick={() => setShown(shown + PAGE)}>
                    Show {Math.min(PAGE, rows.length - shown)} more ({rows.length - shown} left)
                  </button>
                </li>
              )}
            </ul>
          )}

          <div className="border-t border-edge">
            <button className="w-full flex items-center gap-2 px-4 min-h-12 text-left text-[13px] font-semibold text-txt
                               focus-visible:outline-2 focus-visible:outline-up"
                    aria-expanded={rulesOpen} onClick={() => setRulesOpen(!rulesOpen)}>
              <span className="flex-1">Your rules <span className="text-faint font-normal tabular-nums">({rules.length})</span></span>
              <ChevronDown size={16} className={`text-faint transition-transform ${rulesOpen ? "" : "-rotate-90"}`} />
            </button>
            {rulesOpen && (
              <div className="px-4 pb-3">
                {rules.length === 0 ? (
                  <p className="text-[12px] text-dim">
                    No rules yet. When you change a category here, you can ask me to remember it for next time.
                  </p>
                ) : (
                  <ul>
                    {rules.map((r) => (
                      <li key={r.id} className="flex items-center gap-2 min-h-10 text-[13px] border-t border-edge first:border-t-0">
                        <span className="min-w-0 flex-1 truncate text-txt">{r.pattern}</span>
                        <span className="text-dim">→ {catLabel(r.category)}</span>
                        <button className="icon-btn h-10 w-10 justify-center focus-visible:outline-2 focus-visible:outline-up"
                                aria-label={`Delete rule for ${r.pattern}`} onClick={() => removeRule(r.id)}>
                          <Trash2 size={15} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 p-3 border-t border-edge bg-bg sm:bg-panel pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button className="btn !min-h-11 flex-1 sm:flex-none sm:px-6" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary !min-h-11 flex-[2] disabled:opacity-50" disabled={!selected.length || saving || busy}
                  onClick={commit}>
            {saving ? "Importing…" : <>Import <span className="tabular-nums">{selected.length}</span> transaction{selected.length === 1 ? "" : "s"}</>}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document === "undefined" ? null : createPortal(sheet, document.body);
}
