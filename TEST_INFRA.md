# E2E Test Infra: TauTracker

## Test Philosophy
- Opaque-box, requirement-driven. No dependency on implementation design.
- Methodology: Category-Partition + BVA + Pairwise + Workload Testing.

## Feature Inventory
| # | Feature | Source (requirement) | Tier 1 | Tier 2 | Tier 3 |
|---|---------|---------------------|:------:|:------:|:------:|
| 1 | First-time User Onboarding | ORIGINAL_REQUEST R1 | 5      | 5      | yes    |
| 2 | Empty States (Courses/Tasks) | ORIGINAL_REQUEST R1 | 5      | 5      | yes    |
| 3 | Error Handling (Moodle Token) | ORIGINAL_REQUEST R2 | 5      | 5      | yes    |
| 4 | UI Tooltips (Technical Terms) | ORIGINAL_REQUEST R2 | 5      | 5      | yes    |
| 5 | Inline Course Name Editing | ORIGINAL_REQUEST R2 | 5      | 5      | yes    |
| 6 | Task "Marked as Done" Status | ORIGINAL_REQUEST R3 | 5      | 5      | yes    |
| 7 | Task Personal Notes | ORIGINAL_REQUEST R3 | 5      | 5      | yes    |
| 8 | Google Tasks Integration | ORIGINAL_REQUEST R3 | 5      | 5      | yes    |
| 9 | Dashboard Widget Reordering | ORIGINAL_REQUEST R4 | 5      | 5      | yes    |
| 10 | Custom Course Colors | ORIGINAL_REQUEST R4 | 5      | 5      | yes    |
| 11 | Course Progress Bars | ORIGINAL_REQUEST R4 | 5      | 5      | yes    |
| 12 | Global Search (English/Hebrew) | ORIGINAL_REQUEST R4 | 5      | 5      | yes    |

## Test Architecture
- Test runner: `pytest` using `Playwright` for E2E opaque-box browser testing, with `pytest-html` for reporting.
- Test case format: Python `pytest` functions exercising the frontend app at `http://localhost:5000` or equivalent.
- Directory layout:
  - `tests/e2e/conftest.py` (fixtures, browser setup, DB reset)
  - `tests/e2e/tier1_feature/`
  - `tests/e2e/tier2_boundary/`
  - `tests/e2e/tier3_cross_feature/`
  - `tests/e2e/tier4_workloads/`

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | New user login, onboarding, and configuring empty dashboard | F1, F2, F9, F10 | Medium |
| 2 | Active student renaming courses, setting colors, and viewing progress | F4, F9, F10, F11 | Medium |
| 3 | Managing tasks: adding notes, marking done, and overriding by submit | F5, F6, F7, F11 | High |
| 4 | Token expiration during task sync with Google Tasks | F3, F8 | High |
| 5 | Global search for specific tasks and using tooltips to understand terms | F4, F12 | Low |
| 6 | Full semester workflow: from empty to full, notes, colors, Google Tasks | All | Very High |

## Coverage Thresholds
- Tier 1: >=5 per feature (Total: 60)
- Tier 2: >=5 per feature (where boundaries exist, Total: 60)
- Tier 3: pairwise coverage of major feature interactions (Total: ~12)
- Tier 4: >=6 realistic application scenarios
