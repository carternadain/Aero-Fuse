"""Bank / card statement import: parse CSV, OFX and QFX files, clean up merchant
names and guess a budget category.

Pure functions only (no FastAPI, no database) so they are easy to unit test.
"""

import csv
import hashlib
import io
import re
from datetime import date, datetime, timedelta

EXPENSE_CATEGORIES = ["rent", "food", "transport", "subscriptions", "fun",
                      "trading_fees", "health", "shopping", "other"]

# ── Parsing ───────────────────────────────────────────────

_DATE_HEADERS = ["transaction date", "trans date", "posting date", "post date",
                 "posted date", "date posted", "date"]
_DESC_HEADERS = ["description", "payee", "name", "merchant", "memo", "details",
                 "transaction description"]
_AMOUNT_HEADERS = ["amount", "transaction amount"]
_DEBIT_HEADERS = ["debit", "debits", "withdrawal", "withdrawals", "money out", "paid out"]
_CREDIT_HEADERS = ["credit", "credits", "deposit", "deposits", "money in", "paid in"]

_DATE_FORMATS = ["%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d", "%d %b %Y", "%d %B %Y",
                 "%b %d, %Y", "%B %d, %Y", "%d-%b-%Y", "%d-%b-%y", "%m-%d-%Y", "%m-%d-%y",
                 "%Y%m%d"]


def parse_date(text: str) -> str | None:
    s = (text or "").strip().strip('"')
    if not s:
        return None
    s = re.split(r"[T ](?=\d{1,2}:\d{2})", s)[0].strip()  # drop a time of day
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    # day-first like 25/12/2024 (first number can't be a month)
    m = re.fullmatch(r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})", s)
    if m and int(m.group(1)) > 12:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        y += 2000 if y < 100 else 0
        try:
            return datetime(y, mo, d).strftime("%Y-%m-%d")
        except ValueError:
            return None
    return None


def parse_amount(text: str) -> float | None:
    s = (text or "").strip()
    if not s:
        return None
    s = s.replace("\u2212", "-").replace("\u2013", "-")
    neg = False
    if s.startswith("(") and s.endswith(")"):
        neg, s = True, s[1:-1]
    if re.search(r"\b(DR|DB)\b\s*$", s, re.I):
        neg = True
    s = re.sub(r"\b(CR|DR|DB)\b", "", s, flags=re.I)
    s = re.sub(r"[^\d.\-+]", "", s)
    if s.endswith("-"):
        neg, s = True, s[:-1]
    if not s or s in "-+.":
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return -abs(v) if neg else v


def _norm_header(h: str) -> str:
    return re.sub(r"\s+", " ", (h or "").strip().strip('"').lower())


def _pick(headers: list[str], wanted: list[str]) -> int | None:
    for w in wanted:
        if w in headers:
            return headers.index(w)
    return None


def _sniff_delimiter(sample: str) -> str:
    lines = [l for l in sample.splitlines() if l.strip()][:20]
    best, best_score = ",", -1
    for d in [",", ";", "\t", "|"]:
        counts = [l.count(d) for l in lines]
        if not counts or max(counts) == 0:
            continue
        # a good delimiter shows up a consistent number of times
        common = max(set(counts), key=counts.count)
        score = common * counts.count(common)
        if score > best_score:
            best, best_score = d, score
    return best


