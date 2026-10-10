"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, ChevronDown, FileUp, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "@/lib/bus";
import { ALL_CATS, catLabel, errorText, kindFor } from "@/lib/categories";
import { isImageFile, MAX_IMAGE_BYTES, recognizeImages } from "@/lib/ocr";
import ImportRow, { type PreviewRow, type Row, shortDate } from "./ImportRow";

interface Preview {
  rows: PreviewRow[];
  counts: { total: number; new: number; duplicates: number; transfers: number };
}
interface Rule { id: number; pattern: string; category: string; kind: string | null }

const MAX_BYTES = 5 * 1024 * 1024;
const PAGE = 150;

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function ImportStatement({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [shots, setShots] = useState<string | null>(null); // set in screenshot mode: "3 screenshots"
  const [ocrPct, setOcrPct] = useState<number | null>(null);
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
      setRows(p.rows.map((r, i) => ({ ...r, id: i, include: !r.duplicate && !r.transfer })));
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
    setShots(null);
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

  const pickShots = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    if (!files.every(isImageFile)) { setError("Those need to be images (PNG, JPG or WebP)."); return; }
    if (files.some((f) => f.size > MAX_IMAGE_BYTES)) { setError("That image is too big (15 MB max)."); return; }
    setError(null);
    setFile(null);
    setRows([]);
    setCounts(null);
    setChanged({});
    setOcrPct(0);
    try {
      const text = await recognizeImages(files, setOcrPct);
      setOcrPct(null);
      if (!text.trim()) throw new Error("empty");
      setShots(files.length === 1 ? files[0].name || "1 screenshot" : `${files.length} screenshots`);
      setBusy(true);
      const p = await api.post<Preview>("/api/import/screenshot-preview", { text, today: localToday() });
      setRows(p.rows.map((r, i) => ({ ...r, id: i, include: !r.duplicate && !r.transfer })));
      setCounts(p.counts);
      setShown(PAGE);
    } catch (err) {
      setShots(null);
      setError(errorText(err, "I couldn't find any transactions in that screenshot. Try a sharper one, with the list fully in view."));
    } finally {
      setOcrPct(null);
      setBusy(false);
    }
  };

  const editRow = (id: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch, edited: true } : r)));

  const toggleFlip = (v: boolean) => {
    setFlip(v);
    if (shots) return;
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
          kind: r.kind, category: r.category, hash: r.edited ? null : r.hash, refund: r.refund ?? false,
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
      <div role="dialog" aria-modal="true" aria-label="Import statement or screenshot"
           className="bg-bg sm:bg-panel w-full sm:max-w-2xl h-[100dvh] sm:h-[90vh] sm:rounded-2xl sm:border sm:border-edge
                      flex flex-col overflow-hidden pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-edge">
          <h2 className="flex-1 text-base font-extrabold text-txt">Import statement or screenshot</h2>
          <button ref={closeRef} onClick={onClose} aria-label="Close"
                  className="h-10 w-10 -mr-2 flex items-center justify-center rounded-full text-dim hover:bg-panel2
                             focus-visible:outline-2 focus-visible:outline-up">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="p-4 space-y-3">
            <p className="text-[12px] text-dim leading-snug">
              Pick a screenshot of your card's transactions, or a CSV, OFX or QFX file from your bank. You can
              review everything before it is added.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="btn btn-primary !min-h-10 cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-up">
                <Camera size={14} />Screenshot
                <input type="file" accept="image/*" multiple className="sr-only" onChange={pickShots} />
              </label>
              <label className="btn !min-h-10 cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-up">
                <FileUp size={14} />Statement file
                <input type="file" accept=".csv,.ofx,.qfx,text/csv" className="sr-only" onChange={pickFile} />
              </label>
              {(shots || file) && <span className="text-[12px] text-dim truncate min-w-0 flex-1">{shots ?? file?.name}</span>}
            </div>
            {!shots && (
              <label className="flex items-center gap-3 min-h-10 text-[13px] text-txt cursor-pointer">
                <input type="checkbox" className="h-5 w-5 accent-up shrink-0" checked={flip}
                       onChange={(e) => toggleFlip(e.target.checked)} />
                Charges show as positive (credit card)
              </label>
            )}

            {error && (
              <p role="alert" className="text-[12px] text-down bg-panel2 border border-edge rounded-lg px-3 py-2">{error}</p>
            )}
            {ocrPct !== null && (
              <p role="status" className="text-[12px] text-dim tabular-nums">Reading screenshot… {Math.round(ocrPct * 100)}%</p>
            )}
            {busy && ocrPct === null && (
              <p role="status" className="text-[12px] text-dim">{shots ? "Finding transactions…" : "Reading your file…"}</p>
            )}
            {shots && rows.length > 0 && !busy && (
              <p className="text-[12px] text-amber">Check the amounts. Screenshots can misread a digit.</p>
            )}

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
                <ImportRow key={r.id} row={r}
                           onInclude={(v) => setInclude(i, v)}
                           onCategory={(c) => setCategory(i, c)}
                           onEdit={shots ? (patch) => editRow(r.id, patch) : undefined} />
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
          <button className="btn btn-primary !min-h-11 flex-[2] disabled:opacity-50" disabled={!selected.length || saving || busy || ocrPct !== null}
                  onClick={commit}>
            {saving ? "Importing…" : <>Import <span className="tabular-nums">{selected.length}</span> transaction{selected.length === 1 ? "" : "s"}</>}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document === "undefined" ? null : createPortal(sheet, document.body);
}
