"use client";

// ⓘ button that opens an explanation: a bottom sheet on phones (drag handle, swipe down or tap
// the backdrop to close), a centered dialog on desktop. Portalled to <body> so no transformed
// ancestor (tab-enter) can capture its fixed positioning.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info, X } from "lucide-react";

export default function InfoTip({ topic, title, children, className = "" }: {
  topic: string;
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const id = useId();

  const close = useCallback(() => { setOpen(false); setDrag(0); startY.current = null; }, []);

  useEffect(() => {
    if (!open) return;
    const btn = btnRef.current;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
      else if (e.key === "Tab") {
        const els = sheetRef.current?.querySelectorAll<HTMLElement>("button, a[href], [tabindex]:not([tabindex='-1'])");
        if (!els?.length) return;
        const first = els[0], last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      btn?.focus();
    };
  }, [open, close]);

  return (
    <>
      <button ref={btnRef} type="button" onClick={(e) => { e.stopPropagation(); setOpen(true); }}
              aria-label={`About ${topic}`} aria-haspopup="dialog" aria-expanded={open}
              className={`icon-btn inline-flex items-center text-faint hover:text-txt focus-visible:outline-2 focus-visible:outline-up rounded-full transition-colors ${className}`}>
        <Info size={14} />
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center bg-black/55 sm:p-4 infotip-backdrop"
             onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}
               style={drag ? { transform: `translateY(${drag}px)`, transition: "none" } : undefined}
               className="infotip-sheet panel w-full sm:max-w-md max-h-[80dvh] overflow-y-auto overscroll-contain rounded-b-none sm:rounded-b-[inherit] pb-[max(16px,env(safe-area-inset-bottom))] outline-none">
            <div className="sm:hidden flex justify-center pt-2 pb-1 touch-none"
                 onTouchStart={(e) => { startY.current = e.touches[0].clientY; }}
                 onTouchMove={(e) => { if (startY.current != null) setDrag(Math.max(0, e.touches[0].clientY - startY.current)); }}
                 onTouchEnd={() => { if (drag > 80) close(); else setDrag(0); startY.current = null; }}>
              <span className="h-1 w-9 rounded-full bg-edge2" />
            </div>
            <div className="flex items-center justify-between gap-2 px-4 pt-2 sm:pt-3">
              <h3 id={id} className="text-[14px] font-bold text-txt first-letter:uppercase">{title ?? topic}</h3>
              <button type="button" onClick={close} aria-label="Close" className="icon-btn text-dim hover:text-txt focus-visible:outline-2 focus-visible:outline-up rounded"><X size={16} /></button>
            </div>
            <div className="px-4 pt-2 pb-2 text-[13px] text-dim leading-relaxed space-y-2">{children}</div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