def _parse_csv(text: str) -> list[dict]:
    delim = _sniff_delimiter(text)
    rows = list(csv.reader(io.StringIO(text), delimiter=delim))
    header_idx = None
    for i, row in enumerate(rows[:40]):
        h = [_norm_header(c) for c in row]
        has_date = _pick(h, _DATE_HEADERS) is not None
        has_amt = (_pick(h, _AMOUNT_HEADERS) is not None
                   or (_pick(h, _DEBIT_HEADERS) is not None or _pick(h, _CREDIT_HEADERS) is not None))
        if has_date and has_amt:
            header_idx = i
            break
    if header_idx is None:
        raise ValueError("I couldn't find the column headers. The file needs at least a date column "
                         "and an amount (or debit/credit) column.")
    h = [_norm_header(c) for c in rows[header_idx]]
    di = _pick(h, _DATE_HEADERS)
    ni = _pick(h, _DESC_HEADERS)
    ai = _pick(h, _AMOUNT_HEADERS)
    dbi = _pick(h, _DEBIT_HEADERS)
    cri = _pick(h, _CREDIT_HEADERS)
    if ni is None:
        raise ValueError("I couldn't find a description column (like Description, Payee or Memo).")

    out = []
    for row in rows[header_idx + 1:]:
        if not row or len(row) <= max(di, ni):
            continue
        date = parse_date(row[di])
        if not date:
            continue  # blank lines, totals, footers
        amount = None
        if ai is not None and ai < len(row):
            amount = parse_amount(row[ai])
        if amount is None and (dbi is not None or cri is not None):
            debit = parse_amount(row[dbi]) if dbi is not None and dbi < len(row) else None
            credit = parse_amount(row[cri]) if cri is not None and cri < len(row) else None
            if debit:
                amount = -abs(debit)
            elif credit:
                amount = abs(credit)
        if amount is None or amount == 0:
            continue
        desc = re.sub(r"\s+", " ", row[ni]).strip()
        out.append({"date": date, "description": desc, "amount": round(amount, 2)})
    return out


def _ofx_field(block: str, tag: str) -> str:
    m = re.search(rf"<{tag}>\s*([^<\r\n]*)", block, re.I)
    return m.group(1).strip() if m else ""


def _unescape(s: str) -> str:
    return (s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
            .replace("&quot;", '"').replace("&apos;", "'"))


def _parse_ofx(text: str) -> list[dict]:
    blocks = re.findall(r"<STMTTRN>(.*?)(?=</STMTTRN>|<STMTTRN>|</BANKTRANLIST>|</CCSTMTRS>|$)",
                        text, re.I | re.S)
    if not blocks:
        raise ValueError("I couldn't find any transactions in that OFX/QFX file.")
    out = []
    for b in blocks:
        date = parse_date(re.sub(r"[^\d].*$", "", _ofx_field(b, "DTPOSTED"))[:8])
        amount = parse_amount(_ofx_field(b, "TRNAMT").replace(",", "."))
        if not date or amount is None or amount == 0:
            continue
        name = _unescape(_ofx_field(b, "NAME"))
        memo = _unescape(_ofx_field(b, "MEMO"))
        desc = re.sub(r"\s+", " ", name or memo).strip()
        out.append({"date": date, "description": desc, "amount": round(amount, 2)})
    return out


def parse(filename: str, content: str) -> list[dict]:
    """Return [{date 'YYYY-MM-DD', description, amount}] with negative = money out."""
    text = (content or "").lstrip("\ufeff")
    if not text.strip():
        raise ValueError("That file looks empty.")
    name = (filename or "").lower()
    is_ofx = name.endswith((".ofx", ".qfx")) or re.search(r"<OFX>|OFXHEADER", text[:2000], re.I)
    try:
        rows = _parse_ofx(text) if is_ofx else _parse_csv(text)
    except ValueError:
        raise
    except Exception:
        raise ValueError("I couldn't read that file. Try a CSV, OFX or QFX export from your bank.")
    if not rows:
        raise ValueError("I read the file but found no transactions in it.")
    return rows


# ── Screenshot (OCR) parsing ──────────────────────────────

_MONTHS = {m: i + 1 for i, m in enumerate(
    "jan feb mar apr may jun jul aug sep oct nov dec".split())}
_WEEKDAY = r"(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+"

# Header / balance lines of a card app. Matched as a prefix, so "Available credit $4,500.00" is dropped too.
_SHOT_NOISE = re.compile(
    r"^(?:transactions?|recent activity|activity|see all|view all|balance|available credit|"
    r"statement balance|current balance|pending balance|credit limit|payment due|minimum payment|"
    r"due date|card ending|gold card|robinhood|search|filter|all activity|home|cash back|rewards?)\b", re.I)
