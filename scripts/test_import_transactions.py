"""Deterministic import contract checks; no network or large source required."""

import csv
import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    "import_transactions", Path(__file__).with_name("import-transactions.py")
)
importer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(importer)


class ImportTests(unittest.TestCase):
    def test_exact_money(self):
        for source, expected in [
            ("-32.51", -3251), ("-511.9", -51190), ("2280.78", 228078),
            ("0", 0), ("-0.01", -1), ("+1.2", 120),
            ("90071992547409.93", 9007199254740993),
        ]:
            with self.subTest(source=source):
                self.assertEqual(importer.amount_cents(source), expected)
        for invalid in ["1.001", "NaN", "Infinity", "1e2", "1,20", "", " 1.20"]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                importer.amount_cents(invalid)

    def test_complete_scoped_slice_and_physical_source_lines(self):
        text = io.StringIO(newline="")
        writer = csv.writer(text)
        writer.writerow(importer.FIELDS)
        for customer, date, amount, balance, kind, merchant, mcc in [
            ("CUST04060", "2024-09-30", "-1", "99", "purchase", "M1", "5411"),
            ("CUST04060", "2024-10-01", "-32.51", "100.05", "purchase", "M1", "5411"),
            ("OTHER", "2024-10-02", "-9", "50", "purchase", "M1", "5411"),
            ("CUST04060", "2026-02-05", "3.29", "-3.5", "refund", ".", "."),
            ("CUST04060", "2026-09-30", "-219.64", "7", "investment_deposit", "", ""),
            ("CUST04060", "2026-10-01", "-7", "12", "purchase", "M1", "5411"),
        ]:
            writer.writerow([customer, "ACC-test", date, "raw timestamp", "test\ncategory",
                             amount, balance, kind, merchant, mcc])
        data = text.getvalue().encode("utf-8-sig")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source.csv"
            path.write_bytes(data)
            # The production pin is never bypassed by the CLI. Pin this fixture in-process.
            with patch.object(importer, "SOURCE_SHA256", hashlib.sha256(data).hexdigest()):
                result = importer.build_dataset(path)
        self.assertEqual(result["customerId"], "CUST04060")
        self.assertEqual(result["period"], {"start": "2024-10-01", "end": "2026-09-30"})
        self.assertEqual(result["referenceDate"], "2026-09-01")
        rows = result["transactions"]
        self.assertEqual([r["id"] for r in rows], ["row-4", "row-8", "row-10"])
        self.assertEqual([r["sourceRow"] for r in rows], [4, 8, 10])
        self.assertEqual([r["amountCents"] for r in rows], [-3251, 329, -21964])
        self.assertEqual([r["balanceAfterCents"] for r in rows], [10005, -350, 700])
        self.assertEqual([r["transactionType"] for r in rows], ["purchase", "refund", "investment_deposit"])
        self.assertEqual(rows[0], {
            "id": "row-4", "sourceRow": 4, "customerId": "CUST04060", "accountId": "ACC-test",
            "date": "2024-10-01", "timestamp": "raw timestamp", "category": "test\ncategory",
            "amountCents": -3251, "balanceAfterCents": 10005, "transactionType": "purchase", "merchantId": "M1", "mcc": "5411",
        })
        self.assertEqual([(r["merchantId"], r["mcc"]) for r in rows[1:]], [(None, None), (None, None)])

    def test_rejects_unverified_source(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pointer.csv"
            path.write_text("version https://git-lfs.github.com/spec/v1\n")
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                importer.build_dataset(path)


if __name__ == "__main__":
    unittest.main()
