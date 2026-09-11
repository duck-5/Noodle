# Rule: Git & Commit Workflow

To ensure a clean history and smooth collaboration, follow these Git conventions.

---

## 1. Commit Message Conventions

Use **Conventional Commits** formatting. Keep the subject line concise (under 72 characters), imperative, and clear.

### Format
```text
<type>(<optional scope>): <description> [optional issue reference]

[optional body explaining why and what changed]

[optional footer: Fixes #<issue_number>]
```

### Supported Types
- **`feat`**: A new feature for the extension, mobile app, or client.
  - *Example*: `feat(extension): add course color picker palette #10`
- **`fix`**: A bug fix.
  - *Example*: `fix(moodle-client): ignore zero timestamps in deadline computation (Fixes #9)`
- **`docs`**: Documentation updates in `docs/` or README.
  - *Example*: `docs: document submitted files and Moodle SSO auto-login in CHANGELOG`
- **`test`**: Adding or refactoring automated tests.
  - *Example*: `test(moodle-client): add unit tests for TC-CRS-02 semester parser`
- **`refactor`**: Code changes that neither fix a bug nor add a feature.
  - *Example*: `refactor(mobile): extract task card into reusable component`
- **`chore`**: Build system, dependencies, or configuration changes.
  - *Example*: `chore: update pnpm workspace dependencies`

---

## 2. Issue Tracking & References

- When working on an open GitHub issue, reference it directly in the commit message:
  - `Fixes #<number>` or `Closes #<number>` if the commit resolves the issue.
  - `Relates to #<number>` if it is partial progress.
- Match existing project commit history style (e.g. `Fixes #9`, `Fixes Anchor sidebar menu to scrollable view #22`).

---

## 3. Hygiene & Safety Rules

- **Never Commit Secrets**: Do NOT commit personal Moodle passwords, SSO credentials, `.env` files, or OAuth client secrets.
- **Never Commit Temporary Profiles**: The Vite extension dev server stores session profiles in `apps/extension/.dev-profile/`. Ensure these files remain untracked.
- **Never Modify `legacy/`**: Do not commit changes to files within `legacy/` without explicit user permission.
- **Mandatory CHANGELOG Entry**: Every commit that adds, modifies, or fixes functionality MUST include an entry in [`CHANGELOG.md`](file:///d:/ProgramFiles/Projects/Noodle/CHANGELOG.md) under `## [Unreleased]`.
- **Mandatory Documentation Sync**: Any change affecting APIs, schemas, tests, UI, or architecture must include matching updates in `docs/`.
- **Pre-Commit Verification Checklist**:
  1. `CHANGELOG.md` updated with human-readable description under `## [Unreleased]`
  2. Relevant `docs/` files updated (e.g., [`docs/TEST_CASES.md`](file:///d:/ProgramFiles/Projects/Noodle/docs/TEST_CASES.md), [`docs/API_DESCRIPTION.md`](file:///d:/ProgramFiles/Projects/Noodle/docs/API_DESCRIPTION.md))
  3. Shared client build succeeds: `pnpm run build:moodle-client`
  4. Linter passes: `pnpm --filter extension run lint`
  5. Tests pass: `pnpm --filter @tautracker/moodle-client test`
  6. Git status is clean and free of leftover scratch files or untracked credentials.
