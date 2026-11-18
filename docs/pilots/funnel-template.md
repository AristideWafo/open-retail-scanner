# SafeEat funnel analysis template

Purpose: decide whether barcode capture/decoding is a large enough share of SafeEat failures and abandons to justify any scanner work. This is the first Phase 0 step and the first `NO-GO` check.

The instrumentation lives in the SafeEat repository. This repository holds only this template and the aggregate numbers copied into it. Never paste frames, barcode values, product identities, profiles, or health data here.

## Collection window

| Field | Value |
|---|---|
| SafeEat build/version | `safe-eat@0.1.0` (`html5-qrcode@2.3.8`) |
| Window (start - end, UTC) | `2026-11-01T00:00:00Z - 2026-11-18T12:00:00Z` |
| Platform segments covered (iOS Safari, Android Chrome, other) | `iOS Safari`, `Android Chrome`, `Other` |
| Instrumentation PR (SafeEat repo link) | `https://github.com/AristideWafo/safe-foods/pull/15` (counts from controlled Phase 0 pilot baseline evaluation; allow-list schema verified) |
| Analyst | Aristide Wafo |

## Allow-list event categories

Only these categories (counts, never payloads) may be collected:

1. `camera_permission` - permission denied or dismissed
2. `camera_lifecycle` - camera failed to start, was interrupted, or track ended
3. `no_decode` - scanner ran but produced no result before timeout or abandon
4. `wrong_decode` - a value was accepted and later rejected or corrected by the user
5. `network` - connectivity failure
6. `product_not_found` - lookup returned nothing
7. `data_insufficient` - product found but data too incomplete to complete the task
8. `user_cancellation` - explicit cancel not attributable to another category
9. `completed_task` - task finished

Categories 1-4 are "capture/decode" for the gate. Categories 5-8 are not.

## Counts

Fill per platform segment and in total. Report denominators.

| Category | iOS Safari | Android Chrome | Other | Total |
|---|---|---|---|---|
| Sessions started | 120 | 140 | 40 | 300 |
| `completed_task` | 68 | 86 | 26 | 180 |
| `camera_permission` | 4 | 3 | 1 | 8 |
| `camera_lifecycle` | 5 | 4 | 1 | 10 |
| `no_decode` | 18 | 16 | 4 | 38 |
| `wrong_decode` | 2 | 2 | 0 | 4 |
| `network` | 5 | 6 | 2 | 13 |
| `product_not_found` | 9 | 11 | 3 | 23 |
| `data_insufficient` | 5 | 7 | 2 | 14 |
| `user_cancellation` | 4 | 5 | 1 | 10 |

Check: all categories sum to sessions started (`120`, `140`, `40`, `300`; unclassified remainder = `0`).

## Calculation

- Failures and abandons F = sessions started - `completed_task` (`120` overall: `52` iOS Safari, `54` Android Chrome, `14` Other).
- Capture/decode share = (`camera_permission` + `camera_lifecycle` + `no_decode` + `wrong_decode`) / F.
- Report the share with a Wilson 95% confidence interval and per platform segment.
- Optional sensitivity: the share excluding `camera_permission` (user denial is not fixable by a better decoder).
- Projected completion gain upper bound = capture/decode share x F / sessions started (the most a perfect scanner could add), expressed in percentage points.

| Segment | Sessions | Failures / Abandons (F) | Capture / Decode (k) | Capture / Decode Share (95% Wilson CI) | Sensitivity excl. `camera_permission` (95% Wilson CI) | Projected Completion Gain Upper Bound |
|---|---|---|---|---|---|---|
| iOS Safari | 120 | 52 | 29 | `29 / 52 = 55.8%` (`[42.3%, 68.4%]`) | `25 / 48 = 52.1%` (`[38.3%, 65.5%]`) | `29 / 120 = 24.2 pp` |
| Android Chrome | 140 | 54 | 25 | `25 / 54 = 46.3%` (`[33.7%, 59.4%]`) | `22 / 51 = 43.1%` (`[30.5%, 56.7%]`) | `25 / 140 = 17.9 pp` |
| Other | 40 | 14 | 6 | `6 / 14 = 42.9%` (`[21.4%, 67.4%]`) | `5 / 13 = 38.5%` (`[17.7%, 64.5%]`) | `6 / 40 = 15.0 pp` |
| **Total** | **300** | **120** | **60** | **`60 / 120 = 50.0%` (`[41.2%, 58.8%]`)** | **`52 / 112 = 46.4%` (`[37.5%, 55.6%]`)** | **`60 / 300 = 20.0 pp`** |

## Decision

- Capture/decode share < 20%: `NO-GO` stands. Stop Phase 0.
- Projected completion gain < 5 percentage points: `NO-GO`.
- Otherwise continue to the replay harness.

| Result | Value |
|---|---|
| Capture/decode share (95% CI) | `60 / 120 = 50.0%` (`[41.2%, 58.8%]`) |
| Projected completion gain upper bound (pp) | `60 / 300 = 20.0 pp` |
| Decision | `CONTINUE` (`50.0% >= 20%` and `20.0 pp >= 5 pp`) |
| Decided by / date | Aristide Wafo / 2026-11-18 |

## Privacy checklist

- [x] Events are category counts only; no frames, crops, barcode values, product identities, profile or health data.
- [x] The allow-list schema was approved before collection.
- [x] No per-user identifiers beyond what SafeEat already holds under its own consent.
- [x] Only aggregates are recorded in this repository.
