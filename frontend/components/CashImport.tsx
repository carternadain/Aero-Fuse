"use client";

// Import a plan file: a JSON file with your accounts, paychecks, bills and recurring buys.
// Preview first, untick anything you don't want, then add. Your numbers live in your own file.

import { useRef, useState } from "react";
import { Check, FileUp } from "lucide-react";
import { api } from "@/lib/api";
import { haptic } from "@/lib/bus";
import { apiError, FieldError, Sheet, type CashPayload } from "./cashShared";

type Status = "new" | "exists" | "update";
interface Row { key: string; section: string; label: string; detail: string; status: Status }
interface Preview { rows: Row[]; errors: string[] }

const CHIP: Record<Status, { text: string; cls: string }> = {
  new: { text: "New", cls: "bg-up/15 text-up" },
  update: { text: "Update", cls: "bg-amber/15 text-amber" },
  exists: { text: "Already there", cls: "bg-panel2 text-dim" },
};
const sectionLabel = (s: string) => {
  if (s === "autoinvest") return "Auto-invest";
  const t = s.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const COUNT_WORD: Record<string, [string, string]> = {
  accounts: ["account", "accounts"], items: ["plan item", "plan items"], autoinvest: ["recurring buy", "recurring buys"],
  contributions: ["contribution", "contributions"], goals: ["goal", "goals"], updated: ["update", "updates"],
};

export default function CashImport({ onClose, onDone }: { onClose: () => void; onDone: (p: CashPayload) => void }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ created: Record<string, number>; cash: CashPayload } | null>(null);
  const plan = useRef<unknown>(null);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    try { setText(await file.text()); setFileName(file.name); } catch { setErr("Couldn't read that file."); }
  };

  const runPreview = async () => {
    setErr(null);
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { setErr("That doesn't look like a plan file. It should be JSON."); return; }
    plan.current = parsed;
    setBusy(true);
    try {
      const p = await api.post<Preview>("/api/cash/import/preview", { plan: parsed });
      setPreview(p);
      setPicked(new Set(p.rows.filter((r) => r.status !== "exists").map((r) => r.key)));
    } catch (e) { setErr(apiError(e)); }
    setBusy(false);
  };

  const run = async () => {
    if (!preview || busy) return;
    setBusy(true); setErr(null);
    try {
      const skip = preview.rows.filter((r) => !picked.has(r.key)).map((r) => r.key);
      const res = await api.post<{ created: Record<string, number>; cash: CashPayload }>("/api/cash/import", { plan: plan.current, skip });
      haptic();
      setDone(res);
    } catch (e) { setErr(apiError(e)); }
    setBusy(false);
  };

  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  // ── done ──
  if (done) {
    const parts = Object.entries(done.created).filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${(COUNT_WORD[k] ?? [k, k])[n === 1 ? 0 : 1]}`);
    return (
      <Sheet title="All set" onClose={() => onDone(done.cash)}>
        <div className="px-4 space-y-4">
          <div className="flex items-start gap-3">
            <span className="shrink-0 size-9 rounded-full flex items-center justify-center bg-up/15 text-up"><Check size={18} strokeWidth={2.6} /></span>
            <p className="text-[14px] text-txt leading-snug pt-1.5">{parts.length ? `Added ${parts.join(", ")}.` : "Nothing new to add. Your plan is already up to date."}</p>
          </div>
          <button className="btn btn-primary w-full !min-h-11 !text-[15px]" onClick={() => onDone(done.cash)}>Done</button>
        </div>
      </Sheet>
    );
  }

  // ── preview ──
  if (preview) {
    const sections = Array.from(new Set(preview.rows.map((r) => r.section)));
    const n = picked.size;
    return (
      <Sheet title="Check before adding" onClose={onClose} wide>
        <div className="px-4 space-y-4">
          {preview.errors.length > 0 && (
            <div role="alert" className="rounded-xl border border-down/50 p-3 space-y-1">
              <p className="text-[13px] font-semibold text-down">Fix these in your file first</p>
              <ul className="text-[13px] text-txt leading-snug list-disc pl-4 space-y-0.5">
                {preview.errors.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          )}
          {preview.rows.length === 0 && preview.errors.length === 0 && <p className="text-[14px] text-dim">That file has nothing in it to add.</p>}
          {sections.map((s) => (
            <div key={s}>
              <h3 className="text-[12px] font-semibold text-dim pb-1.5">{sectionLabel(s)}</h3>
              <ul className="rounded-xl border border-edge divide-y divide-edge overflow-hidden">
                {preview.rows.filter((r) => r.section === s).map((r) => {
                  const off = r.status === "exists";
                  const id = `imp-${r.key}`;
                  return (
                    <li key={r.key}>
                      <label htmlFor={id} className={`flex items-center gap-3 px-3 min-h-[52px] py-2 ${off ? "opacity-70" : "cursor-pointer active:bg-panel2"}`}>
                        <input id={id} type="checkbox" className="size-5 shrink-0 accent-[var(--color-up)] focus-visible:outline-2 focus-visible:outline-cyan"
                               checked={picked.has(r.key)} disabled={off} onChange={() => toggle(r.key)} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-[14px] font-semibold text-txt truncate">{r.label}</span>
                          {r.detail && <span className="block text-[12px] text-dim truncate tabular-nums">{r.detail}</span>}
                        </span>
                        <span className={`shrink-0 text-[11px] font-bold rounded px-1.5 py-0.5 ${CHIP[r.status].cls}`}>{CHIP[r.status].text}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <FieldError msg={err} />
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <button className="btn !min-h-11" onClick={() => { setPreview(null); setErr(null); }}>Back</button>
            <button className="btn btn-primary !min-h-11 !text-[15px] disabled:opacity-40" disabled={busy || n === 0 || preview.errors.length > 0} onClick={run}>
              {busy ? "Adding…" : n === 0 ? "Nothing to add" : `Add ${n} ${n === 1 ? "item" : "items"}`}
            </button>
          </div>
        </div>
      </Sheet>
    );
  }

  // ── choose ──
  return (
    <Sheet title="Import a plan file" onClose={onClose}>
      <form className="px-4 space-y-4" onSubmit={(e) => { e.preventDefault(); runPreview(); }}>
        <p className="text-[13px] text-dim leading-snug">
          Bring in your accounts, paychecks, bills and recurring buys from a plan file. You&apos;ll see everything before it&apos;s added.
        </p>
        <label className="flex items-center justify-center gap-2 min-h-12 rounded-xl border border-dashed border-edge2 text-[14px] font-semibold text-txt cursor-pointer hover:bg-panel2/60 focus-within:outline-2 focus-within:outline-cyan">
          <FileUp size={16} aria-hidden />
          <span className="truncate">{fileName ?? "Choose a .json file"}</span>
          <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => readFile(e.target.files?.[0])} />
        </label>
        <label className="field-wrap">
          <span className="field-label">Or paste it here</span>
          <textarea className="field font-mono !text-[12px] min-h-28 resize-y" spellCheck={false} autoComplete="off"
                    value={text} onChange={(e) => { setText(e.target.value); setFileName(null); }} placeholder='{ "version": 1, ... }' />
        </label>
        <FieldError msg={err} />
        <button type="submit" disabled={busy || !text.trim()} className="btn btn-primary w-full !min-h-11 !text-[15px] disabled:opacity-40">
          {busy ? "Checking…" : "Preview"}
        </button>
      </form>
    </Sheet>
  );
}