_SHOT_TIME = re.compile(r"^\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?$", re.I)      # status bar clock or a time line
_SHOT_BATTERY = re.compile(r"^\d{1,3}\s*%$")
_SHOT_CATEGORY = re.compile(
    r"^(?:restaurants?|groceries|grocery|food(?: & drink| and drink)?|fast food|coffee(?: shops?)?|shopping|"
    r"travel|transportation|transport|entertainment|health(?:care)?|gas|bills(?: & utilities)?|utilities|"
    r"subscriptions?|services?|other|uncategorized|fees?|education|home|personal|gifts?|general merchandise|"
    r"automotive|insurance|pets?|software|streaming|online|in[- ]store|card present|purchase|declined|posted)$", re.I)
_SHOT_PAYMENT = re.compile(r"\b(?:payment received|auto-?\s?pay|thank you)\b|^payment\b", re.I)

# An amount at the end of a line: optional sign, $ (or OCR'd "S" glued to digits), digits, optional
# trailing minus. The part before it must end in whitespace (or be empty).
_SHOT_AMOUNT = re.compile(
    r"(?:^|(?<=\s))(?P<sign>[+\-\u2212\u2013]?)\s*(?P<cur>\$|S(?=\d))?\s*"
    r"(?P<num>\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+[.,]\d{2}|\d+)\s*(?P<trail>[-\u2212\u2013]?)\s*$")


def _shot_amount(line: str) -> tuple[str, float, bool] | None:
    """Split 'Starbucks $5.45' into ('Starbucks', 5.45, plus_sign). None if no amount at the end."""
    m = _SHOT_AMOUNT.search(line)
    if not m:
        return None
    num = m.group("num")
    if not m.group("cur") and not re.search(r"[.,]\d{2}$", num):
        return None  # a bare integer without $ is not safely an amount ("Store 42")
    if re.search(r",\d{2}$", num):          # "5,45" comma decimal
        num = num[:-3].replace(",", "").replace(".", "") + "." + num[-2:]
    else:
        num = num.replace(",", "")
    value = float(num)
    if value == 0:
        return None
    plus = m.group("sign") == "+"
    return line[:m.start()].strip(), value, plus


def _shot_date(line: str, today: date) -> date | None:
    """Parse a date/status line ('Oct 8', '10/08', 'Pending', 'Yesterday', '2 days ago')."""
    s = line.lower().strip()
    s = re.sub(r"[\u2022\u00b7|]", " ", s)
    s = re.sub(r"[,\s]*\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?$", "", s)   # trailing time of day
    s = re.sub(r"\b(?:pending|posted|on)\b", " ", s) if re.search(r"[a-z]{3}\w*\s+\d|\d/\d", s) else s
    s = re.sub(r"\s+", " ", s).strip(" ,.")
    if s in ("pending", "today", "posted today", "just now"):
        return today
    if s == "yesterday":
        return today - timedelta(days=1)
    m = re.fullmatch(r"(\d{1,2}) days? ago", s)
    if m:
        return today - timedelta(days=int(m.group(1)))
    s = re.sub(rf"^{_WEEKDAY}", "", s)
    month = day = year = None
    m = re.fullmatch(r"([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?", s)
    if m and m.group(1)[:3] in _MONTHS:
        month, day, year = _MONTHS[m.group(1)[:3]], int(m.group(2)), m.group(3)
    else:
        m = re.fullmatch(r"(\d{1,2})/(\d{1,2})(?:/(\d{2}|\d{4}))?", s)
        if m:
            month, day, year = int(m.group(1)), int(m.group(2)), m.group(3)
    if month is None:
        return None
    try:
        if year:
            y = int(year)
            return date(y + 2000 if y < 100 else y, month, day)
        d = date(today.year, month, day)
        if d > today + timedelta(days=2):  # no year shown: a far-future date means last year
            d = date(today.year - 1, month, day)
        return d
    except ValueError:
        return None


