import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import webExtension from 'vite-plugin-web-extension';
import * as fs from 'fs';
import * as path from 'path';

export default defineConfig(({ mode }) => {
  const targetBrowser = process.env.TARGET_BROWSER || (mode === 'firefox' ? 'firefox' : 'chrome');

  return {
    plugins: [
      react(),
      webExtension({
        manifest: () => {
          const manifestStr = fs.readFileSync(path.resolve(__dirname, 'src/manifest.json'), 'utf-8');
          const manifest = JSON.parse(manifestStr);
          
          if (targetBrowser === 'firefox') {
            manifest.browser_specific_settings = {
              gecko: {
                id: 'noodle@tau',
                strict_min_version: '109.0',
                data_collection_permissions: {
                  required: ['none']
                }
              }
            };
            if (manifest.background && manifest.background.service_worker) {
               manifest.background.scripts = [manifest.background.service_worker];
               delete manifest.background.service_worker;
            }
          }
          return manifest;
        },
        browser: targetBrowser,
        webExtConfig: {
          keepProfileChanges: true,
          firefoxProfile: path.resolve(__dirname, '.dev-profile'),
          chromiumProfile: path.resolve(__dirname, '.dev-profile'),
          profileCreateIfMissing: true,
        },
      }),
    ],
    build: {
      modulePreload: false,
    },
  };
});
