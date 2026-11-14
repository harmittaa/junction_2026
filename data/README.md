# Bounded Sponky demo transactions

This is **synthetic historical data**, not a live bank feed. No demographic file
was imported, and no age, household, motive or affordability is inferred.

## Selection and provenance

- Customer `CUST04060`, account `ACC004060`: a richer customer with a full history.
- Inclusive period: **2024-10-01 through 2026-09-30**. All **1,082** source rows for
  this customer are preserved, in source order: contiguous CSV lines
  **2,897,327–2,898,408**, IDs `row-2897327` through `row-2898408`. Types:
  purchase 935, housing_payment 24, utilities_payment 72, salary 24,
  investment_deposit 24, other_income 3.
- Initial **simulated reference date: 2026-09-01**. “Last month” means August
  2026, not the current calendar month. The app must cap queries at its active
  reference date: the file intentionally also contains later September 2026
  records. Import does not filter by reference date or economic purpose.
- Full source: [pinned Git LFS media CSV](https://media.githubusercontent.com/media/hackjunction/Junction-2026-S-pankki/fbdecdedf1a1f49dd641c2e6b9f2b62d0dc0cc8f/tx_junction_transactions.csv).
- Source commit: `fbdecdedf1a1f49dd641c2e6b9f2b62d0dc0cc8f`.
- Full source size: **362,796,501 bytes**, **3,626,755 data records**.
- Full source SHA-256:
  `49b3265d8e44e751de305a074dcffcda732bb79aa1e07b46fcca774ce76f1e63`.
- Generated JSON SHA-256:
  `96f2a4a8da60bad84f649a134747a53950582d026c2f9b99bc60152ad3d0b69c`.

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

This selected customer has **12 rows with MCC 4121** (first: 2024-12-25, 58.81 EUR;
last: 2026-06-04, 32.36 EUR) among their Transportation rows. They are a taxi
proxy only; never treat the whole Transportation category as taxis, and do not
infer taxis from missing MCCs. The demo's starter question uses Groceries.

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
using Python `Decimal` (not the importer's integer parser). The generated JSON
(1,082 rows, lines 2,897,327–2,898,408) and the application's `calculateSpending`
match them.

| Category | August 2026 spending (cents) | Rows |
| --- | ---: | ---: |
| Entertainment | 51,654 | 5 |
| Groceries | 111,106 | 16 |
| Health | 12,507 | 3 |
| Home & Tech | 39,420 | 5 |
| Housing | 88,679 | 1 |
| Lifestyle | 52,543 | 4 |
| Restaurants | 17,205 | 10 |
| Transportation | 38,472 | 9 |
| Travel | 23,252 | 3 |
| Utilities | 10,040 | 3 |
| **Total** | **444,878 (€4,448.78)** | **59** |

August 2026 is the “last month” at the 2026-09-01 reference date. Rows dated
September 2026 stay in the file for later simulated days and must not be
exposed before their date. At the reference date, September 1 has Health line
2,898,352 (**1,627 cents**) and Housing line 2,898,353 (**90,342 cents**).
September 2 has Entertainment line 2,898,354 (**2,786 cents**) and no
Housing; the first Groceries row after the reference date is September 4.
User-confirmed habit/check-in completion is app state, not inferred from
these transactions.

## Checks

- Focused unittest suite: exact money (including values beyond binary-float
  integer precision), invalid fractional cents, BOM, physical source lines,
  date/customer scope, boundary inclusion, preserving refund/transfer fixture
  rows, missing-field normalization, and checksum rejection.
- Complete pinned-source import and independent Decimal reconciliation: 1,082
  records, the type counts, August 2026 category totals and MCC 4121 rows above.
- Regenerate to a second output and byte-compare it to the committed JSON.
- No app, provider or browser checks are implied by this data-only description.
