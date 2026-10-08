# Aero-Fuse (Swing Terminal) — Claude rules

Personal finance & trading terminal. `frontend/` is Next.js 15 + React 19 + Tailwind v4
(theme tokens in `frontend/app/globals.css`), charts via Recharts, icons via lucide-react.
`backend/` is FastAPI. See `README.md` and `RUNBOOK.md` for setup.

## UI work — required skills

Any change that touches what the user sees (components in `frontend/components/`, pages in
`frontend/app/`, styles, charts) must go through these skills. Load them **before** writing
code, not after. If a plugin is not installed in the current session, apply the same
principles by hand and mention that it was missing.

| When | Skill to load |
|---|---|
| Building or restyling any component, page, or layout | `frontend-design` |
| Any chart, sparkline, meter, stat tile, KPI row, or dashboard panel | `dataviz` |
| Polishing an existing screen (spacing, hover/focus states, alignment, motion) | `make-interfaces-feel-better`, `web-design-guidelines` |
| Adding animation or transitions | `web-animation-design` |
| React structure, data fetching, re-render or bundle concerns | `vercel-react-best-practices` |
| Changing colors, type scale, spacing, or theme tokens | `design-system` |
| Labels, empty states, error messages, button text | `ux-copy` |
| Before finishing a UI change | `design-critique` and `accessibility-review` (or `audit-as-design-eng` / `audit-as-a11y-eng`) |

Plugins providing these: **frontend-design**, **audit-suite**, **Design** (Anthropic
directory). `dataviz` is built in.

## UI conventions

- Use the theme tokens from `globals.css` (`bg`, `panel`, `panel2`, `edge`, `txt`, `dim`,
  `faint`, `up`, `down`, `warn`, `amber`, `cyan`) — never hard-code hex colors in components.
  Gain/loss colors come from `up`/`down` so the palette picker keeps working.
- Numbers use `tabular-nums` (mono face, aligned digits).
- The app is used on a phone: every screen must work at ~375px wide with no horizontal
  page scroll; tap targets at least 40px.
- Keep keyboard focus visible and text contrast at WCAG AA or better.
- Reuse existing components (`Sparkline`, `ScoreMeter`, `StatsBar`, etc.) before adding new ones.

## Verifying UI changes

Run `npm run build` in `frontend/`. For visual changes, start the dev server and screenshot
the affected screen at desktop and phone widths (Playwright + preinstalled Chromium) before
calling the change done.
