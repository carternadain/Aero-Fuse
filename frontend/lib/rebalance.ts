// Rebalancing math: how far each group is from its target share, and the dollars that close the gap.
// With new money, nothing is sold: the deposit goes to the groups furthest under target.

export type Group = "investing" | "retirement" | "crypto" | "cash";
export const GROUPS: Group[] = ["investing", "retirement", "crypto", "cash"];
export type Mix = Record<Group, number>;

export interface Move { group: Group; value: number; pct: number; target: number; move: number }

export const sum = (m: Mix) => GROUPS.reduce((t, g) => t + (m[g] || 0), 0);

/** Today's mix as whole percents that add up to exactly 100 (largest remainder). */
export function currentMix(values: Mix): Mix {
  const total = sum(values);
  const out = { investing: 0, retirement: 0, crypto: 0, cash: 0 } as Mix;
  if (total <= 0) return out;
  const exact = GROUPS.map((g) => ({ g, x: (values[g] / total) * 100 }));
  for (const e of exact) out[e.g] = Math.floor(e.x);
  let left = 100 - sum(out);
  for (const e of [...exact].sort((a, b) => (b.x % 1) - (a.x % 1))) { if (left-- <= 0) break; out[e.g] += 1; }
  return out;
}

/** `move` is dollars to add (positive) or take out (negative) of each group. */
export function plan(values: Mix, targets: Mix, newMoney = 0): Move[] {
  const total = sum(values);
  const after = total + Math.max(0, newMoney);
  const gaps = GROUPS.map((g) => (targets[g] / 100) * after - values[g]);
  let moves = gaps;
  if (newMoney > 0) {
    const under = gaps.map((x) => Math.max(0, x));
    const need = under.reduce((t, x) => t + x, 0);
    moves = under.map((x) => (need > 0 ? (x / need) * newMoney : 0));
  }
  return GROUPS.map((g, i) => ({
    group: g, value: values[g], pct: total > 0 ? (values[g] / total) * 100 : 0, target: targets[g], move: moves[i],
  }));
}
