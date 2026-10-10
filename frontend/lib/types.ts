export interface Partial_ {
  id: number;
  trade_id: number;
  pct: number;
  price: number;
  level: string;
  closed_at: string;
}

export interface Trade {
  id: number;
  asset: string;
  direction: "long" | "short";
  entry: number;
  sl: number;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  risk_pct: number;
  signal_source: string;
  liquidity_sweep: number;
  htf_aligned: number;
  status: "open" | "partial" | "closed";
  outcome: string | null;
  exit_price: number | null;
  pnl_pct: number | null;
  rr: number | null;
  notes: string;
  opened_at: string;
  closed_at: string | null;
  partials: Partial_[];
}

export interface Signal {
  id: number;
  ts: string;
  asset: string;
  indicator: string;
  conviction: string;
  direction: string;
  timeframe: string;
  price: number | null;
  taken: number;
  skip_reason: string;
  trade_id: number | null;
  outcome: string;
  ai_take?: number | null;
  ai_score?: number | null;
  ai_confidence?: string | null;
  ai_reasons?: string[];
  ai_warnings?: string[];
}

export interface ScoreBlock {
  score: number;
  label: string;
  rsi: number | null;
  vs_200dma_pct: number | null;
  range_pos: number | null;
  trend: "uptrend" | "downtrend" | "unknown";
}

export interface CryptoCoin {
  id: string;
  symbol: string;
  name: string;
  image: string;
  price: number | null;
  market_cap: number | null;
  change_24h: number | null;
  change_7d: number | null;
  change_30d: number | null;
  change_1y: number | null;
  sparkline: number[];
  score: ScoreBlock | null;
}

export interface Narrative {
  name: string;
  market_cap: number;
  change_24h: number;
  volume_24h: number | null;
  top_coins: string[];
}

export interface StockScore {
  symbol: string;
  price: number | null;
  score: ScoreBlock | null;
}

export interface OptionsStock extends StockScore {
  signals: Signal[];
  has_confluence: boolean;
}

export interface EarningsRow {
  symbol: string;
  next_earnings: string | null;
  price: number | null;
  target_mean: number | null;
  recommendation: string | null;
  bias: "bullish" | "bearish" | "neutral";
  projection: string;
}

export interface EdgeBucket {
  wins: number;
  losses: number;
  total: number;
  win_rate: number | null;
}

export interface EdgeReport {
  ai_take: EdgeBucket;
  ai_skip: EdgeBucket;
  all_taken: EdgeBucket;
  evaluated: number;
}

export interface HistoryPoint {
  date: string;
  price: number;
  score: number | null;
}

export interface HistoryResponse {
  symbol: string;
  kind: "crypto" | "stock";
  points: HistoryPoint[];
}

export interface ScoredAsset {
  kind: "crypto" | "stock";
  id: string;
  symbol: string;
  price: number | null;
  score: number | null;
  label: string | null;
}

export interface SimTrade {
  id: number;
  signal_id: number | null;
  asset: string;
  direction: "long" | "short";
  entry: number;
  sl: number;
  tp1: number;
  status: "open" | "closed";
  exit_price: number | null;
  outcome: string | null;
  pnl_pct: number | null;
  r_multiple: number | null;
  opened_at: string;
  closed_at: string | null;
}

export interface SimStats {
  open: number;
  closed: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_r: number;
  expectancy_r: number;
  total_pnl_pct: number;
}

export interface CryptoContext {
  fng_value: number | null;
  fng_label: string | null;
  btc_dominance: number | null;
  eth_dominance?: number | null;
  total_mcap: number | null;
  mcap_change_24h: number | null;
  alt_read?: string;
}

export interface EconEvent {
  date: string;
  event: string;
  impact: string;
  approx: boolean;
  note: string;
}

export interface AnalyticsBucket {
  key: string;
  trades: number;
  win_rate: number;
  expectancy_r: number;
}

export interface Analytics {
  sample: number;
  expectancy_r: number;
  avg_win_r: number;
  avg_loss_r: number;
  profit_factor: number | null;
  best_r: number;
  worst_r: number;
  total_r: number;
  by_source: AnalyticsBucket[];
  by_asset: AnalyticsBucket[];
  by_hour: AnalyticsBucket[];
}

export interface Level {
  id: number;
  asset: string;
  price: number;
  label: string;
  kind: string;
  active: number;
}

export interface Position {
  id: number;
  asset: string;
  kind: "crypto" | "leap";
  qty: number;
  entry: number;
  current: number | null;
  strike: number | null;
  expiry: string | null;
  notes: string;
}

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  published: string;
  symbols: string[];
  sentiment: "bullish" | "bearish" | "neutral";
  summary: string;
}

export interface NewsResponse {
  watchlist: NewsItem[];
  macro: NewsItem[];
  ai_enabled: boolean;
}

export interface Stats {
  total_trades: number;
  open_trades: number;
  closed: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_pnl_pct: number;
  avg_rr: number;
  best_trade: { id: number; asset: string; pnl_pct: number; direction: string } | null;
  worst_trade: { id: number; asset: string; pnl_pct: number; direction: string } | null;
  by_source: Record<string, { wins: number; losses: number; pnl: number }>;
}

export interface SwingIdea {
  kind: "stock";
  id: string;
  symbol: string;
  name: string;
  sector: string;
  price: number | null;
  score: number | null;
  label: string | null;
  watched: boolean;
  chg_1d: number | null;
  chg_1w: number | null;
  chg_1m: number | null;
  chg_3m: number | null;
  off_high: number | null;
}

export type Zone = "buy" | "hold" | "sell";
export type ZoneHorizon = "long" | "mid" | "short";

export interface ZoneHolding {
  kind: "stock" | "crypto";
  symbol: string;
  value: number;
  weight_pct: number;
  gain_pct: number | null;
  price: number | null;
  /** Units held and average cost per unit (null when no cost basis is on file). */
  qty: number;
  cost_basis: number | null;
  risk: { short: number | null; mid: number | null; long: number | null } | null;
}

export interface ZoneWatch {
  kind: "stock" | "crypto";
  symbol: string;
}

export interface ZonesResponse {
  holdings: ZoneHolding[];
  watch: ZoneWatch[];
}

export type ZoneChartRange = "1Y" | "3Y" | "5Y" | "MAX";

export interface ZoneChartResponse {
  symbol: string;
  kind: "stock" | "crypto";
  range: ZoneChartRange;
  horizon: ZoneHorizon;
  /** Evenly downsampled (<= 320). risk is 0-100, null where there is not enough history. */
  points: { date: string; price: number; risk: number | null }[];
  now: { risk: number | null; label: string | null; price: number | null; date: string };
  peak: { date: string; risk: number; price: number } | null;
  trough: { date: string; risk: number; price: number } | null;
  /** Percent of days spent in each zone over the range. */
  zone_share: { buy: number; hold: number; sell: number } | null;
  /** How often price was higher 3 months / 1 year later, from days at a similar risk level (n days). */
  odds: { m3: number; y1: number; n: number } | null;
  signals: { name: string; value: string | number; note: string }[];
}
