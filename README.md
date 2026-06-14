# TauTracker

TauTracker is a custom, modern, dark-themed replacement frontend for the Tel Aviv University Moodle platform.

Historically built as a client-server application, TauTracker has transitioned into a fully decentralized, client-only architecture packaged as:
1. **Chrome Browser Extension** (`apps/extension`)
2. **React Native Mobile App** (`apps/mobile`) via Expo

By communicating directly with Moodle from your device and saving tokens locally, TauTracker eliminates external databases, protects sensitive user credentials, and avoids IP blockages.

---

## Project Structure

This project is organized as a monorepo utilizing **pnpm** workspaces:
- `apps/extension`: Vite + React + TypeScript Chrome Extension (Manifest V3)
- `apps/mobile`: Expo SDK 56 + React Native client
- `packages/moodle-client`: Shared API integration layer with Moodle

---

## Prerequisites

Ensure you have the following installed on your machine:
- **Node.js** (v18+ recommended)
- **pnpm** (Required; do not use standard npm/yarn to avoid workspace link mismatches)
  ```bash
  npm install -g pnpm
  ```

---

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd TauTracker
   ```

2. Install all dependencies:
   ```bash
   pnpm install
   ```

---

## Browser Extension

### 1. Dev Mode (Hot Reloading)
Run Vite in development mode to test local interface changes:
```bash
pnpm --filter extension run dev
```

### 2. Build for Chrome
To build the extension package:
```bash
pnpm --filter extension run build
```
This compiles the code and assets into the `apps/extension/dist` folder.

### 3. Loading in Chrome
1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Toggle **Developer mode** in the top-right corner.
3. Click **Load unpacked** in the top-left.
4. Select the `apps/extension/dist` directory.

### 4. Moodle Authentication
When loaded, click the TauTracker icon to open the popup. Click **Connect Moodle** to open the TAU login page. Once logged in, the extension automatically intercepts the temporary token and logs you in.

---

## Mobile App

The mobile application is built using React Native and Expo (SDK 56).

### 1. Start the Expo Dev Server
```bash
pnpm --filter mobile run start
```

### 2. Running the App
Once the dev server is active, you can interact with it via the command line interface:
- **Expo Go App (Physical Device)**: Download **Expo Go** from the iOS App Store or Google Play Store. Scan the QR code printed in your terminal.
- **Android Emulator**: Press `a` in the terminal to launch the app on a connected Android Virtual Device (AVD).
- **iOS Simulator**: Press `i` in the terminal (macOS required) to launch the app on an iOS simulator.
- **Web Browser**: Press `w` to run a web-compatible version of the app in your browser.
