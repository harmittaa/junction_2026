# Bounded Sponky demo transactions

This is **synthetic historical data**, not a live bank feed. No demographic file
was imported, and no age, household, motive or affordability is inferred.

## Selection and provenance

- Customer `CUST00001`, account `ACC000001` (preferred customer was suitable).
- Inclusive period: **2024-10-01 through 2024-11-30**. All **39** source rows for
  this customer in these two months are preserved, in source order: CSV lines
  **2–40**, IDs `row-2` through `row-40`. October has 18 rows; November has 21.
- Initial **simulated reference date: 2024-11-04**. “Last month” means October
  2024, not the current calendar month. The app must cap queries at its active
  reference date: the file intentionally also contains later November records.
  Import does not filter by reference date or economic purpose.
- Full source: [pinned Git LFS media CSV](https://media.githubusercontent.com/media/hackjunction/Junction-2026-S-pankki/fbdecdedf1a1f49dd641c2e6b9f2b62d0dc0cc8f/tx_junction_transactions.csv).
- Source commit: `fbdecdedf1a1f49dd641c2e6b9f2b62d0dc0cc8f`.
- Full source size: **362,796,501 bytes**, **3,626,755 data records**.
- Full source SHA-256:
  `49b3265d8e44e751de305a074dcffcda732bb79aa1e07b46fcca774ce76f1e63`.
- Generated JSON SHA-256:
  `9ebe451c383ab10926db7a33884011805a5de292724b5d2103ad2ed40e50e3f4`.

`sourceRow` is the 1-based physical CSV line where the record starts, including
the header as line 1. The source has one record per line. Customer/account/date,
category, transaction type, and source timestamp strings are preserved. For
example `03OCT24:09:04:04` is **not** converted to UTC: the CSV supplies no timezone.
Dates are ISO calendar dates. Signed euro decimals become signed integer cents
without floating-point arithmetic or rounding. Blank or `.` merchant/MCC fields
map to JSON `null`; MCCs remain strings. Account balances are not in the agreed
export contract. No source row is removed because it is income or a transfer.

## Reproduce (Python 3.11+, standard library only)

Run from the repository root. Keep the large CSV outside the checkout:

```sh
mkdir -p ../sponky-source
curl --fail --location --retry 2 \
  'https://media.githubusercontent.com/media/hackjunction/Junction-2026-S-pankki/fbdecdedf1a1f49dd641c2e6b9f2b62d0dc0cc8f/tx_junction_transactions.csv' \
  -o ../sponky-source/tx_junction_transactions.csv
python3 scripts/import-transactions.py ../sponky-source/tx_junction_transactions.csv
python3 -m unittest discover -s scripts -p 'test_import_transactions.py' -v
```

The importer verifies the **whole file** against the pinned SHA-256 before
parsing or writing output. An LFS pointer, truncated download or changed source
fails. There is no CLI checksum override. Default output is
`data/demo-transactions.json`; `--output PATH` supports a separate comparison
copy. Selection is deliberately fixed to this demo, not a general import system.

## Observed conventions across the full source

The scan found the following **eight** transaction types and signs. Counts
reconcile to all 3,626,755 source records; there are no zero amounts, positive
purchases, negative income types or explicit refund transaction types.

| Type | Source category | Sign | Records |
| --- | --- | --- | ---: |
| `purchase` | Eight merchant categories below | Negative | 3,000,711 |
| `housing_payment` | Housing | Negative | 112,903 |
| `utilities_payment` | Utilities | Negative | 342,728 |
| `investment_deposit` | Invest Deposit | Negative | 35,668 |
| `salary_sweep` | Salary Sweep | Negative | 6,189 |
| `salary` | Salary | Positive | 121,725 |
| `other_income` | Other Income | Positive | 6,299 |
| `investment_withdrawal` | Invest Withdraw | Positive | 532 |

Negative means account outflow, not automatically consumption. Investment
deposits and salary sweeps are non-consumption cash movements; withdrawals are
not purchase refunds. No refund can be established from a positive amount alone.
The brief describes missing merchant/MCC values as non-card transfers, but
missing MCC also occurs on purchases, so **do not use null MCC as a transfer
filter**. This import preserves refunds if encountered; it never synthesizes
them. The observed absence of refunds is specific to this pinned source, not a
general banking guarantee.

All **15** categories are listed in the tables here: eight purchase categories
below, plus Housing, Utilities, Invest Deposit, Salary Sweep, Salary, Other
Income and Invest Withdraw. (Housing and Utilities are payment categories;
the remaining five are cash-flow categories.)

| Purchase category | Nonblank MCCs observed in full source |
| --- | --- |
| Groceries | 5411, 5422, 5451, 5499 |
| Restaurants | 5812, 5813, 5814 |
| Transportation | 4111, 4121, 5541, 5542, 7523 |
| Entertainment | 7832, 7922, 7991, 7996, 7999 |
| Health | 5912, 8011, 8021, 8099 |
| Home & Tech | 5200, 5251, 5712, 5732, 5734 |
| Lifestyle | 5651, 5691, 5941, 5942, 5945, 5999 |
| Travel | 4511, 4722, 7011, 7512 |

Every purchase category has some missing MCCs. Non-purchase categories have no
MCCs.

### Taxi evidence and limitation

There is no literal `Taxis` category. Source-wide Transportation records have
these MCC counts: 4111: 112,751; **4121: 59,201**; 5541: 112,293;
5542: 133,716; 7523: 133,629; missing: 75,340.
[Visa's Merchant Data Standards Manual, October 2026, pp. 48–49](https://usa.visa.com/dam/VCOM/download/merchants/visa-merchant-data-standards-manual.pdf)
identifies **4121 as Taxicabs and Limousines**, including ride-share merchants.
That is a narrower evidence-based proxy, not proof of a trip's purpose or a
precise taxi-only classification. Never rename the whole Transportation
category “taxis,” or infer taxis from missing MCCs.

This selected customer has **no Transportation, MCC 4121 or Restaurants rows**
in these two months. A taxi query therefore has zero matching records in this
slice, not six invented rides. Use **Groceries** for the nonzero demo reveal;
do not substitute a different customer's taxi rows.

## Recommended application spending rule and independent reconciliation

For an inclusive date range, scoped to this customer and bounded by the active
simulated reference date, count rows whose `amountCents < 0` and whose
`transactionType` is **`purchase`, `housing_payment` or `utilities_payment`**.
Display spending as the **negative of their signed sum**, in positive cents.
Exclude income, investment deposits/withdrawals and salary sweeps, regardless
of category or amount sign. This is **gross recorded spending**, not net cash
flow, affordability, or verified savings. No refund adjustment is possible for
this source; if future data includes refunds, define an explicit net-spending
rule before claiming net totals. Filtering and calculations belong to the app,
not this lossless import. Category/basket interpretations do not change amounts.

The following amounts were independently calculated directly from the CSV
using Python `Decimal` (not the importer's integer parser), and all 39 JSON
records/fields were separately compared with their CSV rows.

| Category | October spending (cents) | Full November spending (cents) |
| --- | ---: | ---: |
| Groceries | 75,275 | 70,172 |
| Housing | 51,190 | 53,520 |
| Utilities | 6,828 | 14,039 |
| Lifestyle | 83,442 | 49,220 |
| Health | 0 | 103,075 |
| Home & Tech | 0 | 13,104 |
| All other source categories | 0 | 0 |
| **Total** | **216,735 (€2,167.35)** | **303,130 (€3,031.30)** |

Full November is a reconciliation only: **do not expose it at November 4/5**.
October's 16 spending rows: Groceries lines 3, 5, 6, 7, 10, 12, 14, 15, 17, 18,
19; Utilities 2, 9, 16; Housing 4; Lifestyle 8. Excluded October rows: salary
line 11 **+228,078 cents** and investment deposit line 13 **−21,964 cents**.
All October rows net **−10,621 cents** (not the spending total).

November's 19 spending rows: Groceries 20, 22, 24, 25, 26, 29, 30, 34, 35, 39;
Utilities 21, 28, 36; Housing 23; Lifestyle 27; Health 32, 37, 38; Home & Tech 40.
Excluded: salary line 31 **+245,348 cents**, investment deposit line 33
**−23,627 cents**. All November rows net **−81,409 cents**.

### Simulated daily check-ins

- November 1: Groceries line 20, **4,594 cents** spending.
- November 3: Utilities line 21, **4,015 cents**, and Groceries line 22,
  **7,329 cents**. November-to-date groceries at November 4/5: **11,923 cents**.
- November 4: Housing line 23, **53,520 cents**; no groceries that day.
- November 5: **no records**, not a missing import. Reflection can still be
  completed; do not fabricate a new purchase. November-to-date total at both
  November 4 and 5: **69,458 cents**.
- First future row after November 5 is November 8 (line 24). User-confirmed
  habit/check-in completion is app state, not inferred from these transactions.

## Checks

- Focused unittest suite: exact money (including values beyond binary-float
  integer precision), invalid fractional cents, BOM, physical source lines,
  date/customer scope, boundary inclusion, preserving refund/transfer fixture
  rows, missing-field normalization, and checksum rejection.
- Complete pinned-source import and independent field-by-field reconciliation:
  39/39 records, source lines 2–40, with the totals above.
- Regenerate to a second output and byte-compare it to the committed JSON.
- No app, provider or browser checks are implied by this data-only change.