def parse_screenshot_text(text: str, today: date) -> list[dict]:
    """Turn OCR text from a card-app screenshot into rows shaped like parse():
    {date 'YYYY-MM-DD', amount (charges negative, refunds/payments positive), description}.

    Two layouts are handled: date *section headers* above their rows, and a date/status line
    *below* each row. Which one applies is decided by whether the first amount comes before
    the first date line."""
    # Pass 1: classify every line.
    items: list[tuple[str, object]] = []
    for raw in (text or "").splitlines():
        line = re.sub(r"\s+", " ", raw).strip(" \t\u2022\u00b7|")
        if not line:
            continue
        if _SHOT_NOISE.match(line) and not _shot_date(line, today):
            items.append(("noise", None))
        elif _SHOT_TIME.match(line) or _SHOT_BATTERY.match(line):
            items.append(("time", None))      # ignorable, but does not break a merchant/amount pair
        elif (d := _shot_date(line, today)) is not None:
            items.append(("date", d))
        elif (a := _shot_amount(line)) is not None:
            items.append(("amount", a))
        elif not re.search(r"[A-Za-z]", line) or _SHOT_CATEGORY.match(line):
            items.append(("time", None))
        else:
            items.append(("text", line))

    kinds = [k for k, _ in items]
    row_mode = "amount" in kinds and ("date" not in kinds or kinds.index("amount") < kinds.index("date"))

    rows: list[dict] = []
    undated: list[dict] = []
    section = today
    candidate: str | None = None   # last merchant-looking line, used when the amount is on its own line
    cand_after_row = False         # candidate came right after a finished row (maybe that row's subtitle)
    prev = None                    # previous significant item kind ("time" lines are transparent)
    for kind, val in items:
        if kind == "time":
            continue
        if kind == "noise":
            candidate = None
        elif kind == "text":
            candidate, cand_after_row = val, prev == "amount"
        elif kind == "date":
            candidate = None   # a date line separates a dangling merchant from the next row
            if row_mode:
                for r in undated:
                    r["date"] = val.isoformat()
                undated = []
            else:
                section = val
        elif kind == "amount":
            prefix, value, plus = val
            # "Starbucks" / "Restaurants $6.45": the amount sits on the subtitle line, so the
            # pending line above is the merchant. But a pending line right after a finished row
            # may just be that row's subtitle ("Shopping"), so an inline merchant wins unless the
            # inline text itself looks like a subtitle.
            if prefix and candidate and not (cand_after_row and not _SHOT_CATEGORY.match(prefix)):
                merchant = candidate
            else:
                merchant = prefix or candidate or ""
            candidate = None
            # drop leading icon glyphs OCR picks up from the merchant avatar
            merchant = re.sub(r"^[^\w$]+", "", merchant).strip(" -:\u2022\u00b7")
            if not re.search(r"[A-Za-z]", merchant):
                continue
            is_payment = bool(_SHOT_PAYMENT.search(merchant))
            positive = plus or is_payment
            if is_payment and not _TRANSFER.search(merchant):
                merchant = "Payment received"  # so categorize() files a bare "Payment" as a transfer
            row = {"date": None if row_mode else section.isoformat(),
                   "amount": round(value if positive else -value, 2), "description": merchant}
            rows.append(row)
            if row_mode:
                undated.append(row)
        prev = kind
    for r in undated:   # no date line found for these: assume today
        r["date"] = today.isoformat()
    return rows


# ── Merchant cleanup ──────────────────────────────────────

_PREFIXES = re.compile(
    r"^(?:POS DEBIT|POS PURCHASE|POS|DEBIT CARD PURCHASE|DEBIT CARD|DEBIT|PURCHASE AUTHORIZED ON(?: \d{1,2}/\d{1,2})?|"
    r"PURCHASE|CHECKCARD|CHECK CARD|VISA|RECURRING PAYMENT|RECURRING|ACH DEBIT|ACH|"
    r"ONLINE PAYMENT TO|PAYMENT TO|PMT)\b[\s:\-]*")
