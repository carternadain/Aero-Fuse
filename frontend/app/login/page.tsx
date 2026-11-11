"use client";

import { useEffect, useState } from "react";
import { Fingerprint, Lock } from "lucide-react";
import { passkeyName, passkeysSupported, signInWithPasskey, wasCancelled } from "@/lib/passkey";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [passkey, setPasskey] = useState<string | null>(null); // button label once a passkey exists for this site

  useEffect(() => {
    if (!passkeysSupported()) return;
    fetch("/api/auth/passkey/status", { cache: "no-store" }).then((r) => r.json())
      .then((s) => { if (s.registered) setPasskey(passkeyName()); }).catch(() => {});
  }, []);

  const usePasskey = async () => {
    setBusy(true);
    setError("");
    try {
      await signInWithPasskey();
      window.location.href = "/";
    } catch (e) {
      if (!wasCancelled(e)) setError(e instanceof Error ? e.message : "Sign-in failed");
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (r.ok) {
        window.location.href = "/";
        return;
      }
      const body = await r.json().catch(() => ({}));
      setError(body.detail || "Sign-in failed");
    } catch {
      setError("Can't reach the server");
    } finally {
      setBusy(false);
      setPassword("");
    }
  };

  return (
    <main className="min-h-dvh flex items-center justify-center px-6 py-10">
      <form onSubmit={submit} className="w-full max-w-[320px] flex flex-col gap-4">
        <div className="flex flex-col items-center text-center mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" width={76} height={76} className="w-[76px] h-[76px] shadow-[0_10px_30px_var(--color-shade-float)] rounded-[17px] ring-1 ring-edge" />
          <h1 className="font-display text-[28px] font-semibold tracking-tight leading-none text-txt mt-5">Aero</h1>
          <p className="text-[13px] text-dim mt-2 flex items-center gap-1.5">
            <Lock size={12} aria-hidden="true" /> Private. Sign in to continue.
          </p>
        </div>
        {passkey && (
          <>
            <button type="button" onClick={usePasskey} disabled={busy} className="btn btn-primary w-full !py-3 !text-sm">
              <Fingerprint size={16} aria-hidden="true" /> Sign in with {passkey}
            </button>
            <div className="flex items-center gap-3 text-[11px] text-faint" aria-hidden="true">
              <span className="flex-1 border-t border-edge" />or use your password<span className="flex-1 border-t border-edge" />
            </div>
          </>
        )}
        <input
          className="field !py-3 !text-base sm:!text-sm text-center"
          aria-label="Password"
          type="password"
          autoComplete="current-password"
          enterKeyHint="go"
          placeholder="Password"
          autoFocus={!passkey}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p role="alert" className="text-xs text-down text-center">{error}</p>}
        <button className={`btn ${passkey ? "" : "btn-primary"} w-full !py-3 !text-sm`} disabled={busy || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
