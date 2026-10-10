"use client";

import { useState } from "react";
import { ALL_CATS, catLabel } from "@/lib/categories";
import { fmtCents } from "@/lib/privacy";

export interface PreviewRow {
  date: string; description: string; merchant: string; amount: number;
  kind: "income" | "expense"; category: string; transfer: boolean; duplicate: boolean;
  hash: string | null;
  /** a merchant refund: files as negative spending in its category */
  refund?: boolean;
}
export interface Row extends PreviewRow { id: number; include: boolean; edited?: boolean }

export const shortDate = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
};

const li = (include: boolean) =>
  `flex flex-wrap sm:flex-nowrap items-center gap-x-2 gap-y-1 px-3 py-1.5 border-b border-edge ${include ? "" : "opacity-60"}`;

function Flags({ r, bare }: { r: Row; bare?: boolean }) {
  const sep = bare ? "" : " · ";
  return (
    <>
      {r.duplicate && <span className="text-amber">{sep}already imported</span>}
      {r.transfer && !r.duplicate && <span className="text-cyan">{sep}transfer</span>}
      {r.refund && !r.duplicate && <span className="text-up">{sep}refund</span>}
    </>
  );
}

interface Props {
  row: Row;
  onInclude: (v: boolean) => void;
  onCategory: (c: string) => void;
  /** screenshot mode: merchant, amount and date can be corrected */
  onEdit?: (patch: Partial<Pick<Row, "merchant" | "amount" | "date">>) => void;
}

export default function ImportRow({ row: r, onInclude, onCategory, onEdit }: Props) {
  const [amountText, setAmountText] = useState(() => Math.abs(r.amount).toFixed(2));
  const positive = r.kind === "income" || r.refund;

  const categoryField = (
    <select className="field !h-10 !text-[13px]" value={r.category}
            aria-label={`Category for ${r.merchant}`} onChange={(e) => onCategory(e.target.value)}>
      {ALL_CATS.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
    </select>
  );
  const check = (
    <label className="h-10 w-10 flex items-center justify-center shrink-0 cursor-pointer">
      <input type="checkbox" className="h-5 w-5 accent-up" checked={r.include}
             aria-label={`Include ${r.merchant}`} onChange={(e) => onInclude(e.target.checked)} />
    </label>
  );

  if (!onEdit) {
    return (
      <li className={li(r.include)}>
        {check}
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-txt truncate">{r.merchant}</div>
          <div className="text-[11px] text-faint truncate">
            <span className="tabular-nums">{shortDate(r.date)}</span>
            <Flags r={r} />
          </div>
        </div>
        <div className={`ml-auto shrink-0 text-[13px] font-bold tabular-nums ${positive ? "text-up" : "text-down"}`}>
          {positive ? "+" : "−"}{fmtCents(Math.abs(r.amount))}
        </div>
        <div className="w-full sm:w-36 shrink-0">{categoryField}</div>
      </li>
    );
  }

  const onAmount = (text: string) => {
    setAmountText(text);
    const v = Number(text.replace(/[$,\s]/g, ""));
    if (text.trim() && Number.isFinite(v) && v >= 0) onEdit({ amount: Math.sign(r.amount || 1) * v });
  };

  return (
    <li className={`px-3 py-2 border-b border-edge space-y-1.5 ${r.include ? "" : "opacity-60"}`}>
      <div className="flex items-center gap-2">
        {check}
        <input className="field !h-10 !text-[13px] font-semibold min-w-0 flex-1" value={r.merchant}
               aria-label="Merchant" onChange={(e) => onEdit({ merchant: e.target.value })} />
        <label className="relative w-28 shrink-0">
          <span aria-hidden className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] font-bold ${positive ? "text-up" : "text-down"}`}>
            {positive ? "+$" : "−$"}
          </span>
          <input inputMode="decimal" className="field !h-10 !text-[13px] !pl-8 text-right tabular-nums font-bold"
                 value={amountText} aria-label={`Amount for ${r.merchant}`}
                 onChange={(e) => onAmount(e.target.value)} />
        </label>
      </div>
      <div className="flex items-center gap-2 pl-12">
        <input type="date" className="field !h-10 !text-[13px] tabular-nums min-w-0 flex-1" value={r.date}
               aria-label={`Date for ${r.merchant}`}
               onChange={(e) => { if (e.target.value) onEdit({ date: e.target.value }); }} />
        <div className="min-w-0 flex-1">{categoryField}</div>
      </div>
      {(r.duplicate || r.transfer || r.refund) && (
        <div className="pl-12 text-[11px] text-faint"><Flags r={r} bare /></div>
      )}
    </li>
  );
}
