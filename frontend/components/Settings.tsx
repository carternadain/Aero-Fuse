"use client";

// Settings: one full-height sheet (phone) / dialog (desktop) holding every per-device preference
// that used to be scattered over the header, its ⋯ menu, Home's Customize panel and Wealth.
// Pages inside it are history entries, so the phone's back gesture, a right swipe or Escape
// steps back out, one page at a time.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell, Bot, ChevronLeft, ChevronRight, Download, EyeOff, LayoutGrid, LogOut, PanelsTopLeft, PartyPopper, X,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import { haptic, navigate, on, openAlerts, type SettingsPage } from "@/lib/bus";
import { isHidden, setHidden } from "@/lib/privacy";
import { setHolidayFxOff, useHolidayFx } from "@/lib/holidays";
import { isShown, setBotTools, setHomeCard, setMode, setPanel, usePrefs } from "@/lib/prefs";
import { HOME_CARDS, cardOn } from "./Overview";
import PalettePicker from "./PalettePicker";
import BackupPanel from "./BackupPanel";

/** Invest/News panels you can switch on or off. `pro` = hidden by default in Simple view. */
const PANELS: { id: string; label: string; pro: boolean; group: string }[] = [
  { id: "sec-liqmap", label: "BTC liquidation heatmap", pro: false, group: "Invest · Crypto" },
  { id: "sec-narratives", label: "Crypto narratives", pro: true, group: "Invest · Crypto" },
  { id: "sec-earnings", label: "Earnings calendar", pro: false, group: "News" },
  { id: "sec-econ", label: "Macro calendar", pro: true, group: "News" },
];

const TITLES: Record<SettingsPage, string> = {
  root: "Settings", home: "Home screen", panels: "Invest and News", backup: "Backup and export",
};

const ROW = "w-full flex items-center gap-3 px-4 min-h-12 text-left transition-colors hover:bg-panel2/50 " +
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cyan";

function Icon({ icon: I }: { icon: LucideIcon }) {
  return <span className="w-7 h-7 rounded-lg bg-panel2 text-dim flex items-center justify-center shrink-0" aria-hidden><I size={15} /></span>;
}

function Group({ title, note, children }: { title?: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      {title && <h3 className="px-4 pb-1.5 text-[12px] font-semibold text-dim">{title}</h3>}
      <div className="rounded-xl border border-edge bg-panel overflow-hidden divide-y divide-edge">{children}</div>
      {note && <p className="px-4 pt-1.5 text-[11.5px] text-faint leading-snug">{note}</p>}
    </div>
  );
}

function Switch({ label, sub, checked, onChange, icon }: {
  label: string; sub?: string; checked: boolean; onChange: (v: boolean) => void; icon?: LucideIcon;
}) {
  return (
    <button role="switch" aria-checked={checked} onClick={() => { haptic(); onChange(!checked); }} className={ROW}>
      {icon && <Icon icon={icon} />}
      <span className="flex-1 min-w-0 py-2.5">
        <span className="block text-[14px] text-txt">{label}</span>
        {sub && <span className="block text-[11.5px] text-dim leading-snug">{sub}</span>}
      </span>
      <span aria-hidden className={`relative w-[46px] h-7 rounded-full shrink-0 transition-colors ${checked ? "bg-up" : "bg-edge2"}`}>
        <span className={`absolute top-0.5 left-0.5 size-6 rounded-full bg-txt shadow transition-transform motion-reduce:transition-none ${checked ? "translate-x-[18px]" : ""}`} />
      </span>
    </button>
  );
}

function NavRow({ label, sub, icon, onClick }: { label: string; sub?: string; icon: LucideIcon; onClick: () => void }) {
  return (
    <button onClick={onClick} className={ROW}>
      <Icon icon={icon} />
      <span className="flex-1 min-w-0 py-2.5">
        <span className="block text-[14px] text-txt">{label}</span>
        {sub && <span className="block text-[11.5px] text-dim leading-snug truncate">{sub}</span>}
      </span>
      <ChevronRight size={17} className="text-faint shrink-0" aria-hidden />
    </button>
  );
}

function ViewRow() {
  const { mode } = usePrefs();
  return (
    <div className="flex items-center gap-3 px-4 min-h-12">
      <Icon icon={LayoutGrid} />
      <span id="set-view" className="flex-1 text-[14px] text-txt">View</span>
      <div role="radiogroup" aria-labelledby="set-view" data-noswipe className="flex p-0.5 rounded-lg bg-panel2 text-[13px] font-semibold">
        {(["simple", "pro"] as const).map((m) => (
          <button key={m} role="radio" aria-checked={mode === m} onClick={() => { if (mode !== m) haptic(); setMode(m); }}
                  className={`min-h-10 min-w-[64px] px-3 rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-cyan ${
                    mode === m ? "bg-edge2 text-txt shadow-sm" : "text-dim hover:text-txt"}`}>
            {m === "simple" ? "Simple" : "Pro"}
          </button>
        ))}
      </div>
    </div>
  );
}

