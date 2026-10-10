import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import db  # noqa: E402
import importer  # noqa: E402

TODAY = date(2026, 10, 10)


def parse(text, today=TODAY):
    return importer.parse_screenshot_text(text, today)


def pairs(rows):
    return [(r["date"], r["amount"], r["description"]) for r in rows]


def test_per_row_layout_with_date_below():
    rows = parse("""9:41
87%
Transactions
Starbucks $5.45
Oct 8
Chipotle Mexican Grill $12.30
Pending
Shell Oil $40.00
10/07
Netflix $15.49
Oct 1, 2025
""")
    assert pairs(rows) == [
        ("2026-10-08", -5.45, "Starbucks"),
        ("2026-10-10", -12.30, "Chipotle Mexican Grill"),
        ("2026-10-07", -40.00, "Shell Oil"),
        ("2025-10-01", -15.49, "Netflix"),
    ]


def test_section_headers_ignore_category_and_time_lines():
    rows = parse("""Recent activity
See all
Pending
Uber Eats $22.10
Restaurants
Yesterday
Starbucks $5.45
8:42 PM
Amazon $30.00
Shopping
October 8
Target $18.99
""")
    assert pairs(rows) == [
        ("2026-10-10", -22.10, "Uber Eats"),
        ("2026-10-09", -5.45, "Starbucks"),
        ("2026-10-09", -30.00, "Amazon"),
        ("2026-10-08", -18.99, "Target"),
    ]


def test_amount_on_own_line():
    rows = parse("""Today
Starbucks
$5.45
Restaurants
Trader Joe's
Groceries
$48.20
""")
    assert pairs(rows) == [("2026-10-10", -5.45, "Starbucks"), ("2026-10-10", -48.20, "Trader Joe's")]


def test_amount_own_line_with_date_below():
    rows = parse("Starbucks\n$5.45\n2 days ago\nLyft\n$9.00\nYesterday\n")
    assert pairs(rows) == [("2026-10-08", -5.45, "Starbucks"), ("2026-10-09", -9.00, "Lyft")]


@pytest.mark.parametrize("text,expected", [
    ("Shop $1,234.56", -1234.56),
    ("Shop -$5.00", -5.00),
    ("Shop +$20.00", 20.00),
    ("Shop $5.45-", -5.45),
    ("Shop S5.45", -5.45),
    ("Shop $5,45", -5.45),
    ("Shop $7", -7.00),
])
def test_amount_formats(text, expected):
    rows = parse("Today\n" + text)
    assert [r["amount"] for r in rows] == [expected]


def test_bare_number_is_not_an_amount():
    assert parse("Today\nStore 42\nCosta 7") == []


def test_refund_and_payment_signs():
    rows = parse("""Today
Amazon Refund +$20.00
Payment received $500.00
Autopay -$100.00
Thank you $50.00
""")
    assert [r["amount"] for r in rows] == [20.0, 500.0, 100.0, 50.0]
    prev = importer.build_preview(rows, [])
    assert [r["transfer"] for r in prev] == [False, True, True, True]
    assert prev[0]["refund"] is True


def test_year_rollover():
    jan = date(2026, 1, 2)
    rows = parse("Dec 30\nCafe $4.00\nJan 3\nBar $9.00\nJan 5\nLate $1.00", jan)
    assert [r["date"] for r in rows] == ["2025-12-30", "2026-01-03", "2025-01-05"]
    # Jan 5 is 3 days ahead of Jan 2 -> last year; Jan 3 is within 2 days -> this year
    assert rows[2]["date"] == "2025-01-05"


def test_noise_and_missing_amounts_skipped():
    rows = parse("""9:41
87%
Transactions
Balance
$1,234.56
Available credit $4,500.00
Statement balance $300.00
See all
-----
Mystery Merchant
Today
Starbucks $5.45
$9.99
""")
    assert pairs(rows) == [("2026-10-10", -5.45, "Starbucks")]


def test_icon_glyph_prefix_dropped():
    rows = parse("Today\n© Starbucks $5.45")
    assert rows[0]["description"] == "Starbucks"


def test_empty_text():
    assert parse("") == []
    assert parse("hello world") == []


# ── similar-transaction dedupe ────────────────────────────

@pytest.fixture
def tmpdb(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "t.db")
    db.init_db()
    return db


def _add(date_, amount, **kw):
    db.insert_imported_transactions([{"date": date_, "merchant": "X", "amount": amount,
                                      "category": "food", "hash": kw.get("hash")}])


