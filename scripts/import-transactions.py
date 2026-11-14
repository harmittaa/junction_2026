#!/usr/bin/env python3
"""Import the pinned, complete 24-month demo customer slice (stdlib only)."""

import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import re


SOURCE_COMMIT = "fbdecdedf1a1f49dd641c2e6b9f2b62d0dc0cc8f"
SOURCE_URL = (
    "https://media.githubusercontent.com/media/hackjunction/Junction-2026-S-pankki/"
    f"{SOURCE_COMMIT}/tx_junction_transactions.csv"
)
SOURCE_SHA256 = "49b3265d8e44e751de305a074dcffcda732bb79aa1e07b46fcca774ce76f1e63"
CUSTOMER_ID = "CUST04060"
START = "2024-10-01"
END = "2026-09-30"
REFERENCE_DATE = "2026-09-01"
FIELDS = [
    "customer_id", "bank_account_id", "tx_date", "tx_timestamp", "category",
    "tx_amount_eur", "balance_after_eur", "transaction_type", "merchant_id", "mcc_code",
]


def amount_cents(value: str) -> int:
    """Parse source decimal euros exactly; reject fractional cents, NaN and exponents."""
    match = re.fullmatch(r"([+-]?)([0-9]+)(?:\.([0-9]{1,2}))?", value)
    if match is None:
        raise ValueError(f"Invalid euro amount: {value!r}")
    sign, euros, fraction = match.groups()
    cents = int(euros) * 100 + int((fraction or "").ljust(2, "0"))
    return -cents if sign == "-" else cents


def build_dataset(source: Path) -> dict:
    # Verify the whole file before interpreting or exporting any of its rows.
    with source.open("rb") as raw:
        digest = hashlib.file_digest(raw, "sha256").hexdigest()
        if digest != SOURCE_SHA256:
            raise ValueError(f"Source SHA-256 mismatch: expected {SOURCE_SHA256}, got {digest}")
        raw.seek(0)
        # Reuse the verified open file, rather than reopening a possibly replaced path.
        with io.TextIOWrapper(raw, encoding="utf-8-sig", newline="") as text:
            reader = csv.DictReader(text)
            if reader.fieldnames != FIELDS:
                raise ValueError("Unexpected transaction CSV header")
            transactions = []
            previous_line = reader.line_num
            for row in reader:
                source_row = previous_line + 1
                previous_line = reader.line_num
                if row["customer_id"] != CUSTOMER_ID or not START <= row["tx_date"] <= END:
                    continue
                transactions.append({
                    "id": f"row-{source_row}",
                    "sourceRow": source_row,
                    "customerId": row["customer_id"],
                    "accountId": row["bank_account_id"],
                    "date": row["tx_date"],
                    "timestamp": row["tx_timestamp"],
                    "category": row["category"],
                    "amountCents": amount_cents(row["tx_amount_eur"]),
                    "balanceAfterCents": amount_cents(row["balance_after_eur"]),
                    "transactionType": row["transaction_type"],
                    "merchantId": None if row["merchant_id"] in ("", ".") else row["merchant_id"],
                    "mcc": None if row["mcc_code"] in ("", ".") else row["mcc_code"],
                })
    if not transactions:
        raise ValueError("Demo customer has no transactions in the selected period")
    return {
        "customerId": CUSTOMER_ID,
        "period": {"start": START, "end": END},
        "referenceDate": REFERENCE_DATE,
        "source": {"url": SOURCE_URL, "commit": SOURCE_COMMIT, "sha256": digest},
        "transactions": transactions,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Downloaded full CSV (not its Git LFS pointer)")
    parser.add_argument(
        "--output", type=Path,
        default=Path(__file__).resolve().parents[1] / "data/demo-transactions.json",
    )
    args = parser.parse_args()
    try:
        dataset = build_dataset(args.source)
    except ValueError as error:
        parser.error(str(error))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(dataset, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(dataset['transactions'])} transactions to {args.output}")


if __name__ == "__main__":
    main()