function HidePref() {
  const [hide, setHide] = useState(false);
  useEffect(() => {
    const sync = () => setHide(isHidden()); // the eye on Home flips the same flag
    sync();
    window.addEventListener("privacy", sync);
    return () => window.removeEventListener("privacy", sync);
  }, []);
  return <Switch icon={EyeOff} label="Hide balances" sub="Masks dollar amounts everywhere" checked={hide} onChange={(v) => setHidden(v)} />;
}

function Root({ go, close, authOn }: { go: (p: SettingsPage) => void; close: (then?: () => void) => void; authOn: boolean }) {
  const p = usePrefs();
  const fx = useHolidayFx();
  const homeOn = HOME_CARDS.filter((c) => cardOn(c.id, p.mode, p.home)).length;
  const panelsOn = PANELS.filter((x) => isShown(x.id, x.pro, p)).length;
  const logout = async () => {
    await api.post("/api/auth/logout").catch(() => {});
    window.location.href = "/login";
  };
  return (
    <>
      <Group note="Simple hides advanced tools. Search still finds everything.">
        <ViewRow />
        <HidePref />
      </Group>
      <Group title="Customize">
        <NavRow icon={LayoutGrid} label="Home screen" sub={`${homeOn} of ${HOME_CARDS.length} cards showing`} onClick={() => go("home")} />
        <NavRow icon={PanelsTopLeft} label="Invest and News" sub={`${panelsOn} of ${PANELS.length} extra panels showing`} onClick={() => go("panels")} />
      </Group>
      <Group title="Gain and loss colors">
        <PalettePicker />
      </Group>
      <Group>
        <Switch icon={PartyPopper} label="Holiday effects" sub="Snow, fireworks and friends on holidays" checked={!fx.off} onChange={(v) => setHolidayFxOff(!v)} />
        <Switch icon={Bot} label="Trading bot tools" sub="Adds a Bot tab for trade logs and signals" checked={p.botTools}
                onChange={(v) => {
                  setBotTools(v);
                  if (!v && window.location.hash.startsWith("#trading")) navigate({ tab: "home" }); // the Bot tab is going away
                }} />
        <NavRow icon={Bell} label="Price alerts" sub="Alerts and phone notifications" onClick={() => close(() => openAlerts())} />
      </Group>
      <Group title="Your data">
        <NavRow icon={Download} label="Backup and export" sub="Download everything, automatic backups" onClick={() => go("backup")} />
      </Group>
      {authOn && (
        <Group>
          <button onClick={logout} className={`${ROW} justify-center text-[14px] font-semibold text-down`}>
            <LogOut size={16} aria-hidden /> Log out
          </button>
        </Group>
      )}
    </>
  );
}

function HomeCards() {
  const p = usePrefs();
  const groups = [...new Set(HOME_CARDS.map((c) => c.group))];
  return (
    <>
      {groups.map((g, i) => (
        <Group key={g} title={g} note={i === groups.length - 1 ? `Unchanged cards follow ${p.mode === "simple" ? "Simple" : "Pro"} view. Hidden cards are still one search away.` : undefined}>
          {HOME_CARDS.filter((c) => c.group === g).map((c) => (
            <Switch key={c.id} label={c.label} checked={cardOn(c.id, p.mode, p.home)} onChange={(v) => setHomeCard(c.id, v)} />
          ))}
        </Group>
      ))}
      <Group>
        <button className={`${ROW} justify-center text-[14px] text-up`} onClick={() => { haptic(); HOME_CARDS.forEach((c) => setHomeCard(c.id, null)); }}>
          Reset to defaults
        </button>
      </Group>
    </>
  );
}

function Panels() {
  const p = usePrefs();
  const groups = [...new Set(PANELS.map((x) => x.group))];
  return (
    <>
      {groups.map((g, i) => (
        <Group key={g} title={g} note={i === groups.length - 1 ? "Unchanged panels follow Simple or Pro view." : undefined}>
          {PANELS.filter((x) => x.group === g).map((x) => (
            <Switch key={x.id} label={x.label} checked={isShown(x.id, x.pro, { ...p, revealed: new Set() })} onChange={(v) => setPanel(x.id, v)} />
          ))}
        </Group>
      ))}
      <Group>
        <button className={`${ROW} justify-center text-[14px] text-up`} onClick={() => { haptic(); PANELS.forEach((x) => setPanel(x.id, null)); }}>
          Reset to defaults
        </button>
      </Group>
    </>
  );
}

