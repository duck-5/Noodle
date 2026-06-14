# Noodle — Architecture & Design Specifications

This document defines the system design, data isolation model, platform mechanics, and architectural rationale for the decentralized Noodle application.

---

## 1. System Architecture Overview

Noodle is built as a **fully decentralized, client-only application**. It does not routing requests through a centralized backend server, nor does it store user credentials in a shared cloud database. Instead, every user device (phone or browser) is its own independent API client.

```mermaid
graph TD
    subgraph User Device / Browser
        subgraph apps/extension (Chrome Extension)
            Pop[React Popup UI]
            Opt[React Options Page]
            SW[Service Worker - MV3]
            Loc[chrome.storage.local]
            SyncStore[chrome.storage.sync]
        end

        subgraph apps/mobile (Expo App)
            RN[React Native UI]
            SQL[(SQLite Database)]
            Sec[SecureStore]
            Fetch[Background Fetch Task]
        end

        subgraph packages/moodle-client (Shared Package)
            Engine[Sync Engine]
            Client[Moodle API Client]
            Parser[TAU Metadata Parser]
            GTasks[Google Tasks Sync]
        end
    end

    subgraph External Systems
        Moodle[moodle.tau.ac.il]
        Google[Google Tasks API]
    end

    %% Dependencies
    Pop --> SW
    Opt --> SW
    SW --> Engine
    Loc <--> SW
    SyncStore <--> SW

    RN --> Engine
    Fetch --> Engine
    SQL <--> RN
    SQL <--> Fetch
    Sec <--> RN
    Sec <--> Fetch

    Engine --> Client
    Engine --> Parser
    Engine --> GTasks

    Client -->|Direct HTTPS - CORS Bypass| Moodle
    GTasks -->|OAuth 2.0 REST| Google
```

---

## 2. Directory Layout & Monorepo Structure

The project utilizes a **pnpm workspaces monorepo** to share TypeScript code between the browser extension and the mobile application.

```
Noodle/
├── apps/
│   ├── mobile/                     # React Native + Expo mobile application
│   │   ├── app/                    # Expo Router file-based routing
│   │   ├── components/             # Native mobile UI components
│   │   └── services/               # SQLite wrappers, local push alerts
│   │
│   └── extension/                  # Vite + React Chrome extension (Manifest V3)
│       ├── src/
│       │   ├── background/         # Service worker execution scripts
│       │   ├── popup/              # Compact quick-access popup SPA
│       │   └── options/            # Full options dashboard page SPA
│       └── public/                 # Manifest configuration and icons
│
├── packages/
│   └── moodle-client/              # Shared pure TypeScript API integration layer
│       ├── src/
│       │   ├── moodleApi.ts        # fetch()-based Moodle Web Service functions
│       │   ├── syncEngine.ts       # Orchestrates sync stages and file extraction
│       │   └── courseParser.ts     # Regular expressions for TAU shortnames
│
└── legacy/                         # Archived Python FastAPI codebase (Reference only)
```

---

## 3. Core Architectural Components

### A. Shared Package (`packages/moodle-client`)
*   **Role:** Exposes data types, course parser regexes, API wrappers, and the core sync engine.
*   **Design Constraint:** Strictly environment-agnostic. It cannot import Node.js core libraries (e.g. `fs`, `crypto`) or browser-specific objects (like `window`). It relies entirely on standard JavaScript/TypeScript and the global `fetch()` web API. This ensures compiling and execution compatibility in both React Native (hermes/jsc engine) and Chrome Service Workers.

### B. Chrome Extension (`apps/extension`)
*   **Bundler:** Vite paired with the CRXJS plugin, which parses `manifest.json` to automatically compile background service worker files, assets, and popup HTML pages.
*   **CORS Bypass:** Bypasses Moodle's lack of CORS headers by declaring `*://moodle.tau.ac.il/*` in the manifest's `host_permissions` block. This elevates network requests originating from the **Service Worker** background context.
*   **Ephemeral Service Worker Lifecycle:** Chrome MV3 Service Workers are designed to shut down after 30 seconds of inactivity. To prevent data corruption:
    1.  No in-memory state is maintained globally.
    2.  State is fully restored from `chrome.storage.local` at the beginning of any event handler (alarm or message).
    3.  A synchronization run checkpoints course progress incrementally. If the Service Worker is terminated mid-sync, the next alarm resumes from the last successfully synced course.

### C. Mobile App (`apps/mobile`)
*   **Framework:** Expo SDK 56 + React Native.
*   **CORS Bypass:** React Native runs JavaScript in a native mobile application thread. HTTP requests made via the global `fetch()` bypass standard browser CORS checks because native network requests do not enforce Same-Origin Policies.
*   **Secure Storage:** Sensitive credentials (the Moodle `wstoken` and Google OAuth tokens) are written to `expo-secure-store`, mapping to hardware-level OS keychains.
*   **SQLite Database:** Non-sensitive data (assignments, course codes, colors, files, and zoom links) is cached in a local SQLite file using `expo-sqlite`, ensuring instantaneous UI load times and full offline usability.

---

## 4. Platform Synchronization Mechanisms

### Browser Extension Periodic Sync
*   **Mechanism:** `chrome.alarms` API.
*   **Interval:** 60 minutes.
*   **Lifecycle:** The alarm wakes the Service Worker, which retrieves the Moodle token from `chrome.storage.local`, performs the full sync via the shared library, saves the output, and issues a native Chrome notification for any new deadlines.

### Mobile App Periodic Sync
*   **Mechanism:** `expo-background-fetch` + `expo-task-manager`.
*   **Interval:** OS-controlled.
*   **iOS Execution Behavior:** iOS limits background execution frequency depending on battery level, user behavior, and network conditions. Background tasks can run every 30-120 minutes and are capped at 30 seconds of execution. The sync engine is optimized to parallelize course requests to ensure completion within this tight window.
*   **Android Execution Behavior:** Android delegates background executions to a native `WorkManager` scheduler, offering highly consistent cron-like execution intervals.

---

## 5. Rationale & Trade-offs

| Design Decision | Advantages | Trade-offs / Challenges |
| :--- | :--- | :--- |
| **Monorepo (pnpm workspaces)** | Single repository, 100% logic reuse for Moodle Web Service calls, easy type synchronization. | Incremental build setups, config overhead for TypeScript compile paths. |
| **No Central Proxy Server** | Infinite scaling, zero hosting costs, absolute security compliance, immune to centralized IP blocking. | Client apps must perform OAuth logic themselves; no server to schedule reliable push notifications. |
| **Local SQLite on Mobile** | Blazing-fast UI rendering, complete offline read capability, simple data structures. | Requires database schema migration support when structural attributes change. |
| **MV3 Service Worker Sync** | Runs silently in the background of the browser, low power drain. | Service workers are terminated frequently, necessitating strict state serialization. |
