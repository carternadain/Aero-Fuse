"use client";

// In-app replacements for window.prompt / window.confirm. Browser dialogs are
// silently blocked in some contexts (installed home-screen apps, embedded
// browsers), which made "tap to edit" look broken. Mount <DialogHost /> once.

import { useEffect, useRef, useState } from "react";

type Req =
  | { kind: "text"; message: string; initial: string; resolve: (v: string | null) => void }
  | { kind: "confirm"; message: string; danger: boolean; resolve: (v: boolean) => void };

let push: ((r: Req) => void) | null = null;

export function askText(message: string, initial = ""): Promise<string | null> {
  return new Promise((resolve) => {
    if (!push) return resolve(window.prompt(message, initial));
    push({ kind: "text", message, initial, resolve });
  });
}

export function askConfirm(message: string, danger = true): Promise<boolean> {
  return new Promise((resolve) => {
    if (!push) return resolve(window.confirm(message));
    push({ kind: "confirm", message, danger, resolve });
  });
}

export default function DialogHost() {
  const [req, setReq] = useState<Req | null>(null);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    push = (r) => {
      setReq(r);
      if (r.kind === "text") setText(r.initial);
    };
    return () => { push = null; };
  }, []);

  useEffect(() => {
    if (req?.kind === "text") setTimeout(() => inputRef.current?.select(), 0);
  }, [req]);

  if (!req) return null;

  const close = (ok: boolean) => {
    if (req.kind === "text") req.resolve(ok ? text : null);
    else req.resolve(ok);
    setReq(null);
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/55 p-3"
         onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }}>
      <form
        className="panel w-full max-w-sm p-4 space-y-3 mb-[env(safe-area-inset-bottom)]"
        onSubmit={(e) => { e.preventDefault(); close(true); }}
        onKeyDown={(e) => { if (e.key === "Escape") close(false); }}
      >
        <p className="text-sm text-txt leading-snug">{req.message}</p>
        {req.kind === "text" && (
          <input ref={inputRef} className="field !py-2.5 !text-sm" value={text} inputMode="decimal"
                 onChange={(e) => setText(e.target.value)} />
        )}
        <div className="flex gap-2">
          <button type="submit" autoFocus={req.kind === "confirm"}
                  className={`btn flex-1 ${req.kind === "confirm" && req.danger ? "!bg-down !border-down !text-bg" : "btn-primary"}`}>
            {req.kind === "confirm" ? (req.danger ? "Yes, remove" : "Yes") : "Save"}
          </button>
          <button type="button" className="btn flex-1" onClick={() => close(false)}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
