"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, ChevronDown, FileUp, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { catLabel, curMonth, errorText, kindFor, localToday, monthLabel, monthShift } from "@/lib/categories";
import { isImageFile, MAX_IMAGE_BYTES, recognizeImages } from "@/lib/ocr";
import ImportRow, { type PreviewRow, type Row, shortDate } from "./ImportRow";

interface Preview {
  rows: PreviewRow[];
  counts: { total: number; new: number; duplicates: number; transfers: number };
  flip_sign?: boolean;
}
interface Rule { id: number; pattern: string; category: string; kind: string | null }
export interface ImportResult { inserted: number; duplicates: number; batch?: string; month: string }

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 3.5 * 1024 * 1024; // sent as base64, which is a third bigger
const PAGE = 150;
const PREF_KEY = "import-count-in"; // "next" when the last import was counted in the following month

const readPref = () => { try { return localStorage.getItem(PREF_KEY); } catch { return null; } };
const writePref = (v: string) => { try { localStorage.setItem(PREF_KEY, v); } catch { /* private mode */ } };

function readAsBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",", 2)[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

export default function ImportStatement({ onClose, onDone }: { onClose: () => void; onDone: (r: ImportResult) => void }) {
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [shots, setShots] = useState<string | null>(null); // set in screenshot mode: "3 screenshots"
  const [ocrPct, setOcrPct] = useState<number | null>(null);
  const [flip, setFlip] = useState<boolean | null>(null);
  const [autoFlip, setAutoFlip] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Preview["counts"] | null>(null);
  const [changed, setChanged] = useState<Record<string, { category: string; remember: boolean }>>({});
  const [countIn, setCountIn] = useState<string | null | undefined>(undefined); // undefined = not chosen yet
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

  const load = (p: Preview) => {
    setRows(p.rows.map((r, i) => ({ ...r, id: i, include: !r.duplicate && !r.transfer })));
    setCounts(p.counts);
    setChanged({});
    setShown(PAGE);
    setCountIn(undefined);
  };

  const runPreview = useCallback(async (f: { name: string; content: string }, flipSign: boolean | null) => {
    setBusy(true);
    setError(null);
    try {
      const p = await api.post<Preview>("/api/import/preview",
        { filename: f.name, content: f.content, flip_sign: flipSign, today: localToday() });
      load(p);
      setFlip(p.flip_sign ?? false);
      if (flipSign === null) setAutoFlip(!!p.flip_sign);
    } catch (e) {
      setRows([]);
      setCounts(null);
      setError(errorText(e, "I couldn't read that file. Try a CSV, OFX, QFX or PDF statement."));
    } finally {
      setBusy(false);
    }
  }, []);

  const pickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setShots(null);
    const pdf = /\.pdf$/i.test(f.name) || f.type === "application/pdf";
    if (f.size > (pdf ? MAX_PDF_BYTES : MAX_BYTES)) {
      setError(pdf ? "That PDF is too big (3.5 MB max)." : "That file is too big (5 MB max). Try exporting a shorter date range.");
      return;
    }
    let content = "";
    try { content = pdf ? await readAsBase64(f) : await f.text(); } catch {
      setError("I couldn't open that file. Try saving it again from your bank.");
      return;
    }
    const next = { name: pdf && !/\.pdf$/i.test(f.name) ? `${f.name}.pdf` : f.name, content };
    setFile(next);
    setAutoFlip(false);
    runPreview(next, null);
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
      load(await api.post<Preview>("/api/import/screenshot-preview", { text, today: localToday() }));
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
    setAutoFlip(false);
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
  const guessedCount = selected.filter((r) => r.date_guessed).length;

  // Which month do these purchases fall in? (most common month of the rows being imported)
  const months = useMemo(() => {
    const tally = new Map<string, number>();
    for (const r of selected) tally.set(r.date.slice(0, 7), (tally.get(r.date.slice(0, 7)) ?? 0) + 1);
    const list = [...tally.keys()].sort();
    const main = [...tally.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))[0]?.[0] ?? null;
    return { list, main };
  }, [selected]);
  const multi = months.list.length > 1;
  const next = months.main ? monthShift(months.main, 1) : null;
  // Default: the month he usually picks. "next" = the month after the purchases (card paid later).
  const pref = readPref();
  // Only for purchases from a past month: this month's charges aren't on a bill yet.
  const countInValue: string | null = countIn !== undefined ? countIn
    : !months.main ? null : pref === "next" && next && next <= curMonth() ? next : multi ? null : months.main;
  const sameMonth = (v: string | null) => (v === null && !multi) || v === months.main;

  const commit = async () => {
    if (!selected.length) return;
    setSaving(true);
    setError(null);
    try {
      const remember = Object.entries(changed)
        .filter(([, v]) => v.remember)
        .map(([pattern, v]) => ({ pattern, category: v.category, kind: kindFor(v.category) }));
      const budgetMonth = countInValue && !(countInValue === months.main && !multi) ? countInValue : null;
      const res = await api.post<{ inserted: number; duplicates: number; batch?: string }>("/api/import/commit", {
        rows: selected.map((r) => ({
          date: r.date, merchant: r.merchant, description: r.description, amount: r.amount,
          kind: r.kind, category: r.category, hash: r.edited ? null : r.hash, refund: r.refund ?? false,
        })),
        remember,
        budget_month: budgetMonth,
      });
      if (months.main) writePref(countInValue === next ? "next" : "same");
      onDone({ ...res, month: budgetMonth ?? months.main ?? localToday().slice(0, 7) });
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
  const first = rows.length ? rows.reduce((a, r) => (r.date < a ? r.date : a), rows[0].date) : "";
  const last = rows.length ? rows.reduce((a, r) => (r.date > a ? r.date : a), rows[0].date) : "";
  const rangeText = !rows.length ? "" : first === last ? shortDate(first) : `${shortDate(first)} – ${shortDate(last)}`;
  const countParts = counts ? [
    `${counts.new} new`,
    counts.duplicates ? `${counts.duplicates} already added` : "",
    counts.transfers ? `${counts.transfers} card payment${counts.transfers === 1 ? "" : "s"} skipped` : "",
  ].filter(Boolean) : [];

  const chip = (value: string | null, title: string, sub: string) => {
    const on = value === countInValue;
    return (
      <button type="button" aria-pressed={on} onClick={() => setCountIn(value)}
              className={`flex-1 min-w-0 min-h-12 px-3 py-1.5 rounded-xl border text-left focus-visible:outline-2 focus-visible:outline-up
                          ${on ? "border-up bg-up/10" : "border-edge2 hover:bg-panel2"}`}>
        <span className="block text-[13px] font-semibold text-txt">{title}</span>
        <span className="block text-[11px] text-dim truncate">{sub}</span>
      </button>
    );
  };

  const sheet = (
    <div className="fixed inset-0 z-[85] bg-black/60 flex items-end sm:items-center justify-center"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="import-title"
           className="bg-bg sm:bg-panel w-full sm:max-w-2xl h-[100dvh] sm:h-[90vh] sm:rounded-2xl sm:border sm:border-edge
                      flex flex-col overflow-hidden pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-edge">
          <h2 id="import-title" className="flex-1 text-base font-extrabold text-txt">Import transactions</h2>
          <button ref={closeRef} onClick={onClose} aria-label="Close"
                  className="h-10 w-10 -mr-2 flex items-center justify-center rounded-full text-dim hover:bg-panel2
                             focus-visible:outline-2 focus-visible:outline-up">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="p-4 space-y-3">
            {!rows.length && (
              <p className="text-[12px] text-dim leading-snug">
                Add screenshots of your card&apos;s transactions, or a statement (CSV, OFX, QFX or PDF).
                You&apos;ll check everything before it&apos;s saved.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <label className="btn btn-primary !min-h-10 cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-up">
                <Camera size={14} />Screenshots
                <input type="file" accept="image/*" multiple className="sr-only" onChange={pickShots} />
              </label>
              <label className="btn !min-h-10 cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-up">
                <FileUp size={14} />Statement
                <input type="file" accept=".csv,.ofx,.qfx,.pdf,.txt,text/csv,application/pdf,text/plain" className="sr-only" onChange={pickFile} />
              </label>
              {(shots || file) && <span className="text-[12px] text-dim truncate min-w-0 flex-1">{shots ?? file?.name}</span>}
            </div>
            {file && !shots && flip !== null && (
              <label className="flex items-center gap-3 min-h-10 text-[13px] text-txt cursor-pointer">
                <input type="checkbox" className="h-5 w-5 accent-up shrink-0" checked={flip}
                       onChange={(e) => toggleFlip(e.target.checked)} />
                <span className="min-w-0">
                  Charges are listed as positive numbers
                  {autoFlip && <span className="block text-[11px] text-dim">Most card statements do this, so I turned it on.</span>}
                </span>
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

            {counts && !busy && (
              <div className="text-[13px] text-txt tabular-nums">
                <b>{countParts[0]}</b>{countParts.slice(1).map((p) => <span key={p}> · {p}</span>)}
                {rangeText && <span className="block text-[11px] text-dim">{rangeText}</span>}
              </div>
            )}
            {shots && rows.length > 0 && !busy && (
              <p className="text-[12px] text-dim">Screenshots can misread a letter or digit, so check names and amounts.</p>
            )}
            {guessedCount > 0 && !busy && (
              <p className="text-[12px] text-amber bg-panel2 border border-edge rounded-lg px-3 py-2">
                {guessedCount === 1 ? "1 transaction had no date" : `${guessedCount} transactions had no date`}, so
                {guessedCount === 1 ? " it's" : " they're"} set to today. Check the dates marked below.
              </p>
            )}

            {months.main && !busy && (
              <fieldset className="space-y-1.5">
                <legend className="text-[12px] font-semibold text-txt">Count in budget for</legend>
                <div className="flex gap-2">
                  {multi
                    ? chip(null, "Purchase dates", `${monthLabel(months.list[0], { bare: true })} – ${monthLabel(months.list[months.list.length - 1])}`)
                    : chip(months.main, monthLabel(months.main), "When you bought")}
                  {multi && chip(months.main, monthLabel(months.main), "All in one month")}
                  {next && chip(next, monthLabel(next), "When you pay the card")}
                </div>
                <p className="text-[11px] text-dim">Purchase dates stay as they are either way.</p>
              </fieldset>
            )}

            {changedList.length > 0 && (
              <div className="rounded-lg border border-edge bg-panel2 p-3 space-y-1">
                <div className="text-[12px] font-semibold text-txt">Remember these choices?</div>
                {changedList.map(([merchant, v]) => (
                  <label key={merchant} className="flex items-center gap-3 min-h-10 text-[13px] text-txt cursor-pointer">
                    <input type="checkbox" className="h-5 w-5 accent-up shrink-0" checked={v.remember}
                           onChange={(e) => setChanged((c) => ({ ...c, [merchant]: { ...v, remember: e.target.checked } }))} />
                    <span className="min-w-0">Always file <b className="break-words">{merchant}</b> as {catLabel(v.category)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {rows.length > 0 && !busy && (
            <ul className="border-t border-edge">
              {rows.slice(0, shown).map((r, i) => (
                <ImportRow key={r.id} row={r}
                           editable={!!shots}
                           onInclude={(v) => setInclude(i, v)}
                           onCategory={(c) => setCategory(i, c)}
                           onEdit={(patch) => editRow(r.id, patch)} />
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
              <span className="flex-1">Your category rules <span className="text-faint font-normal tabular-nums">({rules.length})</span></span>
              <ChevronDown size={16} className={`text-faint transition-transform ${rulesOpen ? "" : "-rotate-90"}`} />
            </button>
            {rulesOpen && (
              <div className="px-4 pb-3">
                {rules.length === 0 ? (
                  <p className="text-[12px] text-dim">
                    No rules yet. When you change a category here, I can remember it for next time.
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
            {saving ? "Importing…" : !selected.length ? "Import" : (
              <span className="truncate">
                Add <span className="tabular-nums">{selected.length}</span>
                {countInValue && !sameMonth(countInValue) ? ` to ${monthLabel(countInValue, { bare: true })}` : selected.length === 1 ? " transaction" : " transactions"}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document === "undefined" ? null : createPortal(sheet, document.body);
}
