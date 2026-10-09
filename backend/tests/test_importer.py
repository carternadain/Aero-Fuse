import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import db  # noqa: E402
import importer  # noqa: E402

CHASE = """Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #
DEBIT,01/05/2025,"POS DEBIT SQ *BLUE BOTTLE COFFEE 1234 OAKLAND CA",-5.75,DEBIT_CARD,1000.00,,
CREDIT,01/03/2025,"ACME CORP PAYROLL DIRECT DEP",2500.00,ACH_CREDIT,1005.75,,
DEBIT,01/02/2025,"ONLINE TRANSFER TO SAV ...1234",-200.00,ACCT_XFER,-1494.25,,
DEBIT,01/02/2025,"NETFLIX.COM",-15.49,DEBIT_CARD,-1294.25,,
"""

AMEX = """Date,Description,Amount
01/10/2025,UBER *TRIP HELP.UBER.COM,23.40
01/09/2025,AUTOPAY PAYMENT - THANK YOU,-500.00
01/08/2025,WHOLEFDS MKT #10234 SF CA,84.12
"""

DEBIT_CREDIT = """Date;Description;Debit;Credit;Balance
2025-02-01;Rent payment;"$1,500.00";;3000
2025-02-02;Salary ACME;;"$3,200.50";6200.50
2025-02-03;Coffee;(4.50);;6196.00
"""

OFX = """OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20250115120000[-5:EST]
<TRNAMT>-42.10
<FITID>1
<NAME>SHELL OIL 5744
<MEMO>POS PURCHASE
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20250116
<TRNAMT>1000.00
<FITID>2
<NAME>PAYROLL ACME
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>
"""


def test_chase_checking():
    rows = importer.parse("chase.csv", CHASE)
    assert len(rows) == 4
    assert rows[0] == {"date": "2025-01-05", "description": "POS DEBIT SQ *BLUE BOTTLE COFFEE 1234 OAKLAND CA",
                       "amount": -5.75}
    assert rows[1]["amount"] == 2500.0


def test_amex_flip_sign():
    parsed = importer.parse("amex.csv", AMEX)
    assert parsed[0]["amount"] == 23.40  # charges positive in the file
    prev = importer.build_preview(parsed, [], flip_sign=True)
    assert prev[0]["kind"] == "expense" and prev[0]["amount"] == 23.40
    assert prev[0]["category"] == "transport"
    assert prev[1]["transfer"] is True  # autopay
    assert prev[2]["category"] == "food"
    # without flipping, charges look like income, which is why the toggle exists
    assert importer.build_preview(parsed, [], flip_sign=False)[0]["kind"] == "income"


def test_hashes_do_not_depend_on_flip():
    parsed = importer.parse("amex.csv", AMEX)
    a = [r["hash"] for r in importer.build_preview(parsed, [], True)]
    b = [r["hash"] for r in importer.build_preview(parsed, [], False)]
    assert a == b


def test_debit_credit_columns():
    rows = importer.parse("x.csv", DEBIT_CREDIT)
    assert [r["amount"] for r in rows] == [-1500.0, 3200.5, -4.5]
    assert rows[0]["date"] == "2025-02-01"


def test_ofx_sgml():
    rows = importer.parse("stmt.qfx", OFX)
    assert rows == [
        {"date": "2025-01-15", "description": "SHELL OIL 5744", "amount": -42.10},
        {"date": "2025-01-16", "description": "PAYROLL ACME", "amount": 1000.0},
    ]


def test_ofx_xml():
    xml = ("<OFX><STMTTRN><DTPOSTED>20250301</DTPOSTED><TRNAMT>-9.99</TRNAMT>"
           "<NAME>Spotify</NAME></STMTTRN></OFX>")
    assert importer.parse("a.ofx", xml)[0]["amount"] == -9.99


@pytest.mark.parametrize("text", ["", "hello world\nfoo bar", "a,b,c\n1,2,3"])
def test_unreadable_raises(text):
    with pytest.raises(ValueError):
        importer.parse("x.csv", text)


@pytest.mark.parametrize("text,expected", [
    ("1/5/25", "2025-01-05"), ("2025-01-05", "2025-01-05"), ("05 Jan 2025", "2025-01-05"),
    ("25/12/2024", "2024-12-25"), ("01/05/2025", "2025-01-05"),
])
def test_dates(text, expected):
    assert importer.parse_date(text) == expected