def test_similar_matches_date_window_and_sign(tmpdb):
    _add("2026-10-08", 5.45, hash="a")
    _add("2026-10-07", -20.00, hash="b")   # stored refund
    rows = [{"date": "2026-10-09", "amount": 5.45}, {"date": "2026-10-07", "amount": 20.0},
            {"date": "2026-10-10", "amount": 5.45}, {"date": "2026-10-08", "amount": 5.46}]
    assert tmpdb.find_similar_transactions(rows) == {0, 1}


def test_similar_each_existing_matches_one_row(tmpdb):
    _add("2026-10-08", 5.00, hash="a")
    rows = [{"date": "2026-10-08", "amount": 5.0}, {"date": "2026-10-08", "amount": 5.0}]
    assert len(tmpdb.find_similar_transactions(rows)) == 1


def test_similar_exact_date_not_stolen_by_neighbor(tmpdb):
    _add("2026-10-08", 5.00, hash="a")
    rows = [{"date": "2026-10-09", "amount": 5.0}, {"date": "2026-10-08", "amount": 5.0}]
    assert tmpdb.find_similar_transactions(rows) == {1}


def test_similar_ignores_income_and_transfers(tmpdb):
    tmpdb.insert_imported_transactions([{"date": "2026-10-08", "merchant": "Pay", "amount": 5.0,
                                         "category": "income", "kind": "income", "hash": "i"}])
    assert tmpdb.find_similar_transactions([{"date": "2026-10-08", "amount": 5.0}]) == set()
    _add("2026-10-08", 9.0, hash="e")
    assert tmpdb.find_similar_transactions([{"date": "2026-10-08", "amount": 9.0, "transfer": True}]) == set()


# ── endpoint ──────────────────────────────────────────────

def test_endpoint(tmpdb):
    from fastapi.testclient import TestClient
    import main
    c = TestClient(main.app)
    _add("2026-10-08", 5.45, hash="zz")
    r = c.post("/api/import/screenshot-preview",
               json={"text": "Starbucks $5.45\nOct 8\nPayment $100.00\nToday\n", "today": "2026-10-10"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert [x["duplicate"] for x in j["rows"]] == [True, False]
    assert j["counts"] == {"total": 2, "new": 0, "duplicates": 1, "transfers": 1}
    bad = c.post("/api/import/screenshot-preview", json={"text": "nothing here"})
    assert bad.status_code == 400 and "closer crop" in bad.json()["detail"]
    big = c.post("/api/import/screenshot-preview", json={"text": "a" * (200 * 1024 + 1)})
    assert big.status_code == 413
    # commit fills in a hash for edited rows, and dedupes the second time
    row = {"date": "2026-10-09", "merchant": "Lyft", "description": "", "amount": 9.0,
           "kind": "expense", "category": "transport", "hash": None}
    assert c.post("/api/import/commit", json={"rows": [row]}).json() == {"inserted": 1, "duplicates": 0}
    assert c.post("/api/import/commit", json={"rows": [row]}).json() == {"inserted": 0, "duplicates": 1}


# ── real tesseract output (dark-mode Robinhood-style screenshot) ──

OCR_FIXTURE = """9:41 87%
Transactions
Pending
Starbucks
Restaurants $6.45
Yesterday
Shell Oil 57442
Gas $48.12
Amazon.com $1129.99
Shopping
October 7
Chipotle
Restaurants $14.80
Target Refund
Shopping +$22.50
Payment
Thank you +$500.00
October 5
Netflix
Entertainment $15.49
"""


def test_real_ocr_subtitle_line_holds_amount():
    rows = parse(OCR_FIXTURE)
    assert pairs(rows) == [
        ("2026-10-10", -6.45, "Starbucks"),
        ("2026-10-09", -48.12, "Shell Oil 57442"),
        ("2026-10-09", -1129.99, "Amazon.com"),
        ("2026-10-07", -14.80, "Chipotle"),
        ("2026-10-07", 22.50, "Target Refund"),
        ("2026-10-07", 500.00, "Payment received"),
        ("2026-10-05", -15.49, "Netflix"),
    ]
    prev = importer.build_preview(rows, [])
    assert [(r["refund"], r["transfer"]) for r in prev] == [
        (False, False)] * 4 + [(True, False), (False, True), (False, False)]


def test_subtitle_after_row_not_stolen_by_next_inline_row():
    # "Whatever" is an unknown subtitle after a finished row; next row has its merchant inline
    rows = parse("Today\nAmazon $10.00\nWhatever\nChipotle $14.80\nLyft\nTransportation $9.00")
    assert [r["description"] for r in rows] == ["Amazon", "Chipotle", "Lyft"]
