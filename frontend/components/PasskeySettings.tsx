"use client";

import { useEffect, useState } from "react";
import { Fingerprint, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { haptic, toast } from "@/lib/bus";
import { addPasskey, passkeyName, passkeysSupported, wasCancelled, type PasskeyRow } from "@/lib/passkey";
import { askConfirm } from "./DialogHost";

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : null;

/** A short label for this device, e.g. "iPhone" or "Mac". */
function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Android/.test(ua)) return "Android phone";
  if (/Windows/.test(ua)) return "Windows PC";
  return "This device";
}

/** Rows for a grouped Settings list: your passkeys, plus "add this device". Renders nothing when passkeys are off. */
export default function PasskeySettings() {
  const [rows, setRows] = useState<PasskeyRow[] | null>(null);
  const [off, setOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [what, setWhat] = useState("a passkey");

  useEffect(() => {
    setWhat(passkeyName());
    api.get<{ available: boolean; passkeys: PasskeyRow[] }>("/api/auth/passkeys")
      .then((r) => { if (r.available) setRows(r.passkeys); else setOff(true); })
      .catch(() => setOff(true)); // demo session, or login is switched off
  }, []);

  if (off || rows == null) return null;
  const can = passkeysSupported();

  const add = async () => {
    setErr(null); setBusy(true); haptic();
    try {
      setRows(await addPasskey(deviceName()));
      toast(`Done. You can sign in with ${what} from now on.`);
    } catch (e) {
      if (!wasCancelled(e)) setErr(e instanceof Error ? e.message : "Couldn't add a passkey");
    } finally { setBusy(false); }
  };
  const remove = async (p: PasskeyRow) => {
    if (!(await askConfirm(`Remove the passkey "${p.name}"? Your password still works.`))) return;
    try { setRows((await api.del<{ passkeys: PasskeyRow[] }>(`/api/auth/passkeys/${p.id}`)).passkeys); }
    catch { setErr("Couldn't remove that passkey. Try again."); }
  };

  return (
    <div className="divide-y divide-edge">
      {rows.map((p) => (
        <div key={p.id} className="flex items-center gap-3 pl-4 pr-1 min-h-12">
          <Fingerprint size={17} className="text-dim shrink-0" aria-hidden />
          <span className="flex-1 min-w-0 py-2">
            <span className="block text-[14px] text-txt truncate">{p.name}</span>
            <span className="block text-[11.5px] text-dim truncate">
              Added {day(p.created_at)}{p.last_used_at ? ` · last used ${day(p.last_used_at)}` : " · not used yet"}
            </span>
          </span>
          <button type="button" onClick={() => remove(p)} aria-label={`Remove the passkey ${p.name}`}
                  className="w-10 h-10 grid place-items-center rounded-full text-dim hover:text-down hover:bg-panel2 focus-visible:outline-2 focus-visible:outline-cyan">
            <Trash2 size={16} aria-hidden />
          </button>
        </div>
      ))}
      {can ? (
        <button type="button" onClick={add} disabled={busy}
                className="w-full flex items-center gap-3 px-4 min-h-12 text-left hover:bg-panel2/50 disabled:opacity-60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cyan">
          <Plus size={17} className="text-up shrink-0" aria-hidden />
          <span className="flex-1 min-w-0 py-2">
            <span className="block text-[14px] text-txt">{busy ? "Waiting for your device…" : `Sign in with ${what} on this device`}</span>
            <span className="block text-[11.5px] text-dim">Skips typing the password. The password still works.</span>
          </span>
        </button>
      ) : (
        <p className="px-4 py-3 text-[12.5px] text-dim">This browser can&apos;t make passkeys. They need https and a recent browser.</p>
      )}
      {err && <p role="alert" className="px-4 py-2 text-[12.5px] text-down">{err}</p>}
    </div>
  );
}
