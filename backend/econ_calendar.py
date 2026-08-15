"""Curated US macro calendar — the high-impact events a swing trader shouldn't trade into.

Free and dependency-free. FOMC decision dates are the Fed's published 2026 schedule
(exact). Monthly jobs report (NFP) is the first Friday of each month (computed). CPI is
flagged approximate (BLS releases ~mid-month) since exact dates aren't programmatic here.
"""

from __future__ import annotations

from datetime import date, timedelta

# Fed's published 2026 FOMC meetings — decision/press-conference day (the second day).
FOMC_2026 = ["2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17",
             "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09"]


def _first_friday(year: int, month: int) -> date:
    d = date(year, month, 1)
    return d + timedelta(days=(4 - d.weekday()) % 7)


def upcoming(days_ahead: int = 45) -> list[dict]:
    today = date.today()
    horizon = today + timedelta(days=days_ahead)
    events: list[dict] = []

    for s in FOMC_2026:
        d = date.fromisoformat(s)
        if today <= d <= horizon:
            events.append({"date": s, "event": "FOMC rate decision", "impact": "high",
                           "approx": False, "note": "Fed funds rate + press conference (2pm ET)"})

    # Next few months of jobs report + (approximate) CPI.
    y, m = today.year, today.month
    for _ in range(3):
        nfp = _first_friday(y, m)
        if today <= nfp <= horizon:
            events.append({"date": nfp.isoformat(), "event": "Jobs report (NFP)", "impact": "high",
                           "approx": False, "note": "Non-farm payrolls + unemployment (8:30am ET)"})
        cpi = date(y, m, 13)
        if today <= cpi <= horizon:
            events.append({"date": cpi.isoformat(), "event": "CPI inflation", "impact": "high",
                           "approx": True, "note": "Consumer price index (~mid-month, 8:30am ET)"})
        m += 1
        if m > 12:
            m, y = 1, y + 1

    events.sort(key=lambda e: e["date"])
    return events