@pytest.mark.parametrize("text,expected", [
    ("$1,234.50", 1234.5), ("(123.45)", -123.45), ("-5", -5.0), ("", None), ("12.00-", -12.0),
])
def test_amounts(text, expected):
    assert importer.parse_amount(text) == expected


@pytest.mark.parametrize("raw,expected", [
    ("POS DEBIT SQ *BLUE BOTTLE COFFEE 1234 OAKLAND CA", "Blue Bottle Coffee"),
    ("CHECKCARD 0105 STARBUCKS STORE 12345 SEATTLE WA", "Starbucks"),
    ("PAYPAL *SPOTIFY 402-935-7733", "Spotify"),
    ("TST* JOES PIZZA", "Joes Pizza"),
    ("AMAZON.COM*2K4AB9 AMZN.COM/BILL WA", "Amazon"),
    ("McDonalds #1234", "Mcdonalds"),
])
def test_clean_merchant(raw, expected):
    assert importer.clean_merchant(raw) == expected


def test_rules_beat_builtins():
    kind, cat, tr = importer.categorize("Blue Bottle Coffee", "SQ *BLUE BOTTLE", -5, [])
    assert (cat, tr) == ("food", False)
    rules = [{"pattern": "blue bottle", "category": "fun", "kind": "expense"},
             {"pattern": "blue bottle coffee", "category": "health", "kind": "expense"}]
    assert importer.categorize("Blue Bottle Coffee", "SQ *BLUE BOTTLE", -5, rules)[1] == "health"  # longest wins


def test_income_and_transfer_detection():
    assert importer.categorize("Acme Payroll", "ACME PAYROLL DIRECT DEP", 2500, [])[:2] == ("income", "income")
    kind, cat, tr = importer.categorize("Online Transfer To Sav", "ONLINE TRANSFER TO SAV", -200, [])
    assert tr is True
    assert importer.categorize("Payment Thank You", "PAYMENT THANK YOU", -50, [])[2] is True
    assert importer.categorize("Uber Eats", "UBER EATS", -20, [])[1] == "food"


def test_hash_duplicates_in_one_file_are_distinct():
    rows = [{"date": "2025-01-01", "description": "Coffee  Shop", "amount": -3.5}] * 2
    h = importer.row_hashes(rows)
    assert h[0] != h[1]
    # stable across runs and whitespace/case in description
    again = importer.row_hashes([{"date": "2025-01-01", "description": "coffee shop", "amount": -3.5}] * 2)
    assert h == again


# ── database level ────────────────────────────────────────

@pytest.fixture
def tmpdb(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "t.db")
    db.init_db()
    return db


def test_insert_dedupe(tmpdb):
    prev = importer.build_preview(importer.parse("c.csv", CHASE), [])
    rows = [{"date": r["date"], "merchant": r["merchant"], "note": r["description"], "amount": r["amount"],
             "kind": r["kind"], "category": r["category"], "hash": r["hash"]} for r in prev]
    assert db.existing_import_hashes([r["hash"] for r in rows]) == set()
    assert db.insert_imported_transactions(rows) == {"inserted": 4, "duplicates": 0}
    assert db.insert_imported_transactions(rows) == {"inserted": 0, "duplicates": 4}
    assert len(db.existing_import_hashes([r["hash"] for r in rows])) == 4
    tx = db.list_transactions("2025-01")
    assert len(tx) == 4 and all(t["source"] == "import" for t in tx)
    assert "merchant" in db.budget_summary("2025-01")["transactions"][0]


def test_manual_transaction_still_works(tmpdb):
    t = db.create_transaction({"category": "food", "amount": 9.5, "date": "2025-01-01"})
    assert t["source"] == "manual" and t["merchant"] == "Food" and t["import_hash"] is None


