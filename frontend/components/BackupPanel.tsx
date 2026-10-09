"use client";

import { useEffect, useState } from "react";
import { Database, FileJson, FileSpreadsheet, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { haptic } from "@/lib/bus";

interface Status {
  keep: number;
  backups: { name: string; size: number; created: string }[];
  last: { name: string; size: number; created: string } | null;
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

const DL = [
  { href: "/api/export/json", label: "Everything (.json)", Icon: FileJson },
  { href: "/api/export/transactions.csv", label: "Transactions (.csv)", Icon: FileSpreadsheet },
  { href: "/api/export/db", label: "Database file (.db)", Icon: Database },
];

export default function BackupPanel() {
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = () => api.get<Status>("/api/backups").then(setSt).catch(() => setErr("Couldn't reach the backend."));
  useEffect(() => { load(); }, []);

  async function runNow() {
    haptic(); setBusy(true); setErr("");
    try { setSt(await api.post<Status>("/api/backups/run")); }
    catch { setErr("Backup failed. Check the backend log."); }
    setBusy(false);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="flex items-center gap-2"><ShieldCheck size={14} className="text-up" /> Your data, yours to keep</span>
      </div>
      <div className="p-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {DL.map(({ href, label, Icon }) => (
            <a key={href} href={href} download className="btn min-h-[44px] text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-up">
              <Icon size={15} /> {label}
            </a>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
          <p className="text-dim tabular-nums min-w-0">
            {st
              ? st.last
                ? <>Last automatic backup {ago(st.last.created)} · keeping the newest {st.keep} ({st.backups.length} saved)</>
                : <>No automatic backup yet · one runs daily, keeping the newest {st.keep}</>
              : "Checking backups…"}
          </p>
          <button className="btn btn-primary min-h-[44px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-up"
                  onClick={runNow} disabled={busy}>
            {busy ? "Backing up…" : "Back up now"}
          </button>
        </div>
        {err && <p className="text-[12px] text-down">{err}</p>}
      </div>
    </div>
  );
}
