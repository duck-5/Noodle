import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  optionsPage: Page;
}>({
  context: async ({}, use) => {
    const pathToExtension = path.resolve(__dirname, '../dist');
    const manifestPath = path.join(pathToExtension, 'manifest.json');

    if (
      !fs.existsSync(manifestPath) ||
      !JSON.parse(fs.readFileSync(manifestPath, 'utf-8')).background?.service_worker
    ) {
      execSync('pnpm run build:chrome', { cwd: path.resolve(__dirname, '..'), stdio: 'pipe' });
    }

    const context = await chromium.launchPersistentContext('', {
      headless: false, // In Chromium, extensions only load in headed/non-legacy headless mode
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
        `--headless=new`,
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker', { timeout: 10000 });
    }
    const extensionId = background.url().split('/')[2];
    await use(extensionId);
  },
  optionsPage: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForLoadState('domcontentloaded');
    await use(page);
  },
});

export { expect } from '@playwright/test';