_PROCESSORS = re.compile(r"^(?:SQ|SQU|TST|SP|PP|PAYPAL|DD|GGLPAY|APLPAY|IN|BT)\s*\*\s*")
_AMAZON = re.compile(r"^(?:AMZN MKTP|AMAZON MKTPL?|AMAZON\.COM|AMAZON|AMZN)\b")
_STATES = ("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM "
           "NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC").split()


def _title(s: str) -> str:
    return " ".join(w[:1].upper() + w[1:].lower() for w in s.split())


def clean_merchant(description: str) -> str:
    original = re.sub(r"\s+", " ", description or "").strip()
    s = original.upper()
    for _ in range(4):  # prefixes can stack: "POS DEBIT CHECKCARD ..."
        new = _PREFIXES.sub("", s).strip()
        if new == s:
            break
        s = new
    s = re.sub(r"^\d{4}\s+(?=[A-Z])", "", s)                   # CHECKCARD 0105 MERCHANT
    s = _PROCESSORS.sub("", s)
    s = re.sub(r"X{2,}\d{2,6}", " ", s)                       # card digits XXXX1234
    s = re.sub(r"\*{2,}\d+", " ", s)
    s = re.sub(r"\bCARD\s*\d{3,4}\b", " ", s)
    s = re.sub(r"\b\d{1,2}/\d{1,2}(?:/\d{2,4})?\b", " ", s)   # dates
    s = re.sub(r"\b(?:\+?1[\s-]?)?\(?\d{3}\)?[\s-]\d{3}[\s-]\d{4}\b", " ", s)  # phone numbers
    # "AMAZON.COM*2K4AB" / "UBER *TRIP": drop an opaque reference after '*', else treat * as space
    s = re.sub(r"\*(?=[A-Z0-9]*\d[A-Z0-9]*(?:\s|$))\S*", " ", s)
    s = s.replace("*", " ")
    s = re.sub(r"\bHELP\.\S+", " ", s)
    s = re.sub(r"\s+-\s*(?:WEB|ONLINE)$", "", s.strip())
    s = re.sub(r"\s+", " ", s).strip()

    if _AMAZON.match(s) and "PRIME" not in s:
        s = "AMAZON"

    # Everything from the first store/reference number onward is location noise
    # (store number, city, state).
    tokens = s.split(" ")
    cut = None
    for i, t in enumerate(tokens):
        if i > 0 and re.fullmatch(r"#?\d{2,}[A-Z]?|#\w+", t):
            cut = i
            break
    if cut is not None:
        tokens = tokens[:cut]
    elif len(tokens) > 2 and tokens[-1] in _STATES:
        tokens = tokens[:-1]
    while tokens and tokens[-1] in {"STORE", "NO", "#", "ST", "INC", "LLC", "ONLINE", "PURCHASE"} and len(tokens) > 1:
        tokens.pop()
    s = " ".join(t for t in tokens if t and t != "#")
    s = re.sub(r"[\s\-_.,#]+$", "", s)
    if not s:
        return _title(original.upper()) or "Unknown"
    return _title(s)


# ── Categorizing ──────────────────────────────────────────

_TRANSFER = re.compile(
    r"\b(transfer|xfer|trnsfr|payment\s*-?\s*thank\s*you|thank you for your payment|auto\s?pay|autopay|"
    r"online payment|e-?payment|epayment|credit card payment|crcardpmt|card payment|mobile payment|"
    r"payment received|to savings|from savings|to checking|from checking|"
    r"zelle (?:to|from) (?:me|myself|self)|venmo cashout|cash out to bank|ach pull|ach push)\b", re.I)

_INCOME = re.compile(
    r"\b(payroll|direct\s?dep\w*|salary|paycheck|pay check|interest (?:paid|payment|earned|credit)|"
    r"int(?:erest)? pd|dividend|div(?:idend)? pmt|bonus|tax refund|irs treas|gusto|adp|"
    r"cashback|cash back reward|reimbursement)\b", re.I)

