"use client";

// "Your week" as an image you can send. Percentages and tickers only: no dollar amounts
// ever go on the card, whatever the Hide balances setting is.

export interface WeekCard {
  pct: number | null;
  rows: { label: string; name: string; pct: number }[];
  up: number;
  down: number;
}

const W = 1080, H = 1350, PAD = 88;
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, system-ui, sans-serif';
const signed = (n: number, d = 1) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(d)}%`;

function weekLabel(now = new Date()): string {
  const start = new Date(now.getTime() - 6 * 86_400_000);
  const f = (d: Date) => d.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${f(start)} to ${f(now)}, ${now.getFullYear()}`;
}

/** Draw the card in the current theme's colors. Exported for tests and previews. */
export function drawWeekCard(card: WeekCard): HTMLCanvasElement {
  const css = getComputedStyle(document.documentElement);
  const tok = (name: string, fallback: string) => css.getPropertyValue(`--color-${name}`).trim() || fallback;
  const c = { bg: tok("bg", "#221f1a"), panel: tok("panel", "#2e2a25"), edge: tok("edge", "#463f37"), txt: tok("txt", "#fbf7f0"),
              dim: tok("dim", "#c4baab"), faint: tok("faint", "#a89f8f"), up: tok("up", "#6cb4ff"), down: tok("down", "#f4a261") };

  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d")!;
  g.fillStyle = c.bg; g.fillRect(0, 0, W, H);
  g.textBaseline = "alphabetic";

  g.fillStyle = c.txt; g.font = `700 44px ${FONT}`; g.fillText("Aero", PAD, PAD + 36);
  g.fillStyle = c.faint; g.font = `500 32px ${FONT}`; g.textAlign = "right"; g.fillText(weekLabel(), W - PAD, PAD + 34); g.textAlign = "left";

  g.fillStyle = c.dim; g.font = `600 40px ${FONT}`; g.fillText("My week", PAD, 330);
  const pct = card.pct ?? 0;
  g.fillStyle = pct >= 0 ? c.up : c.down; g.font = `700 210px ${FONT}`;
  g.fillText(signed(pct, 2), PAD - 8, 540);
  g.fillStyle = c.dim; g.font = `500 36px ${FONT}`;
  g.fillText(`net worth this week · ${card.up} holdings up, ${card.down} down`, PAD, 610);

  // rows in a panel
  const top = 700, rowH = 132, n = card.rows.length;
  if (n) {
    g.fillStyle = c.panel; g.strokeStyle = c.edge; g.lineWidth = 2;
    g.beginPath(); g.roundRect(PAD, top, W - PAD * 2, rowH * n, 36); g.fill(); g.stroke();
    card.rows.forEach((r, i) => {
      const y = top + rowH * i;
      if (i) { g.fillStyle = c.edge; g.fillRect(PAD + 40, y, W - PAD * 2 - 80, 2); }
      g.fillStyle = c.faint; g.font = `500 30px ${FONT}`; g.fillText(r.label, PAD + 40, y + 52);
      g.fillStyle = c.txt; g.font = `700 44px ${FONT}`; g.fillText(r.name, PAD + 40, y + 104);
      // the value stays in text ink; an arrow carries direction so it never rests on color alone
      g.textAlign = "right"; g.font = `700 48px ${FONT}`;
      g.fillText(`${r.pct >= 0 ? "▲" : "▼"} ${signed(r.pct)}`, W - PAD - 40, y + 88);
      g.textAlign = "left";
    });
  }

  g.fillStyle = c.faint; g.font = `500 30px ${FONT}`;
  g.fillText("Percentages only. No dollar amounts.", PAD, H - PAD);
  return cv;
}

/** Share the card with the system share sheet, or download it where there isn't one. */
export async function shareWeekCard(card: WeekCard): Promise<"shared" | "downloaded" | "cancelled"> {
  const cv = drawWeekCard(card);
  const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, "image/png"));
  if (!blob) throw new Error("Couldn't make the image");
  const file = new File([blob], "my-week.png", { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "My week" }); return "shared"; }
    catch (e) { if ((e as Error).name === "AbortError") return "cancelled"; /* otherwise fall through to a download */ }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "my-week.png";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
