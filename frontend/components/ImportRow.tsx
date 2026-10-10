"use client";

import { useState } from "react";
import { ALL_CATS, catLabel, dayLabel } from "@/lib/categories";
import { fmtCents } from "@/lib/privacy";

export interface PreviewRow {
  date: string; description: string; merchant: string; amount: number;
  kind: "income" | "expense"; category: string; transfer: boolean; duplicate: boolean;
  hash: string | null;
  /** a merchant refund: files as negative spending in its category */
  refund?: boolean;
  /** no date was found for this row, so today was used */
  date_guessed?: boolean;
}
export interface Row extends PreviewRow { id: number; include: boolean; edited?: boolean }

/** "Sep 14" (adds the year when it isn't this year). */
export const shortDate = dayLabel;

function Flags({ r, bare }: { r: Row; bare?: boolean }) {
  const sep = bare ? "" : " · ";
  return (
    <>
      {r.duplicate && <span className="text-amber">{sep}already added</span>}
      {r.transfer && !r.duplicate && <span className="text-cyan">{sep}card payment, skipped</span>}
      {r.refund && !r.duplicate && <span className="text-up">{sep}refund</span>}
      {r.kind === "income" && !r.transfer && !r.duplicate && <span className="text-up">{sep}income</span>}
    </>
  );
}

interface Props {
  row: Row;
  onInclude: (v: boolean) => void;
  onCategory: (c: string) => void;
  /** merchant, amount and date can be corrected (always for screenshots; dates when none was found) */
  onEdit?: (patch: Partial<Pick<Row, "merchant" | "amount" | "date" | "date_guessed">>) => void;
  /** screenshot mode: every field is editable */
  editable?: boolean;
}

export default function ImportRow({ row: r, onInclude, onCategory, onEdit, editable }: Props) {
  const [amountText, setAmountText] = useState(() => Math.abs(r.amount).toFixed(2));
  const positive = r.kind === "income" || r.refund;
  const guessed = !!r.date_guessed;

  const categoryField = (
    <select className="field !h-10 !text-[13px]" value={r.category}
            aria-label={`Category for ${r.merchant}`} onChange={(e) => onCategory(e.target.value)}>
      {ALL_CATS.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
    </select>
  );
  const check = (
    <label className="h-10 w-10 -ml-1 flex items-center justify-center shrink-0 cursor-pointer">
      <input type="checkbox" className="h-5 w-5 accent-up" checked={r.include}
             aria-label={`Include ${r.merchant}`} onChange={(e) => onInclude(e.target.checked)} />
    </label>
  );
  const dateField = onEdit && (
    <input type="date" className={`field !h-10 !text-[13px] tabular-nums min-w-0 flex-1 ${guessed ? "!border-amber" : ""}`}
           value={r.date} aria-label={`Date for ${r.merchant}`}
           aria-describedby={guessed ? `nodate-${r.id}` : undefined}
           onChange={(e) => { if (e.target.value) onEdit({ date: e.target.value, date_guessed: false }); }} />
  );
  const noDate = guessed && (
    <p id={`nodate-${r.id}`} className="pl-10 text-[11px] text-amber">No date found, so it&apos;s set to today. Fix it if that&apos;s wrong.</p>
  );

  if (!editable) {
    return (
      <li className={`px-3 py-2 border-b border-edge space-y-1.5 ${r.include ? "" : "opacity-60"}`}>
        <div className="flex items-center gap-2">
          {check}
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-txt truncate">{r.merchant}</div>
            <div className="text-[11px] text-faint truncate">
              <span className={`tabular-nums ${guessed ? "text-amber" : ""}`}>{shortDate(r.date)}</span>
              <Flags r={r} />
            </div>
          </div>
          <div className={`shrink-0 text-[13px] font-bold tabular-nums ${positive ? "text-up" : "text-txt"}`}>
            {positive ? "+" : ""}{fmtCents(Math.abs(r.amount))}
          </div>
          <div className="w-32 sm:w-36 shrink-0 max-[400px]:hidden">{categoryField}</div>
        </div>
        <div className="pl-10 min-[401px]:hidden">{categoryField}</div>
        {guessed && <div className="flex gap-2 pl-10">{dateField}</div>}
        {noDate}
      </li>
    );
  }

  const onAmount = (text: string) => {
    setAmountText(text);
    const v = Number(text.replace(/[$,\s]/g, ""));
    if (text.trim() && Number.isFinite(v) && v > 0) onEdit?.({ amount: Math.sign(r.amount || 1) * v });
  };

  return (
    <li className={`px-3 py-2 border-b border-edge space-y-1.5 ${r.include ? "" : "opacity-60"}`}>
      <div className="flex items-center gap-2">
        {check}
        <input className="field !h-10 !text-[13px] font-semibold min-w-0 flex-1" value={r.merchant}
               aria-label="Merchant" onChange={(e) => onEdit?.({ merchant: e.target.value })} />
        <label className="relative w-28 shrink-0">
          <span aria-hidden className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] font-bold ${positive ? "text-up" : "text-dim"}`}>
            {positive ? "+$" : "$"}
          </span>
          <input inputMode="decimal" className="field !h-10 !text-[13px] !pl-8 text-right tabular-nums font-bold"
                 value={amountText} aria-label={`Amount for ${r.merchant}`}
                 onChange={(e) => onAmount(e.target.value)} />
        </label>
      </div>
      <div className="flex items-center gap-2 pl-10">
        {dateField}
        <div className="min-w-0 flex-1">{categoryField}</div>
      </div>
      {noDate}
      {(r.duplicate || r.transfer || r.refund || r.kind === "income") && (
        <div className="pl-10 text-[11px] text-faint"><Flags r={r} bare /></div>
      )}
    </li>
  );
}