def test_rules_and_recategorize(tmpdb):
    r = db.create_rule("Blue Bottle", "fun")
    r2 = db.create_rule("blue bottle", "food")  # same pattern, any case: upsert
    assert r["id"] == r2["id"] and len(db.list_rules()) == 1
    assert db.list_rules()[0]["category"] == "food"
    db.insert_imported_transactions([
        {"date": "2025-01-01", "merchant": "Blue Bottle Coffee", "amount": 5, "category": "other", "hash": "a"},
        {"date": "2025-01-02", "merchant": "Shell", "amount": 40, "category": "other", "hash": "b"},
    ])
    assert db.recategorize_by_pattern("blue bottle", "food") == 1
    cats = {t["merchant"]: t["category"] for t in db.list_transactions()}
    assert cats == {"Blue Bottle Coffee": "food", "Shell": "other"}
    first = db.list_transactions()[0]
    assert db.update_transaction_category(first["id"], "income")["kind"] == "income"
    assert db.delete_rule(r["id"]) is True and db.delete_rule(r["id"]) is False


# ── refunds & fallback names ──────────────────────────────

def _prev(desc, amount):
    return importer.build_preview([{"date": "2025-03-01", "description": desc, "amount": amount}])[0]


def test_merchant_refund_is_negative_spending_not_income():
    r = _prev("AMAZON REFUND", 25.0)
    assert (r["kind"], r["category"], r["refund"]) == ("expense", "shopping", True)
    r = _prev("STARBUCKS RETURN", 4.5)
    assert (r["kind"], r["category"]) == ("expense", "food")


def test_tax_refund_and_payroll_stay_income():
    for desc in ("IRS TREAS 310 TAX REF", "STATE TAX REFUND", "ACME PAYROLL"):
        r = _prev(desc, 900.0)
        assert (r["kind"], r["category"], r["refund"]) == ("income", "income", False), desc


def test_refund_reduces_category_and_savings_rate(tmpdb):
    rows = [
        {"date": "2025-03-01", "merchant": "Amazon", "note": "AMAZON PURCHASE", "amount": 100.0,
         "kind": "expense", "category": "shopping", "hash": "a"},
        {"date": "2025-03-05", "merchant": "Amazon", "note": "AMAZON REFUND", "amount": -30.0,
         "kind": "expense", "category": "shopping", "hash": "b"},
        {"date": "2025-03-02", "merchant": "Acme", "note": "PAYROLL", "amount": 1000.0,
         "kind": "income", "category": "income", "hash": "c"},
    ]
    db.insert_imported_transactions(rows)
    s = db.budget_summary("2025-03")
    assert s["income"] == 1000.0 and s["expenses"] == 70.0
    assert s["savings_rate"] == 93.0
    assert next(c for c in s["categories"] if c["category"] == "shopping")["spent"] == 70.0
    assert db.spending_by_month(["2025-03"])["2025-03"]["shopping"] == 70.0


def test_migrate_refunds_idempotent(tmpdb):
    db.insert_imported_transactions([
        {"date": "2025-03-05", "merchant": "Amazon Refund", "note": "AMAZON REFUND", "amount": 30.0,
         "kind": "income", "category": "income", "hash": "r1"},
        {"date": "2025-03-06", "merchant": "Irs Treas", "note": "IRS TREAS 310 TAX REF", "amount": 500.0,
         "kind": "income", "category": "income", "hash": "r2"},
    ])
    with db.conn() as c:
        assert db.migrate_refunds(c) == 1
        assert db.migrate_refunds(c) == 0
    by = {t["note"]: t for t in db.list_transactions("2025-03")}
    assert (by["AMAZON REFUND"]["kind"], by["AMAZON REFUND"]["amount"], by["AMAZON REFUND"]["category"]) \
        == ("expense", -30.0, "shopping")
    assert by["IRS TREAS 310 TAX REF"]["kind"] == "income"


def test_every_transaction_has_a_name(tmpdb):
    assert importer.display_name("", "RAW TEXT 123", "food") == "RAW TEXT 123"
    assert importer.display_name("", "  ", "trading_fees") == "Trading Fees"
    assert _prev("", -5.0)["merchant"] == "Other"
    db.insert_imported_transactions([
        {"date": "2025-03-05", "merchant": "", "note": "", "amount": 5.0, "kind": "expense",
         "category": "fun", "hash": "n1"}])
    with db.conn() as c:  # simulate an old row with no name at all
        c.execute("INSERT INTO transactions (date,category,amount,kind,note,merchant) "
                  "VALUES ('2025-03-07','food',3,'expense','Corner shop','')")
    names = {t["merchant"] for t in db.list_transactions("2025-03")}
    assert names == {"Fun", "Corner shop"}
