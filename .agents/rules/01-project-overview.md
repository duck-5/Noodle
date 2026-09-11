# Rule: Project Overview & Architecture

## 1. Project Mission & Identity
Noodle is a modern, dark-themed replacement frontend for Tel Aviv University (TAU) Moodle platform.
- Transitioned from a client-server architecture to a decentralized, client-only model.
- No external server or centralized database; all credentials and tokens are stored locally on the user's device.
- Direct communication with Moodle REST APIs, TAU SAML Identity Provider (`nidp.tau.ac.il`), and Google Tasks.

## 2. Monorepo Structure (`pnpm`)
The project is organized as a monorepo managed with **pnpm** (`pnpm-workspace.yaml`):

```text
Noodle/
├── apps/
│   ├── extension/            # Chrome/Firefox Web Extension (Vite, React 19, TypeScript, Manifest V3)
│   └── mobile/               # Mobile Application (Expo SDK 56, React Native, React 19)
├── packages/
│   └── moodle-client/        # Shared core TypeScript library (@tautracker/moodle-client)
├── legacy/                   # READ-ONLY Python codebase (reference implementation)
│   ├── server/               # Old FastAPI routes & database logic
│   ├── clients/              # Python scrapers & Moodle client
│   └── tests/                # Historical test suites (unit + E2E Playwright)
├── docs/                     # Authoritative design, API, and test documentation
└── .agents/                  # Agent workspace customizations & rules
```

## 3. Technology Stack by Component

### A. `apps/extension`
- **Framework**: React 19 + Vite 8 (`vite-plugin-web-extension`).
- **Target**: Manifest V3 (MV3) for **Chromium** (Chrome, Edge, Brave) and **Firefox** (Gecko).
- **Contexts**:
  - Background: Chromium uses `background.service_worker` (ephemeral 30s idle lifecycle); Firefox uses `background.scripts` (event page).
  - Extension Popup & Options page: React 19 UI components with `webextension-polyfill`.
- **Storage**: `browser.storage.local` and `browser.storage.sync`.

### B. `apps/mobile`
- **Framework**: React Native (0.85+) via Expo SDK 56.
- **Router**: `expo-router`.
- **Engine**: Hermes JavaScript engine.
- **Storage**: `expo-sqlite`, `expo-secure-store`.
- **Target Platforms**: iOS, Android, and Expo Web.

### C. `packages/moodle-client`
- Pure TypeScript business and API engine.
- Shared between `apps/extension` and `apps/mobile` via pnpm workspace reference (`workspace:*`).
- Handles Moodle REST calls, session handling, parsing course shortnames, Zoom LTI scraping, and Google Tasks two-way sync.

### D. `legacy/` (READ-ONLY)
- Contains the historical Python FastAPI backend and Playwright scripts.
- **Strict rule**: Agents must treat this folder as read-only reference documentation. Do NOT edit, delete, or refactor files in `legacy/`.

## 4. Tooling Rules
- **Package Manager**: Exclusively `pnpm`. Running `npm install` or `yarn install` can create unwanted `node_modules` nesting or break workspace symlinks.
- **TypeScript**: Shared types must be exported from `packages/moodle-client` and consumed by the apps.