# Genuine income that merely mentions "refund" (a tax refund is income, not negative spending).
_TAX_REFUND = re.compile(r"\b(tax\s+ref(?:und)?|irs\s+treas\w*|state\s+tax|fed(?:eral)?\s+tax|treas\s+\d*\s*tax)\b", re.I)
# A merchant giving money back: counts as negative spending in the category it came from.
_REFUND = re.compile(
    r"\b(refunds?|refunded|returns?|returned|reversal|merch(?:andise)?\s+ret(?:urn)?|purchase\s+adj\w*)\b", re.I)
_NOT_REFUND = re.compile(r"\b(ach\s+return|returned\s+(?:check|item|payment|deposit)|return\s+of\s+principal)\b", re.I)


def is_refund(text: str) -> bool:
    """True when statement text describes a merchant refund (not a tax refund / income)."""
    t = text or ""
    return bool(_REFUND.search(t)) and not _TAX_REFUND.search(t) and not _NOT_REFUND.search(t) \
        and not _INCOME.search(t)


def guess_expense_category(text: str) -> str:
    for cat, rx in _EXPENSE_RX:
        if rx.search(text.lower()):
            return cat
    return "other"


def display_name(merchant: str | None, raw: str | None, category: str | None) -> str:
    """A readable name for a transaction: merchant, else raw statement text, else the category."""
    for cand in (merchant, raw):
        c = re.sub(r"\s+", " ", cand or "").strip()
        if c and c.lower() != "unknown":
            return c
    return _title((category or "").replace("_", " ")) or "Transaction"

# order matters: first match wins ("uber eats" must hit food before transport)
_EXPENSE_KEYWORDS: list[tuple[str, str]] = [
    ("rent", r"\b(rent|landlord|mortgage|property mgmt|property management|apartments?|hoa|leasing|"
             r"pg&e|pge|con ?ed|electric|water bill|utilities|utility|sewer|waste management)\b"),
    ("trading_fees", r"\b(coinbase|binance|kraken|bybit|toobit|okx|interactive brokers|ibkr|tradingview|"
                     r"tastytrade|tastyworks|webull|margin interest|brokerage fee|exchange fee)\b"),
    ("food", r"\b(uber ?eats|doordash|grubhub|postmates|instacart|safeway|kroger|trader joe|whole ?foods|"
             r"wholefds|aldi|publix|h-?e-?b|sprouts|albertsons|wegmans|grocery|supermarket|starbucks|"
             r"dunkin|peet|blue bottle|coffee|cafe|caf\u00e9|bakery|deli|mcdonald|burger|chipotle|"
             r"taco|pizza|sushi|restaurant|grill|diner|kitchen|bistro|noodle|ramen|thai|bbq|"
             r"subway|chick-?fil-?a|panera|wendy|domino|brewery|brewing|pub|bar & grill|food)\b"),
    ("subscriptions", r"\b(netflix|spotify|hulu|disney ?\+?|hbo|max\.com|youtube|apple\.com/bill|icloud|"
                      r"apple music|google (?:one|storage)|patreon|openai|chatgpt|anthropic|claude\.ai|"
                      r"github|adobe|dropbox|microsoft 365|office 365|audible|nytimes|new york times|"
                      r"substack|prime video|amazon prime|verizon|at&t|t-?mobile|comcast|xfinity|"
                      r"spectrum|internet|subscription|membership fee)\b"),
    ("health", r"\b(cvs|walgreens?|pharmacy|rite aid|doctor|dr\.|dental|dentist|clinic|hospital|medical|"
               r"kaiser|optometr\w*|vision|urgent care|labcorp|quest diag\w*|gym|fitness|yoga|peloton|"
               r"equinox|health|therapy|chiropract\w*)\b"),
    ("transport", r"\b(uber|lyft|shell|chevron|exxon|mobil|bp|arco|76|texaco|gas station|fuel|parking|"
                  r"toll|transit|bart|mta|metro|amtrak|delta air\w*|united air\w*|southwest air\w*|"
                  r"american air\w*|jetblue|geico|progressive|dmv|autozone|jiffy lube|car wash|"
                  r"fastrak|ez-?pass|clipper)\b"),
    ("fun", r"\b(movie|cinema|amc|regal|theat(?:er|re)|ticketmaster|stubhub|steam|playstation|xbox|"
            r"nintendo|casino|bowling|golf|concert|eventbrite|hotel|airbnb|booking\.com|expedia|vrbo|"
            r"marriott|hilton|hyatt|bookstore|barnes|game)\b"),
    ("shopping", r"\b(amazon|amzn|target|walmart|best ?buy|home ?depot|lowe'?s|ikea|etsy|ebay|nike|"
                 r"apple store|macy'?s|nordstrom|tj ?maxx|marshalls|ross|old navy|gap|zara|uniqlo|"
                 r"sephora|ulta|wayfair|costco|bed bath|kohl'?s|chewy|temu|shein)\b"),
]
_EXPENSE_RX = [(cat, re.compile(rx, re.I)) for cat, rx in _EXPENSE_KEYWORDS]


