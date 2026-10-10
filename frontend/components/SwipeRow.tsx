"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import { haptic, toast } from "@/lib/bus";

const ACTION_W = 88; // px of red Delete revealed by a swipe
const OPEN_AT = 40; // drag past this and it snaps open
const FULL_AT = 0.6; // drag past this share of the row and release deletes outright

/**
 * A list row you can delete without a permanent button. Touch: swipe left to reveal
 * Delete (swipe all the way to delete at once). Mouse: a × appears on hover or
 * keyboard focus. `onDelete` should hide the row; pair it with `deferDelete` for Undo.
 */
export default function SwipeRow({ children, onDelete, label = "Delete", className = "" }: {
  children: React.ReactNode; onDelete: () => void; label?: string; className?: string;
}) {
  const [x, setX] = useState(0);
  const [drag, setDrag] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const st = useRef({ id: -1, sx: 0, sy: 0, base: 0, swiping: false, moved: false, wasOpen: false, w: 320 });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // After a delete the row usually unmounts. If it stays (delete failed, or the list keeps it),
  // slide it back instead of leaving it stuck open.
  const deleted = () => {
    haptic(12);
    onDelete();
    setTimeout(() => { if (alive.current) setX(0); }, 400);
  };

  // Tapping anywhere else closes an open row.
  useEffect(() => {
    if (x === 0) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setX(0); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [x]);

  const down = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    const s = st.current;
    s.id = e.pointerId; s.sx = e.clientX; s.sy = e.clientY; s.base = x; s.swiping = false; s.moved = false;
    s.wasOpen = x !== 0; // a tap on an open row closes it instead of opening whatever was tapped
    s.w = root.current?.offsetWidth ?? 320;
  };
  const move = (e: React.PointerEvent) => {
    const s = st.current;
    if (e.pointerId !== s.id) return;
    const dx = e.clientX - s.sx, dy = e.clientY - s.sy;
    if (!s.swiping) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) { s.id = -1; return; } // a scroll, not a swipe
      s.swiping = true; s.moved = true; setDrag(true);
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    setX(Math.max(-s.w, Math.min(0, s.base + dx)));
  };
  const up = (e: React.PointerEvent) => {
    const s = st.current;
    if (e.pointerId !== s.id) return;
    s.id = -1;
    if (!s.swiping) return;
    setDrag(false);
    if (-x > s.w * FULL_AT) { setX(-s.w); deleted(); return; }
    setX(-x > OPEN_AT ? -ACTION_W : 0);
  };

  const open = x < 0;
  return (
    <div ref={root} data-noswipe className="relative overflow-hidden group/swipe">
      <button type="button" tabIndex={open ? 0 : -1} aria-hidden={!open}
              className="absolute inset-y-0 right-0 flex items-center justify-center gap-1.5 bg-down text-on-up text-[12px] font-bold focus-visible:outline-2 focus-visible:outline-txt"
              style={{ width: ACTION_W }} aria-label={label} onClick={deleted}>
        <Trash2 size={14} aria-hidden />Delete
      </button>
      <div
        className={`relative bg-panel touch-pan-y ${drag ? "" : "transition-transform duration-200 ease-out motion-reduce:transition-none"} ${className}`}
        style={{ transform: x ? `translateX(${x}px)` : undefined }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onClickCapture={(e) => {
          const s = st.current;
          if (s.moved || s.wasOpen) {
            e.preventDefault(); e.stopPropagation();
            if (s.wasOpen && !s.moved) setX(0);
            s.moved = false; s.wasOpen = false;
          }
        }}>
        {children}
        <button type="button" aria-label={label} onClick={onDelete}
                className="icon-btn shrink-0 h-10 w-10 justify-center focus-visible:outline-2 focus-visible:outline-up
                           [@media(hover:none)]:hidden opacity-0 group-hover/swipe:opacity-100 focus-visible:opacity-100 transition-opacity">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

/**
 * Delete with Undo: hide the row now, really delete after a few seconds unless Undo is tapped.
 * `hide`/`restore` flip the row's visibility; `commit` performs the API delete.
 */
export function deferDelete({ message, hide, restore, commit, ms = 5500 }: {
  message: string; hide: () => void; restore: () => void; commit: () => Promise<unknown> | void; ms?: number;
}) {
  hide();
  const t = setTimeout(() => { Promise.resolve(commit()).catch(restore); }, ms);
  toast(message, { label: "Undo", run: () => { clearTimeout(t); restore(); } });
}
