# Agent Instructions & Guidelines for Noodle

Welcome to **Noodle**! This repository is a decentralized, client-only replacement frontend for Tel Aviv University's Moodle platform, packaged as a Chrome Browser Extension and an Expo React Native mobile app.

---

## ⚡ Quick Reference: Critical Non-Negotiables

1. **Package Manager**: **Always use `pnpm`**. Never run `npm` or `yarn` (workspace link mismatches will break monorepo dependencies).
2. **Pure TypeScript in Shared Client**: Code under `packages/moodle-client` MUST remain pure TypeScript. Do NOT import Node-specific modules (`fs`, `path`, `crypto`, `axios`, etc.). Use the standard `fetch()` API. The client runs inside Chrome Manifest V3 Service Workers and React Native's Hermes engine.
3. **Moodle API Returns HTTP 200 on Errors**: Moodle's REST endpoints frequently return HTTP status `200 OK` even when an API call fails. Always check for `{ exception: "...", message: "..." }` in the JSON response body and throw a typed `MoodleApiError`.
4. **`legacy/` is Strictly Read-Only**: The `legacy/` directory contains the original Python implementation. Treat it as a specification and reference for porting logic. Never modify files in `legacy/` unless explicitly instructed.
5. **Session Teardown & Cache-Busting**: When logging out, perform both local storage wipe AND server-side session invalidation with cache-busting query params (`?_t=${Date.now()}`) and `cache: 'no-store'`.
6. **Cross-Browser Extension Parity**: The extension supports both **Chromium** (Chrome, Edge, Brave) and **Firefox**. Every extension feature, build, and test must be verified on both engines (`build:chrome` and `build:firefox`).
7. **Test Case Traceability**: Consult `docs/TEST_CASES.md` before and after modifying features. When introducing or changing features, reference or add corresponding `TC-*` test IDs across both automated and browser interaction modalities.
8. **Mandatory CHANGELOG Updates**: Every single change (feature, bugfix, UI change, or refactoring that affects behavior) MUST be recorded in [`CHANGELOG.md`](file:///d:/ProgramFiles/Projects/Noodle/CHANGELOG.md) under `## [Unreleased]` adhering to [Keep a Changelog](https://keepachangelog.com/) standards (`Added`, `Changed`, `Fixed`, `Removed`).
9. **Mandatory Documentation Synchronization**: On **every change**, the agent MUST update the corresponding documentation files in `docs/` (e.g. `docs/TEST_CASES.md`, `docs/API_DESCRIPTION.md`, `docs/ARCHITECTURE.md`, `docs/UI_SPECIFICATION.md`, `docs/AI_KNOWLEDGE.md`). Code and documentation must never drift apart.

---

## 🧭 Monorepo Structure

```text
Noodle/
├── apps/
│   ├── extension/            # Chrome & Firefox Extension (Vite + React 19 + TypeScript, MV3)
│   └── mobile/               # Mobile App (Expo SDK 56 + React Native)
├── packages/
│   └── moodle-client/        # Shared pure TypeScript API & sync engine (@tautracker/moodle-client)
├── legacy/                   # READ-ONLY Python reference implementation (FastAPI, scrapers, tests)
├── docs/                     # Authoritative specifications, testing catalogs, and guides
└── .agents/                  # Modular agent rules and skills
    └── rules/                # Detailed rule files (see below)
```

---

## 🛠️ Common Commands

| Task | Command |
| :--- | :--- |
| **Install Dependencies** | `pnpm install` |
| **Build Shared Client** | `pnpm run build:moodle-client` |
| **Run Extension Dev (Chrome)** | `pnpm --filter extension run dev` |
| **Run Extension Dev (Firefox)** | `pnpm --filter extension run dev:firefox` |
| **Build Extension (All)** | `pnpm --filter extension run build` |
| **Build Extension (Chrome)** | `pnpm --filter extension run build:chrome` |
| **Build Extension (Firefox)** | `pnpm --filter extension run build:firefox` |
| **Run Extension Linter** | `pnpm --filter extension run lint` |
| **Run Mobile App (Expo)** | `pnpm --filter mobile run start` |
| **Run Mobile Web** | `pnpm --filter mobile run web` |
| **Run Moodle Client Tests** | `pnpm --filter @tautracker/moodle-client test` |

---

## 📚 Detailed Rules & Documentation Index

For in-depth procedures and rules, read the modular rule files in `.agents/rules/`:

- [`.agents/rules/01-project-overview.md`](file:///d:/ProgramFiles/Projects/Noodle/.agents/rules/01-project-overview.md): Full project architecture, tech stack, and monorepo topology.
- [`.agents/rules/02-documentation-map.md`](file:///d:/ProgramFiles/Projects/Noodle/.agents/rules/02-documentation-map.md): When and how to consult the files in `docs/`.
- [`.agents/rules/03-coding-constraints.md`](file:///d:/ProgramFiles/Projects/Noodle/.agents/rules/03-coding-constraints.md): Platform constraints, deadline formulas, Moodle API quirks, Google Tasks sync.
- [`.agents/rules/04-testing-and-testcases.md`](file:///d:/ProgramFiles/Projects/Noodle/.agents/rules/04-testing-and-testcases.md): Testing philosophy, catalog management in `docs/TEST_CASES.md`, and runner commands.
- [`.agents/rules/05-git-workflow.md`](file:///d:/ProgramFiles/Projects/Noodle/.agents/rules/05-git-workflow.md): Conventional commits, issue linking conventions, and branch hygiene.
