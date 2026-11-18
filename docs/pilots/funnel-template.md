# SafeEat funnel analysis template

Purpose: decide whether barcode capture/decoding is a large enough share of SafeEat failures and abandons to justify any scanner work. This is the first Phase 0 step and the first `NO-GO` check.

The instrumentation lives in the SafeEat repository. This repository holds only this template and the aggregate numbers copied into it. Never paste frames, barcode values, product identities, profiles, or health data here.

## Collection window

| Field | Value |
|---|---|
| SafeEat build/version | |
| Window (start - end, UTC) | |
| Platform segments covered (iOS Safari, Android Chrome, other) | |
| Instrumentation PR (SafeEat repo link) | |
| Analyst | |

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
| Sessions started | | | | |
| `completed_task` | | | | |
| `camera_permission` | | | | |
| `camera_lifecycle` | | | | |
| `no_decode` | | | | |
| `wrong_decode` | | | | |
| `network` | | | | |
| `product_not_found` | | | | |
| `data_insufficient` | | | | |
| `user_cancellation` | | | | |

Check: all categories sum to sessions started (note any unclassified remainder explicitly).

## Calculation

- Failures and abandons F = sessions started - `completed_task`.
- Capture/decode share = (`camera_permission` + `camera_lifecycle` + `no_decode` + `wrong_decode`) / F.
- Report the share with a Wilson 95% confidence interval and per platform segment.
- Optional sensitivity: the share excluding `camera_permission` (user denial is not fixable by a better decoder).
- Projected completion gain upper bound = capture/decode share x F / sessions started (the most a perfect scanner could add), expressed in percentage points.

## Decision

- Capture/decode share < 20%: `NO-GO` stands. Stop Phase 0.
- Projected completion gain < 5 percentage points: `NO-GO`.
- Otherwise continue to the replay harness.

| Result | Value |
|---|---|
| Capture/decode share (95% CI) | |
| Projected completion gain upper bound (pp) | |
| Decision | |
| Decided by / date | |

## Privacy checklist

- [ ] Events are category counts only; no frames, crops, barcode values, product identities, profile or health data.
- [ ] The allow-list schema was approved before collection.
- [ ] No per-user identifiers beyond what SafeEat already holds under its own consent.
- [ ] Only aggregates are recorded in this repository.
