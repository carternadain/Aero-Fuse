"use client";

import { useState } from "react";
import { Lock } from "lucide-react";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
          <img src="/icon-192.png" alt="" width={76} height={76} className="w-[76px] h-[76px] shadow-[0_10px_30px_rgba(0,0,0,0.45)] rounded-[17px] ring-1 ring-edge" />
          <h1 className="font-display text-[28px] font-semibold tracking-tight leading-none text-txt mt-5">Aero</h1>
          <p className="text-[13px] text-dim mt-2 flex items-center gap-1.5">
            <Lock size={12} aria-hidden="true" /> Private. Sign in to continue.
          </p>
        </div>
        <input
          className="field !py-3 !text-base sm:!text-sm text-center"
          aria-label="Password"
          type="password"
          autoComplete="current-password"
          enterKeyHint="go"
          placeholder="Password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p role="alert" className="text-xs text-down text-center">{error}</p>}
        <button className="btn btn-primary w-full !py-3 !text-sm" disabled={busy || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
