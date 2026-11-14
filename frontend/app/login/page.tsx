"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Eye, EyeOff, Fingerprint, Loader2, Lock } from "lucide-react";
import AeroMark from "@/components/AeroMark";
import { passkeyName, passkeysSupported, signInWithPasskey, wasCancelled } from "@/lib/passkey";

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? "Still up?" : h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening.";
}

export default function Login() {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [error, setError] = useState("");
  const [shake, setShake] = useState(0);          // bumps on each failure so the nudge replays
  const [busy, setBusy] = useState<"password" | "passkey" | null>(null);
  const [done, setDone] = useState(false);        // signed in, on the way to the app
  const [passkey, setPasskey] = useState<string | null>(null); // button label once a passkey exists for this site
  const [hello, setHello] = useState("Welcome back."); // time of day is only known in the browser
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setHello(greeting());
    if (!passkeysSupported()) return;
    fetch("/api/auth/passkey/status", { cache: "no-store" }).then((r) => r.json())
      .then((s) => { if (s.registered) setPasskey(passkeyName()); }).catch(() => {});
  }, []);

  const enter = () => {
    setDone(true);
    // a beat for the check mark to land; skipped when motion is reduced
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(() => { window.location.href = "/"; }, still ? 0 : 420);
  };
  const fail = (msg: string) => {
    setError(msg);
    setShake((n) => n + 1);
    setBusy(null);
  };

  const usePasskey = async () => {
    setBusy("passkey");
    setError("");
    try {
      await signInWithPasskey();
      enter();
    } catch (e) {
      if (wasCancelled(e)) setBusy(null);
      else fail(e instanceof Error ? e.message : "Sign-in failed");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy || done) return;
    setBusy("password");
    setError("");
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (r.ok) { enter(); return; }
      const body = await r.json().catch(() => ({}));
      fail(body.detail || "Sign-in failed");
    } catch {
      fail("Can't reach the server. Check your connection and try again.");
    }
    setPassword("");
    field.current?.focus();
  };

  const working = busy != null || done;

  return (
    <main className="login relative min-h-dvh overflow-hidden flex items-center justify-center px-5 py-10">
      {/* Ambient light: three soft color fields from the theme, drifting slowly. Decorative only. */}
      <div className="login-aurora" aria-hidden="true"><span /><span /><span /></div>
      {/* A quiet rising line along the bottom, drawn once. */}
      <svg className="login-line" viewBox="0 0 1200 220" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 190 C 120 180, 170 120, 260 138 S 400 176, 480 120 S 620 66, 700 96 S 840 150, 930 78 S 1090 20, 1200 34" />
      </svg>

      <form onSubmit={submit} className="relative w-full max-w-[360px]" aria-busy={working}>
        <div className="login-rise flex flex-col items-center text-center" style={{ animationDelay: "0ms" }}>
          <div className="login-mark grid place-items-center w-[72px] h-[72px] rounded-[22px] bg-panel border border-edge2/70 text-txt shadow-[0_14px_40px_var(--color-shade-float)]">
            <AeroMark size={34} />
          </div>
          <h1 className="font-display text-[30px] leading-none text-txt mt-6">{hello}</h1>
          <p className="text-[14px] text-dim mt-2.5">Sign in to see where things stand.</p>
        </div>

        {/* the two shake classes are the same motion under two names: swapping names replays it without remounting (which would drop focus) */}
        <div className={`mt-7 rounded-3xl border border-edge2/60 bg-panel/70 backdrop-blur-xl p-4 shadow-[0_18px_50px_var(--color-shade-float)] ${
               shake === 0 ? "login-rise" : shake % 2 ? "login-shake" : "login-shake-b"}`}
             style={{ animationDelay: shake ? "0ms" : "70ms" }}>
          {passkey && (
            <>
              <button type="button" onClick={usePasskey} disabled={working}
                      className="btn btn-primary w-full !rounded-2xl !py-3.5 !text-[15px] min-h-12 disabled:opacity-70">
                {busy === "passkey" ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Fingerprint size={18} aria-hidden="true" />}
                {busy === "passkey" ? "Waiting for your device…" : `Sign in with ${passkey}`}
              </button>
              <div className="flex items-center gap-3 my-4 text-[12px] text-faint" aria-hidden="true">
                <span className="flex-1 border-t border-edge" />or use your password<span className="flex-1 border-t border-edge" />
              </div>
            </>
          )}

          <div className="relative">
            <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-faint pointer-events-none" aria-hidden="true" />
            <input
              ref={field}
              className="field !rounded-2xl !pl-11 !pr-12 !py-3.5 !text-base min-h-12"
              aria-label="Password"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "login-error" : caps ? "login-caps" : undefined}
              type={show ? "text" : "password"}
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              placeholder="Password"
              value={password}
              disabled={done}
              onChange={(e) => { setPassword(e.target.value); if (error) setError(""); }}
              onKeyUp={(e) => setCaps(e.getModifierState?.("CapsLock") ?? false)}
              onBlur={() => setCaps(false)}
            />
            <button type="button" onClick={() => { setShow((s) => !s); field.current?.focus(); }} aria-pressed={show}
                    aria-label={show ? "Hide password" : "Show password"}
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 grid place-items-center rounded-full text-dim hover:text-txt focus-visible:outline-2 focus-visible:outline-cyan">
              {show ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
            </button>
          </div>

          {/* one line that is always there, so the card doesn't jump when a message appears */}
          <div className="min-h-[22px] mt-2 px-1 text-[12.5px]">
            {error ? <p id="login-error" role="alert" className="text-down">{error}</p>
              : caps ? <p id="login-caps" className="text-warn">Caps Lock is on.</p> : null}
          </div>

          <button type="submit" disabled={working || !password}
                  className={`btn ${passkey ? "" : "btn-primary"} w-full !rounded-2xl !py-3.5 !text-[15px] min-h-12 mt-1 disabled:opacity-60 disabled:cursor-default`}>
            {done ? <><Check size={18} className="login-pop" aria-hidden="true" />Welcome back</>
              : busy === "password" ? <><Loader2 size={18} className="animate-spin" aria-hidden="true" />Signing in…</>
              : <>Sign in<ArrowRight size={17} aria-hidden="true" /></>}
          </button>
        </div>

        <p className="login-rise mt-6 flex items-center justify-center gap-1.5 text-[12px] text-faint" style={{ animationDelay: "140ms" }}>
          <Lock size={11} aria-hidden="true" /> Private. Only you can sign in here.
        </p>
      </form>
    </main>
  );
}
