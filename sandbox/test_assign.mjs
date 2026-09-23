import { MoodleClient } from '../packages/moodle-client/dist/index.js';
import { ScraperMoodleStrategy } from '../packages/moodle-client/dist/strategies/scraperStrategy.js';
import fs from 'fs';

// Quick and dirty copy of login code from test_moodle.mjs
class CookieJar {
  constructor() { this.store = []; }
  ingest(raw, domainUrl) {
    if (!raw) return;
    const url = new URL(domainUrl);
    const parts = raw.split(/,\s*(?=[a-zA-Z0-9_\-!#$%&'*+.^`|~]+=)/);
    for (const part of parts) {
      const segments = part.split(';');
      const nameVal = segments[0].trim();
      const eq = nameVal.indexOf('=');
      if (eq > 0) {
        const name = nameVal.slice(0, eq).trim();
        const value = nameVal.slice(eq + 1).trim();
        let path = '/';
        for (let i = 1; i < segments.length; i++) {
          const s = segments[i].trim().toLowerCase();
          if (s.startsWith('path=')) path = s.split('=')[1].trim();
        }
        if (name) {
          this.store = this.store.filter(c => !(c.name === name && c.path === path));
          this.store.push({ name, value, path });
        }
      }
    }
  }
  header(urlStr) {
    const url = new URL(urlStr);
    return this.store
      .filter(c => url.pathname.startsWith(c.path) || c.path === '/')
      .map(c => `${c.name}=${c.value}`)
      .join('; ');
  }
}

const _realFetch = global.fetch;

async function mfetch(jar, url, init = {}) {
  const cookieStr = jar.header(url);
  const headers = { ...init.headers };
  if (cookieStr) headers['Cookie'] = cookieStr;
  const res = await _realFetch(url, { ...init, headers, redirect: 'manual' });
  jar.ingest(res.headers.get('set-cookie'), url);
  return res;
}

async function mfetchFollow(jar, url, init = {}, maxRedirects = 15) {
  let currentUrl = url;
  let currentInit = { ...init };
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await mfetch(jar, currentUrl, currentInit);
    const status = res.status;
    if (status >= 300 && status < 400) {
      const loc = res.headers.get('location') ?? res.headers.get('Location') ?? '';
      if (!loc) return { response: res, finalUrl: currentUrl };
      let nextUrl = loc;
      try { nextUrl = loc.startsWith('http') ? loc : new URL(loc, currentUrl).href; } catch (e) {}
      if (status === 301 || status === 302 || status === 303) currentInit = {};
      currentUrl = nextUrl;
      continue;
    }
    return { response: res, finalUrl: currentUrl };
  }
  throw new Error('Too many redirects');
}

function decodeHTMLEntities(text) {
  return text.replace(/&quot;/g, '"').replace(/&#x3d;/gi, '=').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

async function loginTauSso(username, idNumber, password) {
  const jar = new CookieJar();
  const { response: res1, finalUrl: urlAfterLogin } = await mfetchFollow(jar, 'https://moodle.tau.ac.il/login/index.php');
  
  let baseUrl = 'https://moodle.tau.ac.il';
  let ssoUrl = urlAfterLogin;

  if (urlAfterLogin.includes('/auth/saml2/login.php')) {
    baseUrl = urlAfterLogin.split('/auth')[0];
    const samlRes = await mfetchFollow(jar, urlAfterLogin);
    ssoUrl = samlRes.finalUrl;
  }

  let samlInitRes = await mfetchFollow(jar, ssoUrl);
  const html1 = await samlInitRes.response.text();
  const formMatch1 = html1.match(/<form[^>]+action=["']([^"']+)["']/i);
  if (formMatch1) {
    const action = formMatch1[1];
    ssoUrl = action.startsWith('http') ? action : new URL(action, 'https://nidp.tau.ac.il').href;
    const params = new URLSearchParams();
    const inputs = [...html1.matchAll(/<input[^>]+name=["']([^"']+)["'][^>]+value=["']([^"']+)["']/gi)];
    inputs.forEach(m => params.append(decodeHTMLEntities(m[1]), decodeHTMLEntities(m[2])));
    await mfetch(jar, ssoUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
  }

  await mfetch(jar, ssoUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'option=credential&initiateLoginSequence=true&isAjax=true',
  });

  const credBody = `option=credential&isAjax=true&Ecom_User_ID=${encodeURIComponent(username)}&Ecom_User_Pid=${encodeURIComponent(idNumber)}&Ecom_Password=${encodeURIComponent(password)}`;
  const credRes = await mfetch(jar, ssoUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: credBody,
  });

  const samlRes = await mfetch(jar, ssoUrl);
  const html2 = await samlRes.text();
  const actionMatch = html2.match(/<form[^>]+action=["']([^"']+)["']/i);
  const samlValMatch = html2.match(/<input[^>]+name=["']SAMLResponse["'][^>]+value=["']([^"']+)["']/i);
  
  const actionUrl = decodeHTMLEntities(actionMatch[1]);
  const samlResponse = decodeHTMLEntities(samlValMatch[1]);
  
  const bodyParams = new URLSearchParams();
  bodyParams.append('SAMLResponse', samlResponse);
  
  const { response: moodleRes } = await mfetchFollow(jar, actionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: bodyParams.toString(),
  });

  const moodleHtml = await moodleRes.text();
  return { jar, html: moodleHtml };
}

async function main() {
  const envUsername = process.env.MOODLE_TESTING_USERNAME;
  const envPassword = process.env.MOODLE_TESTING_PASSWORD;
  const envId = process.env.MOODLE_TESTING_ID;
  
  const { jar } = await loginTauSso(envUsername, envId, envPassword);
  
  const courseId = 321111801;
  const { response, finalUrl } = await mfetchFollow(jar, `https://moodle.tau.ac.il/2025/mod/assign/index.php?id=${courseId}`);
  const html = await response.text();
  console.log(`Fetched mod/assign/index.php. URL: ${finalUrl}, Length: ${html.length}`);
  fs.writeFileSync(`sandbox/assign_index_${courseId}.html`, html);
}

main().catch(console.error);