def categorize(merchant: str, description: str, amount: float, rules: list[dict] | None = None):
    """Return (kind, category, is_transfer). `amount` is signed (negative = money out)."""
    hay = f"{merchant} {description}".lower()

    best = None
    for r in rules or []:
        p = (r.get("pattern") or "").strip().lower()
        if p and p in hay and (best is None or len(p) > len((best["pattern"]).strip())):
            best = r
    if best:
        cat = best["category"]
        kind = best.get("kind") or ("income" if cat == "income" else "expense")
        return kind, cat, False

    if _TRANSFER.search(hay):
        return ("income" if amount > 0 else "expense"), "other", True

    if amount > 0:
        return "income", "income", False

    for cat, rx in _EXPENSE_RX:
        if rx.search(hay):
            return "expense", cat, False
    return "expense", "other", False


# ── Hashing / preview assembly ────────────────────────────

def row_hashes(rows: list[dict]) -> list[str]:
    """sha1 of date|amount|normalized description, plus an occurrence index so two
    identical same-day charges in one file both import (and re-importing dedupes)."""
    seen: dict[str, int] = {}
    out = []
    for r in rows:
        desc = re.sub(r"\s+", " ", r["description"].upper()).strip()
        key = f"{r['date']}|{r['amount']:.2f}|{desc}"
        n = seen.get(key, 0)
        seen[key] = n + 1
        out.append(hashlib.sha1(f"{key}|{n}".encode()).hexdigest())
    return out


def build_preview(parsed: list[dict], rules: list[dict] | None = None, flip_sign: bool = False) -> list[dict]:
    """Turn parsed rows into previewable rows. Hashes use the file's own signs, so they
    don't change when the user toggles flip_sign."""
    hashes = row_hashes(parsed)
    out = []
    for r, h in zip(parsed, hashes):
        amt = -r["amount"] if flip_sign else r["amount"]
        merchant = clean_merchant(r["description"])
        kind, category, transfer = categorize(merchant, r["description"], amt, rules)
        refund = False
        if amt > 0 and not transfer and kind == "income" and category == "income" \
                and is_refund(f"{merchant} {r['description']}"):
            # Money back from a merchant: negative spending in the category it likely had.
            refund = True
            kind, category = "expense", guess_expense_category(f"{merchant} {r['description']}")
        elif amt > 0 and not transfer and kind == "expense" and category != "income" \
                and is_refund(f"{merchant} {r['description']}"):
            refund = True  # a user rule already filed it under a spending category
        out.append({
            "date": r["date"], "description": r["description"],
            "merchant": display_name(merchant, r["description"], category),
            "amount": round(abs(amt), 2), "kind": kind, "category": category,
            "transfer": transfer, "refund": refund, "hash": h,
        })
    return out
