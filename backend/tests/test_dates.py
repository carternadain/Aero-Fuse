"""Transaction dates from screenshots and statements: formats, missing years, relative words,
and the 'no date found' flag the review step shows."""
import base64
import io
import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import importer  # noqa: E402

TODAY = date(2026, 10, 10)


def shot(text, today=TODAY):
    return [(r["date"], r["amount"], r["description"], r["date_guessed"])
            for r in importer.parse_screenshot_text(text, today)]


@pytest.mark.parametrize("line,expected", [
    ("Sep 14", "2026-09-14"),
    ("Sept 14th", "2026-09-14"),
    ("September 14, 2025", "2025-09-14"),
    ("9/14", "2026-09-14"),
    ("09/14/26", "2026-09-14"),
    ("2026-09-14", "2026-09-14"),
    ("14 Sep", "2026-09-14"),
    ("Sep 3, 2026", "2026-09-03"),
    ("Yesterday", "2026-10-09"),
    ("Today", "2026-10-10"),
    ("3 days ago", "2026-10-07"),
    ("Mon, Oct 5 at 8:42 PM", "2026-10-05"),
    ("Restaurants · Sep 14", "2026-09-14"),
    ("Sep 14 · Pending", "2026-09-14"),
    ("Dec 20", "2025-12-20"),          # no year, would be in the future -> last year
    ("Oct 12", "2026-10-12"),          # 2 days ahead is still this year (time zones, pending)
])
def test_date_line_formats(line, expected):
    assert importer._shot_date(line, TODAY).isoformat() == expected


@pytest.mark.parametrize("line", ["Starbucks", "Decathlon 12", "24/7 Fitness", "Shell Oil 57442", "13/45"])
def test_not_a_date_line(line):
    assert importer._shot_date(line, TODAY) is None


def test_carter_style_screenshot_dates_below_rows():
    # real tesseract output of a generated dark card screenshot (OCR dropped the comma in $1,850)
    rows = shot("""9:41 87%
Gold Card
Recent transactions
Sweetgreen $16.75
Yesterday
Ly $23.10
Sep 14
Apple.com/bill $2.99
9/14
Costco Wholesale $187.42
Sep 3, 2026
Best Buy Refund +$49.99
Aug 30
Payroll Acme Inc +$1 850.00
Aug 29
""")
    assert rows == [
        ("2026-10-09", -16.75, "Sweetgreen", False),
        ("2026-09-14", -23.10, "Ly", False),
        ("2026-09-14", -2.99, "Apple.com/bill", False),
        ("2026-09-03", -187.42, "Costco Wholesale", False),
        ("2026-08-30", 49.99, "Best Buy Refund", False),
        ("2026-08-29", 1850.00, "Payroll Acme Inc", False),
    ]


def test_date_on_the_amount_line():
    rows = shot("Starbucks Sep 14 $5.45\nLyft\nSep 12 $9.00\n9/10 Chipotle $14.80\n")
    assert rows == [
        ("2026-09-14", -5.45, "Starbucks", False),
        ("2026-09-12", -9.00, "Lyft", False),
        ("2026-09-10", -14.80, "Chipotle", False),
    ]


def test_date_beside_merchant_amount_on_own_line():
    rows = shot("Starbucks · Sep 14\n$5.45\nNetflix Sep 9\n$15.49\n")
    assert [(d, a, n) for d, a, n, _ in rows] == [("2026-09-14", -5.45, "Starbucks"),
                                                  ("2026-09-09", -15.49, "Netflix")]


def test_no_date_anywhere_falls_back_to_today_and_says_so():
    rows = shot("Starbucks $5.45\nLyft $9.00\n")
    assert rows == [("2026-10-10", -5.45, "Starbucks", True), ("2026-10-10", -9.00, "Lyft", True)]
    # the last row of a dates-below list whose date line was cropped off
    rows = shot("Shop $1.00\nSep 14\nCafe $2.00\n")
    assert [(d, g) for d, _, _, g in rows] == [("2026-09-14", False), ("2026-10-10", True)]


def test_pending_section_is_today_but_not_a_guess():
    rows = shot("Pending\nStarbucks $5.45\nSep 2\nLyft $9.00\n")
    assert rows == [("2026-10-10", -5.45, "Starbucks", False), ("2026-09-02", -9.00, "Lyft", False)]


def test_preview_carries_the_flag():
    prev = importer.build_preview(importer.parse_screenshot_text("Cafe $3.00", TODAY), [])
    assert prev[0]["date_guessed"] is True


# ── statement text (PDF text or copied text) ──

STATEMENT = """Robinhood Gold Card Statement
Statement period: Aug 28, 2026 - Sep 27, 2026
Trans Date  Post Date  Description                 Amount
08/29  08/30  WHOLEFDS MKT 10234 SF CA          $82.15
09/03  09/04  SPOTIFY USA                        $11.99
09/14  09/15  STARBUCKS STORE 0921              $5.45
09/18  09/19  PAYMENT RECEIVED - THANK YOU     -$300.00
09/20  09/21  BEST BUY RETURN                    $40.00 CR
Total fees charged this period                  $0.00
New balance                                     $300.00
"""


def test_statement_text_rows_and_years():
    rows = importer.parse_statement_text(STATEMENT, TODAY)
    assert [(r["date"], r["amount"], r["description"]) for r in rows] == [
        ("2026-08-29", 82.15, "WHOLEFDS MKT 10234 SF CA"),
        ("2026-09-03", 11.99, "SPOTIFY USA"),
        ("2026-09-14", 5.45, "STARBUCKS STORE 0921"),
        ("2026-09-18", -300.00, "PAYMENT RECEIVED - THANK YOU"),
        ("2026-09-20", -40.00, "BEST BUY RETURN"),
    ]
    assert importer.suggest_flip(rows) is True   # charges listed as positive


def test_statement_year_comes_from_closing_date_across_new_year():
    text = "Closing date Jan 27, 2027\n12/29 TRADER JOES $40.00\n01/05 LYFT $9.00\n"
    rows = importer.parse_statement_text(text, date(2027, 2, 3))
    assert [r["date"] for r in rows] == ["2026-12-29", "2027-01-05"]


def test_txt_and_csv_without_year_via_parse():
    rows = importer.parse("statement.txt", STATEMENT, TODAY)
    assert len(rows) == 5
    csv = "Date,Description,Amount\n09/14,Starbucks,5.45\nDec 30,Cafe,3.00\n"
    assert [r["date"] for r in importer.parse("x.csv", csv, TODAY)] == ["2026-09-14", "2025-12-30"]
    with pytest.raises(ValueError):
        importer.parse("x.txt", "nothing to see")


def test_pdf_statement():
    pytest.importorskip("pypdf")
    canvas = pytest.importorskip("reportlab.pdfgen.canvas")
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    y = 800
    for line in STATEMENT.splitlines():
        c.drawString(40, y, line)
        y -= 16
    c.save()
    rows = importer.parse("stmt.pdf", base64.b64encode(buf.getvalue()).decode(), TODAY)
    assert [r["date"] for r in rows][:3] == ["2026-08-29", "2026-09-03", "2026-09-14"]


def test_suggest_flip_bank_vs_card():
    bank = [{"description": "Coffee", "amount": -5}, {"description": "Rent", "amount": -1500},
            {"description": "Payroll", "amount": 2000}]
    card = [{"description": "Coffee", "amount": 5}, {"description": "Lyft", "amount": 9},
            {"description": "Payment thank you", "amount": -500}]
    assert importer.suggest_flip(bank) is False
    assert importer.suggest_flip(card) is True
