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
    <main className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={submit} className="panel w-full max-w-sm p-6 space-y-5">
        <div>
          <h1 className="font-display text-[34px] leading-none text-txt">
            Swing <em className="text-up">Terminal</em>
          </h1>
          <p className="text-[11px] text-faint mt-2 flex items-center gap-1.5">
            <Lock size={11} className="text-amber" /> Private terminal: sign in to continue
          </p>
        </div>
        <input
          className="field !py-2.5 !text-sm"
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-xs text-down">{error}</p>}
        <button className="btn btn-primary w-full !py-2.5" disabled={busy || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