export default function Settings() {
  const [page, setPage] = useState<SettingsPage | null>(null); // null = closed
  const [authOn, setAuthOn] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const pageRef = useRef(page);
  pageRef.current = page;

  // Each page is a history entry: back (button, gesture, Escape) pops one.
  useEffect(() => {
    const pop = (e: PopStateEvent) => {
      const s = (e.state as { settings?: SettingsPage } | null)?.settings;
      setPage(s ?? null);
    };
    window.addEventListener("popstate", pop);
    const off = on<SettingsPage | null>("app:settings", (pg) => {
      const target = pg ?? "root";
      if (!pageRef.current) {
        opener.current = document.activeElement as HTMLElement | null;
        history.pushState({ settings: "root" }, "");
      }
      if (target !== "root" && pageRef.current !== target) history.pushState({ settings: target }, "");
      setPage(target);
    });
    return () => { window.removeEventListener("popstate", pop); off(); };
  }, []);

  const go = useCallback((pg: SettingsPage) => { haptic(); history.pushState({ settings: pg }, ""); setPage(pg); }, []);
  const back = useCallback(() => { haptic(); history.back(); }, []);
  const close = useCallback((then?: () => void) => {
    const depth = pageRef.current === "root" ? 1 : 2;
    setPage(null);
    history.go(-depth);
    if (then) setTimeout(then, 60);
  }, []);

  const open = page !== null;
  useEffect(() => {
    if (!open) { opener.current?.focus?.(); return; }
    api.get<{ auth: boolean }>("/api/auth/check").then((r) => setAuthOn(r.auth)).catch(() => {});
    document.body.style.overflow = "hidden"; // also pauses the page's swipe-between-tabs
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    heading.current?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (pageRef.current === "root") close(); else back();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, page, back, close]);

  // Phone: swipe right steps back (or closes from the top page), like an iOS navigation stack.
  const touch = useRef<{ x: number; y: number; t: number; ok: boolean } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const el = e.target as HTMLElement;
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), ok: e.touches.length === 1 && !el.closest("[data-noswipe]") };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current;
    touch.current = null;
    if (!s?.ok) return;
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
    if (dx < 70 || Math.abs(dy) > dx * 0.5 || Date.now() - s.t > 700) return;
    // The browser may run its own back gesture for the same swipe (iOS edge swipe, Chrome overscroll):
    // wait a beat and only step back if it didn't, so one swipe never pops two pages.
    const from = pageRef.current;
    setTimeout(() => {
      if (pageRef.current !== from) return;
      if (from === "root") close(); else back();
    }, 160);
  };

  if (!page) return null;
  const sub = page !== "root";

  return (
    <div className="fixed inset-0 z-[89] bg-black/60 flex items-stretch sm:items-center justify-center"
         onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="settings-title"
           onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
           className="w-full sm:max-w-md h-[100dvh] sm:h-[min(760px,88vh)] bg-bg sm:rounded-2xl sm:border border-edge2 shadow-2xl flex flex-col overflow-hidden tab-enter">
        <div className="safe-top shrink-0 grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-2 pb-2 border-b border-edge bg-panel">
          <div className="justify-self-start">
            {sub && (
              <button onClick={back} className="flex items-center gap-0.5 min-h-10 pl-1 pr-3 rounded-lg text-[14px] text-up hover:bg-panel2 focus-visible:outline-2 focus-visible:outline-cyan">
                <ChevronLeft size={20} aria-hidden /> Settings
              </button>
            )}
          </div>
          <h2 id="settings-title" ref={heading} tabIndex={-1} className="text-[16px] font-bold text-txt outline-none truncate">{TITLES[page]}</h2>
          <button onClick={() => close()} aria-label="Close settings"
                  className="justify-self-end w-10 h-10 rounded-full flex items-center justify-center text-dim hover:text-txt hover:bg-panel2 focus-visible:outline-2 focus-visible:outline-cyan">
            <X size={20} aria-hidden />
          </button>
        </div>
        <div key={page} className="flex-1 overflow-y-auto overscroll-contain px-3 sm:px-4 pt-4 pb-[max(24px,env(safe-area-inset-bottom))] space-y-6 tab-enter">
          {page === "root" && <Root go={go} close={close} authOn={authOn} />}
          {page === "home" && <HomeCards />}
          {page === "panels" && <Panels />}
          {page === "backup" && (
            <Group>
              <div className="p-4"><BackupPanel bare /></div>
            </Group>
          )}
        </div>
      </div>
    </div>
  );
}
