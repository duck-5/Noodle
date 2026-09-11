# Rule: Documentation Map (`docs/`)

The `docs/` directory is the single source of truth for design specifications, API contracts, testing criteria, and project knowledge. Before implementing features or making structural changes, consult the relevant document listed below.

---

## 🗺️ Documentation Directory Index

| Document | Purpose | When an Agent MUST Read It |
| :--- | :--- | :--- |
| [`docs/AI_KNOWLEDGE.md`](file:///d:/ProgramFiles/Projects/Noodle/docs/AI_KNOWLEDGE.md) | **Core Knowledge Base & Implementation Patterns** | Read first before touching any API integration, authentication, deadline calculation, or session teardown code. |
| [`docs/TEST_CASES.md`](file:///d:/ProgramFiles/Projects/Noodle/docs/TEST_CASES.md) | **Master System Test Cases Catalog** | Authoritative catalog for all tests. Read whenever implementing a new feature, fixing a bug, writing automated tests, or conducting Gemini browser agent testing across Chromium, Firefox, and Mobile. |
| [`docs/TEST_INFRA.md`](file:///d:/ProgramFiles/Projects/Noodle/docs/TEST_INFRA.md) | **Legacy E2E Test Infra (Archived Reference)** | Historical test methodology specification for the legacy Python backend; superseded by `docs/TEST_CASES.md`. |
| [`docs/developer-guide.md`](file:///d:/ProgramFiles/Projects/Noodle/docs/developer-guide.md) | **Extension Development & Debugging** | Read when debugging the Chrome/Firefox extension, inspecting background service workers, or simulating alarms. |
| [`docs/API_DESCRIPTION.md`](file:///d:/ProgramFiles/Projects/Noodle/docs/API_DESCRIPTION.md) | **Full API Contracts & Schemas** | Read when integrating with Moodle Web Services, TAU SSO, or Google Tasks API. |
| [`docs/ARCHITECTURE.md`](file:///d:/ProgramFiles/Projects/Noodle/docs/ARCHITECTURE.md) | **System Architecture & Data Flows** | Read when modifying state management, caching layers, or inter-process communication. |
| [`docs/CORE_IDEA.md`](file:///d:/ProgramFiles/Projects/Noodle/docs/CORE_IDEA.md) | **Product Philosophy & Decentralization Rationale** | Read when evaluating architectural decisions (e.g. why Noodle must not introduce centralized backend servers). |
| [`docs/UI_SPECIFICATION.md`](file:///d:/ProgramFiles/Projects/Noodle/docs/UI_SPECIFICATION.md) | **UI/UX Guidelines, Themes & Layouts** | Read when modifying or creating frontend components in extension or mobile apps. |
| [`docs/FEATURES_DECISIONS_NEEDS.md`](file:///d:/ProgramFiles/Projects/Noodle/docs/FEATURES_DECISIONS_NEEDS.md) | **Feature Matrix & Product Requirements** | Read when clarifying requirements or understanding the motivation behind specific feature behaviors. |
| [`docs/PRIVACY_POLICY.md`](file:///d:/ProgramFiles/Projects/Noodle/docs/PRIVACY_POLICY.md) | **Privacy & Security Commitments** | Read when dealing with credentials, tokens, cookies, or any user telemetry. |

---

## 📌 Document Interaction Rules for Agents

1. **Mandatory Documentation Update on EVERY Change**:
   - Every code modification, new feature, bugfix, schema adjustment, or UI overhaul MUST be accompanied by an update to the corresponding documentation in `docs/`:
     - **Test Cases**: Update or add IDs in [`docs/TEST_CASES.md`](file:///d:/ProgramFiles/Projects/Noodle/docs/TEST_CASES.md).
     - **API Changes / New Endpoints**: Update [`docs/API_DESCRIPTION.md`](file:///d:/ProgramFiles/Projects/Noodle/docs/API_DESCRIPTION.md).
     - **Architecture & Data Flow**: Update [`docs/ARCHITECTURE.md`](file:///d:/ProgramFiles/Projects/Noodle/docs/ARCHITECTURE.md).
     - **UI Elements & CSS**: Update [`docs/UI_SPECIFICATION.md`](file:///d:/ProgramFiles/Projects/Noodle/docs/UI_SPECIFICATION.md).
     - **Implementation Quirks & Patterns**: Update [`docs/AI_KNOWLEDGE.md`](file:///d:/ProgramFiles/Projects/Noodle/docs/AI_KNOWLEDGE.md).
   - *A pull request or code change is incomplete if documentation has drifted from the code.*

2. **Mandatory CHANGELOG Updates**:
   - For **every change**, add an entry in [`CHANGELOG.md`](file:///d:/ProgramFiles/Projects/Noodle/CHANGELOG.md) under the `## [Unreleased]` section.
   - Categorize entries following Keep a Changelog: `### Added`, `### Changed`, `### Deprecated`, `### Removed`, `### Fixed`, `### Security`.
   - Specify the affected scope in bold (e.g., `- **Course Nickname Edit (`apps/mobile`, `packages/moodle-client`)**: ...`).

3. **Never Invent Moodle Endpoints**:
   - Moodle REST functions follow strict conventions (e.g. `core_course_get_enrolled_courses_by_timeline_classification`). Cross-reference `docs/API_DESCRIPTION.md` and `legacy/clients/moodle_client.py` before formulating requests.

4. **Reference Test Case IDs in PRs & Commits**:
   - Always link work to specific test cases defined in `docs/TEST_CASES.md` (e.g., `TC-AUTH-01`, `TC-ASN-03`).
