"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Eye, EyeOff, Fingerprint, Loader2, Lock, ShieldCheck } from "lucide-react";
import AeroMark from "@/components/AeroMark";
import { passkeyName, passkeysSupported, signInWithPasskey, wasCancelled } from "@/lib/passkey";

function greeting(h: number): string {
  return h < 5 ? "Still up?" : h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening.";
}

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

// Decorative only: an abstract rising line with no numbers, so nothing private shows before sign-in.
const PREVIEW_LINE = "M0 96 C 22 92, 34 70, 52 74 S 80 92, 98 70 S 126 40, 144 52 S 172 66, 190 38 S 222 14, 240 18";

export default function Login() {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [error, setError] = useState("");
  const [shake, setShake] = useState(0);          // bumps on each failure so the nudge replays
  const [busy, setBusy] = useState<"password" | "passkey" | null>(null);
  const [done, setDone] = useState(false);        // signed in, on the way to the app
  const [passkey, setPasskey] = useState<string | null>(null); // button label once a passkey exists for this site
  const [now, setNow] = useState<Date | null>(null); // time is only known in the browser
  const field = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNow(new Date());
    const tick = setInterval(() => setNow(new Date()), 15_000);
    if (passkeysSupported()) {
      fetch("/api/auth/passkey/status", { cache: "no-store" }).then((r) => r.json())
        .then((s) => { if (s.registered) setPasskey(passkeyName()); }).catch(() => {});
    }
    return () => clearInterval(tick);
  }, []);

  // Soft light that follows the pointer across the card. Written straight to CSS
  // variables so moving the mouse never re-renders the form.
  const glow = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || !card.current) return;
    const r = card.current.getBoundingClientRect();
    card.current.style.setProperty("--mx", `${e.clientX - r.left}px`);
    card.current.style.setProperty("--my", `${e.clientY - r.top}px`);
  };

  const enter = () => {
    setDone(true);
    // a beat for the check mark and the fade to land; skipped when motion is reduced
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(() => { window.location.href = "/"; }, still ? 0 : 650);
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
  const hello = now ? greeting(now.getHours()) : "Welcome back.";

  return (
    <main className="login relative min-h-dvh overflow-hidden">
      {/* Ambient light, a fading dot grid and a rising line. Decorative only. */}
      <div className="login-aurora" aria-hidden="true"><span /><span /><span /></div>
      <div className="login-grid" aria-hidden="true" />
      <svg className="login-line" viewBox="0 0 1200 220" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="login-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="login-stop-a" />
            <stop offset="1" className="login-stop-b" />
          </linearGradient>
        </defs>
        <path className="login-area" fill="url(#login-fill)"
              d="M0 190 C 120 180, 170 120, 260 138 S 400 176, 480 120 S 620 66, 700 96 S 840 150, 930 78 S 1090 20, 1200 34 L 1200 220 L 0 220 Z" />
        <path className="login-stroke" d="M0 190 C 120 180, 170 120, 260 138 S 400 176, 480 120 S 620 66, 700 96 S 840 150, 930 78 S 1090 20, 1200 34" />
      </svg>

      <div className="relative mx-auto grid min-h-dvh w-full max-w-[1040px] content-center items-center gap-8 px-5 py-10 sm:px-8 lg:grid-cols-[1fr_400px] lg:gap-16">
        {/* ── Greeting ─────────────────────────────── */}
        <section className="flex flex-col items-center text-center lg:items-start lg:text-left">
          <div className="login-rise flex items-center gap-3" style={{ animationDelay: "0ms" }}>
            <div className="login-mark relative grid place-items-center w-14 h-14 rounded-[18px] bg-panel border border-edge2/70 text-txt">
              <AeroMark size={26} />
            </div>
            <span className="font-display text-[22px] font-semibold tracking-tight text-txt">Aero</span>
          </div>

          <h1 className="login-rise login-hello font-display text-[34px] sm:text-[44px] lg:text-[56px] font-semibold leading-[1.02] tracking-[-0.03em] mt-7 lg:mt-10"
              style={{ animationDelay: "60ms" }}>
            {hello}
          </h1>
          <p className="login-rise text-[15px] sm:text-[16px] text-dim mt-3 max-w-[30ch]" style={{ animationDelay: "110ms" }}>
            Sign in to see where your money stands today.
          </p>
          <p className="login-rise mt-4 inline-flex items-center gap-2 rounded-full border border-edge2/60 bg-panel/60 px-3 py-1.5 text-[12.5px] text-dim tabular-nums backdrop-blur"
             style={{ animationDelay: "150ms" }}>
            <span className="login-live" aria-hidden="true" />
            {/* reserve the width until the browser knows the time, so nothing shifts */}
            <span className={now ? "" : "invisible"}>
              {now ? `${dayFmt.format(now)} · ${timeFmt.format(now)}` : "Wednesday, September 30 · 12:00 PM"}
            </span>
          </p>

          {/* A blurred, number-free preview of the dashboard, desktop only. */}
          <div className="login-preview hidden lg:block mt-12 w-full max-w-[420px]" aria-hidden="true">
            <div className="login-preview-back" />
            <div className="login-preview-card">
              <div className="flex items-center justify-between">
                <span className="h-2.5 w-20 rounded-full bg-edge2/80" />
                <span className="h-5 w-14 rounded-full login-chip" />
              </div>
              <span className="mt-3 block h-6 w-36 rounded-md bg-edge2/70" />
              <svg viewBox="0 0 240 110" className="mt-4 w-full h-[110px] overflow-visible" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="login-preview-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" className="login-stop-a" />
                    <stop offset="1" className="login-stop-b" />
                  </linearGradient>
                </defs>
                <path d={`${PREVIEW_LINE} L 240 110 L 0 110 Z`} fill="url(#login-preview-fill)" className="login-area" />
                <path d={PREVIEW_LINE} className="login-stroke login-stroke-short" />
                <circle cx="240" cy="18" r="4" className="login-dot" />
              </svg>
              <div className="mt-4 grid grid-cols-3 gap-2.5">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="rounded-xl bg-panel2/70 p-2.5">
                    <span className="block h-1.5 w-8 rounded-full bg-edge2" />
                    <span className="mt-2 block h-3 w-12 rounded bg-edge2/80" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Sign-in card ─────────────────────────── */}
        <form onSubmit={submit} className="relative w-full max-w-[400px] mx-auto" aria-busy={working}>
          {/* the two shake classes are the same motion under two names: swapping names replays it without remounting (which would drop focus) */}
          <div ref={card} onPointerMove={glow}
               className={`login-card ${shake === 0 ? "login-rise" : shake % 2 ? "login-shake" : "login-shake-b"}`}
               style={{ animationDelay: shake ? "0ms" : "120ms" }}>
            <div className="login-card-inner p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-[19px] font-semibold tracking-tight text-txt">Sign in</h2>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-up/12 px-2.5 py-1 text-[11.5px] font-medium text-up">
                  <ShieldCheck size={13} aria-hidden="true" /> Private
                </span>
              </div>

              {passkey && (
                <>
                  <button type="button" onClick={usePasskey} disabled={working}
                          className="login-btn login-btn-primary mt-5">
                    {busy === "passkey" ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Fingerprint size={18} aria-hidden="true" />}
                    {busy === "passkey" ? "Waiting for your device…" : `Sign in with ${passkey}`}
                  </button>
                  <div className="flex items-center gap-3 mt-5 text-[12px] text-faint" aria-hidden="true">
                    <span className="flex-1 border-t border-edge" />or use your password<span className="flex-1 border-t border-edge" />
                  </div>
                </>
              )}

              <label htmlFor="login-password" className="block mt-5 mb-2 px-0.5 text-[12.5px] font-medium text-dim">Password</label>
              <div className="login-field relative">
                <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-faint pointer-events-none" aria-hidden="true" />
                <input
                  id="login-password"
                  ref={field}
                  className="w-full min-h-[52px] rounded-2xl bg-transparent pl-11 pr-12 text-base text-txt placeholder:text-faint outline-none"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "login-error" : caps ? "login-caps" : undefined}
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="go"
                  placeholder="Enter your password"
                  value={password}
                  disabled={done}
                  onChange={(e) => { setPassword(e.target.value); if (error) setError(""); }}
                  onKeyUp={(e) => setCaps(e.getModifierState?.("CapsLock") ?? false)}
                  onBlur={() => setCaps(false)}
                />
                <button type="button" onClick={() => { setShow((s) => !s); field.current?.focus(); }} aria-pressed={show}
                        aria-label={show ? "Hide password" : "Show password"}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-10 h-10 grid place-items-center rounded-xl text-dim hover:text-txt hover:bg-panel2 transition-colors focus-visible:outline-2 focus-visible:outline-cyan">
                  {show ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                </button>
              </div>

              {/* one line that is always there, so the card doesn't jump when a message appears */}
              <div className="min-h-[22px] mt-2 px-1 text-[12.5px]">
                {error ? <p id="login-error" role="alert" className="text-down">{error}</p>
                  : caps ? <p id="login-caps" className="text-warn">Caps Lock is on.</p> : null}
              </div>

              <button type="submit" disabled={working || !password}
                      className={`login-btn mt-1 ${passkey ? "login-btn-quiet" : "login-btn-primary"}`}>
                {done ? <><Check size={18} className="login-pop" aria-hidden="true" />Welcome back</>
                  : busy === "password" ? <><Loader2 size={18} className="animate-spin" aria-hidden="true" />Signing in…</>
                  : <>Sign in<ArrowRight size={17} className="login-arrow" aria-hidden="true" /></>}
              </button>
            </div>
          </div>

          <p className="login-rise mt-5 flex items-center justify-center gap-1.5 text-[12px] text-faint" style={{ animationDelay: "200ms" }}>
            <Lock size={11} aria-hidden="true" /> Only you can sign in here.
          </p>
        </form>
      </div>

      {/* Signed in: the page settles into the app's background with the mark, then moves on. */}
      <div className={`login-exit ${done ? "is-on" : ""}`} aria-hidden="true">
        <div className="login-exit-mark grid place-items-center w-16 h-16 rounded-[20px] bg-panel border border-edge2/70 text-txt">
          <AeroMark size={30} />
        </div>
      </div>
      <p className="sr-only" role="status">{done ? "Signed in. Opening Aero." : ""}</p>
    </main>
  );
}
