# Rule: Testing & Test Cases Management

Testing in Noodle is requirement-driven and tracked through an authoritative catalog: [`docs/TEST_CASES.md`](file:///d:/ProgramFiles/Projects/Noodle/docs/TEST_CASES.md). Every change, bugfix, or feature must align with this catalog.

---

## 1. The Two Testing Modalities

Every test case in Noodle belongs to one or both modalities:

### A. Automated Testing (`Automated`)
- **Unit & Parser Tests**: Programmatic tests with Jest / ts-jest under `packages/moodle-client/__tests__/`.
- **Core Commands**:
  ```bash
  pnpm --filter @tautracker/moodle-client test
  pnpm run build:moodle-client
  pnpm --filter extension run build:chrome
  pnpm --filter extension run build:firefox
  ```
- **Component & Integration Tests**: Headless tests asserting UI state or mock responses.
- **Rule**: All parsing logic (course shortnames, dates, Moodle API responses, deadline formulas) must have automated unit test coverage.

### B. Gemini Browser Interaction Testing (`Browser Agent`)
- **Definition**: Verification conducted by an AI Agent equipped with browser interaction capabilities (e.g. `/browser` command or DevTools).
- **Target Environments**:
  - **Chromium Extension** dev mode: `pnpm --filter extension run dev`
  - **Firefox Extension** dev mode: `pnpm --filter extension run dev:firefox`
  - **Mobile Web Preview**: `pnpm --filter mobile run web` (at `http://localhost:8081`)
- **Rule**: For UI/UX changes, run the dev server and verify visual components, dark/light themes, tooltips, RTL/LTR layout, and empty states.

---

## 2. Test Tiers & Methodology

All test cases in [`docs/TEST_CASES.md`](file:///d:/ProgramFiles/Projects/Noodle/docs/TEST_CASES.md) adhere to the 4-tier model:
- **Tier 1 (Feature Functionality)**: Happy path verification for each requirement across Mobile, Chrome, and Firefox.
- **Tier 2 (Boundary Value & Partitioning)**: Boundary dates, empty strings, Hebrew/special characters, network drops.
- **Tier 3 (Cross-Feature Pairwise)**: Interactions between multiple features (e.g. course color changes + offline caching).
- **Tier 4 (Real-World Workloads)**: End-to-end user scenarios (e.g. initial login -> syncing 10 courses -> marking task done -> Google Tasks sync).

---

## 3. Rules for Modifying or Adding Test Cases

1. **Check Existing Catalog First**:
   - Before implementing any feature or fix, search [`docs/TEST_CASES.md`](file:///d:/ProgramFiles/Projects/Noodle/docs/TEST_CASES.md) to locate the relevant test IDs (e.g., `TC-AUTH-01`, `TC-CRS-03`, `TC-EXT-BRW-01`).
2. **Cross-Browser Verification for Extension**:
   - Every extension change MUST build and function on both **Chromium** (`build:chrome`) and **Firefox** (`build:firefox`). Consult the `TC-EXT-BRW-*` cases for engine-specific concerns (MV3 service workers vs event page scripts, OAuth redirect URLs, cookie partitions).
3. **Adding New Test Cases**:
   - When introducing new features, append new test entries to [`docs/TEST_CASES.md`](file:///d:/ProgramFiles/Projects/Noodle/docs/TEST_CASES.md) following the established format:
     ```markdown
     | TC-XXX-NN | Feature / Action | Platform Target | Modality | Category |
     ```
   - Provide a detailed step-by-step description with Preconditions, Automated Test Flow, and Browser Agent Action.
4. **Keep Builds & Shared Core Green**:
   - Never commit code that breaks tests or builds:
     ```bash
     pnpm --filter @tautracker/moodle-client test
     pnpm --filter extension run build:chrome
     pnpm --filter extension run build:firefox
     pnpm --filter extension run lint
     ```
