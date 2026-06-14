# Noodle Privacy Policy

**Effective Date:** June 2026

At Noodle, we believe your data is exactly that: yours. We have built Noodle from the ground up to operate completely autonomously on your device without the need for any centralized servers or tracking.

## 1. What We Collect
**Nothing.** Noodle does not track, use, aggregate, or collect any personal data, usage statistics, or telemetry. We do not have servers, and therefore we have no databases containing user information.

## 2. Where Your Data Lives
Because Noodle is a decentralized, client-side application:
- **Authentication Credentials:** Your Moodle session information and Google OAuth tokens are stored securely in your browser's local, encrypted storage (`chrome.storage.local`) or your mobile device's secure enclave (`expo-secure-store`).
- **Application Data:** All synced courses, assignments, and grades are stored locally on your device.

## 3. How We Use Your Data
Your data never leaves your device except to communicate directly with the services you authorize:
1. **Moodle (Tel Aviv University):** To fetch your latest assignments and grades.
2. **Google Tasks:** To create and manage tasks corresponding to your assignments.

At no point does this data pass through any Noodle-owned infrastructure.

## 4. Third-Party Services
Noodle interacts with Moodle and Google APIs directly from your client. Please refer to their respective privacy policies regarding how they handle your data when you interact with their services:
- [Google Privacy Policy](https://policies.google.com/privacy)
- Tel Aviv University / Moodle Privacy Guidelines

## 5. Changes to This Policy
If we ever change the way Noodle operates—such as introducing server-side features—we will update this policy and notify you. However, our commitment to zero-data collection is a core architectural principle of the project.
