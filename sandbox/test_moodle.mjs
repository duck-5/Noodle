import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise(resolve => rl.question(query, resolve));

// --- SSO Cookie Jar & Fetch Helpers ---
class CookieJar {
  constructor() { this.store = {}; }
  ingest(raw) {
    if (!raw) return;
    const normalized = raw.replace(/\r?\n/g, ', ');
    const parts = normalized.split(/,\s*(?=[a-zA-Z0-9_\-!#$%&'*+.^`|~]+=)/);
    for (const part of parts) {
      const nameVal = part.split(';')[0].trim();
      const eq = nameVal.indexOf('=');
      if (eq > 0) {
        const name = nameVal.slice(0, eq).trim();
        const value = nameVal.slice(eq + 1).trim();
        if (name) this.store[name] = value;
      }
    }
  }
  header() {
    return Object.entries(this.store).map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

const _realFetch = global.fetch;

async function mfetch(jar, url, init = {}) {
  const cookieStr = jar.header();
  const headers = { ...init.headers };
  if (cookieStr) headers['Cookie'] = cookieStr;
  const fetchFn = global._originalFetch || _realFetch;
  const res = await fetchFn(url, { ...init, headers, redirect: 'manual' });
  jar.ingest(res.headers.get('set-cookie'));
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
      if (nextUrl.startsWith('moodlemobile://') || nextUrl.startsWith('moodleapp://')) {
        return { response: res, finalUrl: nextUrl };
      }
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

  if (!ssoUrl.includes('nidp.tau.ac.il')) throw new Error(`Unexpected SSO redirect: ${ssoUrl}`);

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
  const credText = await credRes.text();
  if (credText.replace(/\s/g, '').includes('"isError":true')) {
    throw new Error('Wrong username, ID number, or password during SSO');
  }

  const samlRes = await mfetch(jar, ssoUrl);
  const html2 = await samlRes.text();
  const actionMatch = html2.match(/<form[^>]+action=["']([^"']+)["']/i);
  const samlValMatch = html2.match(/<input[^>]+name=["']SAMLResponse["'][^>]+value=["']([^"']+)["']/i);
  
  if (!actionMatch || !samlValMatch) throw new Error('Failed to parse SAML assertion');
  
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
  const sesskeyMatch = moodleHtml.match(/"sesskey":"([^"]+)"/);
  if (!sesskeyMatch) throw new Error('Failed to extract sesskey from Moodle after SSO login');
  
  const sesskey = sesskeyMatch[1];
  
  const manageUrl = `${baseUrl}/user/managetoken.php`;
  const manageRes = await mfetchFollow(jar, manageUrl);
  const manageHtml = await manageRes.response.text();
  
  const allTokens = [...manageHtml.matchAll(/action=resetwstoken(?:&amp;|&)tokenid=(\d+)/gi)].map(m => m[1]);
  if (allTokens.length === 0) throw new Error('Could not find any tokens to reset on user/managetoken.php');
  
  for (const tokenId of allTokens) {
    const resetParams = new URLSearchParams();
    resetParams.append('tokenid', tokenId);
    resetParams.append('action', 'resetwstoken');
    resetParams.append('confirm', '1');
    resetParams.append('sesskey', sesskey);
    
    const resetRes = await mfetchFollow(jar, manageUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: resetParams.toString(),
    });
    
    const resetHtml = await resetRes.response.text();
    const finalTokenMatch = resetHtml.match(/id="copytoclipboardtoken"[^>]*>([^<]+)<\/div>/i);
    
    if (finalTokenMatch) {
      const candidateToken = finalTokenMatch[1].trim();
      // Test if this token has the correct permissions
      const testRes = await apiCall(candidateToken, `${baseUrl}/webservice/rest/server.php`, 'core_webservice_get_site_info');
      if (!testRes.errorcode) {
        return { token: candidateToken, jar, sesskey };
      }
    }
  }
  
  throw new Error('SSO login successful but none of the tokens had mobile app permissions');
}
// --- End SSO Logic ---

async function apiCall(token, url, wsfunction, args = {}) {
  const params = new URLSearchParams();
  params.append('wstoken', token);
  params.append('wsfunction', wsfunction);
  params.append('moodlewsrestformat', 'json');
  for (const [k, v] of Object.entries(args)) {
    params.append(k, v);
  }
  
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  return res.json();
}

async function main() {
  console.log("=== Moodle API Archive Discovery Test ===\n");
  
  let token = process.env.MOODLE_TOKEN;
  let ssoJar = null;
  let sesskey = null;
  
  if (!token) {
    const envUsername = process.env.MOODLE_TESTING_USERNAME;
    const envPassword = process.env.MOODLE_TESTING_PASSWORD;
    const envId = process.env.MOODLE_TESTING_ID;
    
    if (envUsername && envPassword && envId) {
      console.log(`[AUTH] Found SSO credentials for: ${envUsername}. Logging in via TAU SSO...`);
      try {
        const result = await loginTauSso(envUsername, envId, envPassword);
        token = result.token;
        ssoJar = result.jar;
        sesskey = result.sesskey;
        console.log("[AUTH] Successfully logged in and extracted session cookies & token!\n");
      } catch (err) {
        console.error("[AUTH] Failed to login via SSO:", err.message);
        process.exit(1);
      }
    } else {
      console.error("[AUTH] Please provide MOODLE_TESTING_USERNAME, MOODLE_TESTING_ID, and MOODLE_TESTING_PASSWORD in the .env file.");
      process.exit(1);
    }
  }

  try {
    console.log("Extracted Token:", token);
    console.log("--- 1. Testing root instance (core_webservice_get_site_info) ---");
    const siteInfo = await apiCall(token, 'https://moodle.tau.ac.il/webservice/rest/server.php', 'core_webservice_get_site_info');
    console.log(siteInfo);
    console.log(`Logged in as: ${siteInfo.fullname} (ID: ${siteInfo.userid})`);

    console.log("\n--- 2. Testing ROOT core_enrol_get_users_courses ---");
    const rootCourses = await apiCall(token, 'https://moodle.tau.ac.il/webservice/rest/server.php', 'core_enrol_get_users_courses', { userid: siteInfo.userid || 0 });
    console.log(`Found ${rootCourses.length || 0} courses on root instance.`);
    
    console.log("\n--- 3. Testing TIMELINE CLASSIFICATION (all) on ROOT ---");
    const allTimeline = await apiCall(token, 'https://moodle.tau.ac.il/webservice/rest/server.php', 'core_course_get_enrolled_courses_by_timeline_classification', {
      classification: 'all',
      limit: 100,
      offset: 0,
      sort: 'fullname'
    });
    console.log(`Found ${allTimeline.courses?.length || 0} ALL courses from timeline endpoint.`);
    if (allTimeline.courses?.length > 0) {
      console.log(allTimeline.courses.map(c => ` - [${c.id}] ${c.fullname}`).join('\n'));
    }

    console.log("\n--- 3b. Testing TIMELINE CLASSIFICATION (hidden) on ROOT ---");
    const hiddenTimeline = await apiCall(token, 'https://moodle.tau.ac.il/webservice/rest/server.php', 'core_course_get_enrolled_courses_by_timeline_classification', {
      classification: 'hidden',
      limit: 100,
      offset: 0,
      sort: 'fullname'
    });
    console.log(`Found ${hiddenTimeline.courses?.length || 0} HIDDEN courses from timeline endpoint.`);

    console.log("\n--- 4. Testing ARCHIVE URL (2025) with ROOT TOKEN ---");
    const archiveUrl2025 = 'https://moodle.tau.ac.il/2025/webservice/rest/server.php';
    const archiveCourses = await apiCall(token, archiveUrl2025, 'core_webservice_get_site_info');
    if (archiveCourses.errorcode) {
      console.log(`[FAILED] Root token did NOT work on 2025 instance: ${archiveCourses.message}`);
    } else {
      console.log(`[SUCCESS] Root token WORKED on 2025 instance! Name: ${archiveCourses.fullname}`);
    }
    
    console.log("\n--- 5. Generating an Archive-Specific Token (if needed) ---");
    if (ssoJar && archiveCourses.errorcode === 'invalidtoken') {
      console.log("Attempting to get a token specifically for the 2025 instance using SSO cookies...");
      
      let archiveLoginRes = await mfetchFollow(ssoJar, 'https://moodle.tau.ac.il/2025/login/index.php');
      let archiveHtml = await archiveLoginRes.response.text();
      
      const samlMatch = archiveHtml.match(/<form[^>]+action=["']([^"']+)["']/i);
      const samlValMatch = archiveHtml.match(/<input[^>]+name=["']SAMLResponse["'][^>]+value=["']([^"']+)["']/i);
      
      if (samlMatch && samlValMatch) {
        console.log("Found SAML redirect for 2025, submitting...");
        const actionUrl = decodeHTMLEntities(samlMatch[1]);
        const samlResponse = decodeHTMLEntities(samlValMatch[1]);
        const bodyParams = new URLSearchParams();
        bodyParams.append('SAMLResponse', samlResponse);
        
        archiveLoginRes = await mfetchFollow(ssoJar, actionUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: bodyParams.toString(),
        });
        archiveHtml = await archiveLoginRes.response.text();
      }

      const sess2025Match = archiveHtml.match(/"sesskey":"([^"]+)"/);
      
      if (sess2025Match) {
        const sess2025 = sess2025Match[1];
        console.log("Successfully logged into 2025 instance via SSO! sesskey:", sess2025);
        
        const archiveManageUrl = 'https://moodle.tau.ac.il/2025/user/managetoken.php';
        const archiveManageRes = await mfetchFollow(ssoJar, archiveManageUrl);
        const archiveManageHtml = await archiveManageRes.response.text();
        
        const allArchiveTokens = [...archiveManageHtml.matchAll(/action=resetwstoken(?:&amp;|&)tokenid=(\d+)/gi)].map(m => m[1]);
        
        let foundArchiveToken = null;
        for (const tokenId of allArchiveTokens) {
          const resetParams = new URLSearchParams();
          resetParams.append('tokenid', tokenId);
          resetParams.append('action', 'resetwstoken');
          resetParams.append('confirm', '1');
          resetParams.append('sesskey', sess2025);
          
          const resetRes = await mfetchFollow(ssoJar, archiveManageUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: resetParams.toString(),
          });
          
          const resetHtml = await resetRes.response.text();
          const finalTokenMatch = resetHtml.match(/id="copytoclipboardtoken"[^>]*>([^<]+)<\/div>/i);
          if (finalTokenMatch) {
            const archiveToken = finalTokenMatch[1].trim();
            const testRes = await apiCall(archiveToken, archiveUrl2025, 'core_webservice_get_site_info');
            if (!testRes.errorcode) {
              foundArchiveToken = archiveToken;
              break;
            }
          }
        }
        
        if (foundArchiveToken) {
          const archiveToken = foundArchiveToken;
            console.log("[SUCCESS] Extracted archive-specific token:", archiveToken);
            
            console.log("\nTesting archive-specific token on 2025 REST API...");
            const aSiteInfo = await apiCall(archiveToken, archiveUrl2025, 'core_webservice_get_site_info');
            console.log(`2025 Logged in as: ${aSiteInfo.fullname} (ID: ${aSiteInfo.userid})`);
            
            const aEnrolled = await apiCall(archiveToken, archiveUrl2025, 'core_enrol_get_users_courses', { userid: aSiteInfo.userid || 0 });
            console.log(`Found ${aEnrolled.length || 0} courses on 2025 instance using new token!`);
            if (aEnrolled.length > 0) {
              console.log(aEnrolled.map(c => ` - ${c.fullname}`).join('\n'));
            }
            
            const aAssigns = await apiCall(archiveToken, archiveUrl2025, 'mod_assign_get_assignments');
            console.log(`Found ${aAssigns.courses?.length || 0} courses with assignments on 2025 instance using new token!`);
          } else {
            console.log("[FAILED] Could not reset/find a valid token on 2025 user/managetoken.php");
          }
      } else {
        console.log("[FAILED] Could not log into 2025 instance via SSO.");
        console.log("HTML Preview (first 500 chars):", archiveHtml.substring(0, 500));
        // Test if there's a SAML redirect again
        const samlMatch = archiveHtml.match(/<form[^>]+action=["']([^"']+)["']/i);
        if (samlMatch) console.log("Found SAML form on 2025:", samlMatch[1]);
      }
    }
    
  } catch (err) {
    console.error("\n[FATAL ERROR] Tests aborted:", err);
  } finally {
    rl.close();
  }
}

main();
