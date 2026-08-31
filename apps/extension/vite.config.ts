import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import webExtension from 'vite-plugin-web-extension';
import * as fs from 'fs';
import * as path from 'path';

export default defineConfig({
  plugins: [
    react(),
    webExtension({
      manifest: () => {
        const manifestStr = fs.readFileSync(path.resolve(__dirname, 'src/manifest.json'), 'utf-8');
        const manifest = JSON.parse(manifestStr);
        
        if (process.env.TARGET_BROWSER === 'firefox') {
          manifest.browser_specific_settings = {
            gecko: {
              id: 'noodle@tau.ac.il'
            }
          };
          if (manifest.background && manifest.background.service_worker) {
             manifest.background.scripts = [manifest.background.service_worker];
             delete manifest.background.service_worker;
          }
        }
        return manifest;
      },
      browser: process.env.TARGET_BROWSER || 'chrome',
    }),
  ],
});
