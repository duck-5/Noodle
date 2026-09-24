import { MoodleClient } from '../packages/moodle-client/dist/index.js';
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
  
  const useridMatch = moodleHtml.match(/"userid"\s*:\s*(\d+)/);
  if (useridMatch && parseInt(useridMatch[1], 10) <= 1) {
    throw new Error('SSO login resulted in a Guest session. Please check your username, ID, and password.');
  }
  
  const sesskey = sesskeyMatch[1];
  
  // Scrape mobile token
  const manageUrl = `${baseUrl}/user/managetoken.php`;
  const manageRes = await mfetchFollow(jar, manageUrl);
  const manageHtml = await manageRes.response.text();
  
  const tokenMatch = manageHtml.match(/(?:Moodle mobile web service|moodle_mobile_app|Mobile)[^]*?action=resetwstoken(?:&amp;|&)tokenid=(\d+)/i);
  if (!tokenMatch) throw new Error('Could not find existing Moodle Mobile Web Service token to reset');
  
  const resetParams = new URLSearchParams();
  resetParams.append('tokenid', tokenMatch[1]);
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
  if (finalTokenMatch) return { token: finalTokenMatch[1].trim(), jar };
  
  throw new Error('SSO login successful but failed to extract the wstoken from user/managetoken.php');
}
// --- End SSO Logic ---


async function main() {
  console.log("=== Moodle API Detailed Test Script ===\n");
  
  let token = process.env.MOODLE_TOKEN;
  let ssoJar = null;
  
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
        console.log("[AUTH] Successfully logged in and extracted session cookies & token!\n");
        
        // Monkey-patch global fetch so the ScraperStrategy can use our CookieJar in Node.js!
        const originalFetch = global.fetch;
        global._originalFetch = originalFetch;
        global.fetch = async (url, options) => {
          if (options && options.credentials === 'include') {
            const result = await mfetchFollow(ssoJar, url, options);
            // Redefine the url property of the response to match the final URL
            Object.defineProperty(result.response, 'url', { value: result.finalUrl });
            return result.response;
          }
          return originalFetch(url, options);
        };
      } catch (err) {
        console.error("[AUTH] Failed to login via SSO:", err.message);
        process.exit(1);
      }
    } else {
      console.error("[AUTH] Please provide MOODLE_TESTING_USERNAME, MOODLE_TESTING_ID, and MOODLE_TESTING_PASSWORD in the .env file.");
      process.exit(1);
    }
  }

  // Import strategies dynamically to configure client
  const { ScraperMoodleStrategy, RestMoodleStrategy } = await import('../packages/moodle-client/dist/strategies/index.js');

  const context = {
    token,
    baseUrl: 'https://moodle.tau.ac.il/webservice/rest/server.php',
    devMode: true
  };

  // We explicitly use the ScraperStrategy as a primary fallback here to demonstrate
  // gathering archive year courses, which REST does not support across databases.
  const client = new MoodleClient(token, context.baseUrl, {
    devMode: true,
    strategies: [
      new RestMoodleStrategy(context),
      new ScraperMoodleStrategy(context)
    ]
  });

  const report = {
    siteInfo: null,
    totalCourses: 0,
    coursesByYear: {},
    totalAssignments: 0,
    sampleAssignmentStatus: null,
    zoomLinksFound: 0,
    calendarSaved: false,
    calendarLoaded: false,
    calendarDeleted: false,
  };

  try {
    console.log("--- 1. Testing getSiteInfo ---");
    const siteInfo = await client.getSiteInfo();
    report.siteInfo = siteInfo;
    console.log(`[SUCCESS] Logged in as: ${siteInfo.fullname} (ID: ${siteInfo.userid})`);

    console.log("\n--- 2. Testing getEnrolledCourses (Multi-Year Discovery) ---");
    // Explicitly call Scraper Strategy for courses to guarantee multi-year discovery
    const scraper = client.strategies.find(s => s.name === 'Scraper');
    const courses = await scraper.getEnrolledCourses(siteInfo.userid);
    report.totalCourses = courses.length;
    
    console.log(`[SUCCESS] Found ${courses.length} courses across all databases.`);
    courses.forEach(c => {
      const yearStr = c.year || 'Current';
      if (!report.coursesByYear[yearStr]) report.coursesByYear[yearStr] = [];
      report.coursesByYear[yearStr].push(c);
    });

    for (const [year, yearCourses] of Object.entries(report.coursesByYear)) {
      console.log(`\nYear: ${year} (${yearCourses.length} courses)`);
      yearCourses.forEach(c => console.log(`  - [${c.id}] ${c.fullname}`));
    }

    console.log("\n--- 3. Testing getAssignments ---");
    const assignments = await client.getAssignments();
    const allAssigns = assignments.courses.flatMap(c => c.assignments);
    report.totalAssignments = allAssigns.length;
    console.log(`[SUCCESS] Found ${allAssigns.length} assignments.`);
    
    console.log("\n--- EXPERIMENT: Fetching course page to find assignments ---");
    if (courses.length > 0) {
      const sampleCourse = courses[0];
      const courseUrl = sampleCourse.instanceUrl + '/course/view.php?id=' + sampleCourse.id;
      console.log('Fetching', courseUrl);
      const res = await fetch(courseUrl, { credentials: 'include' });
      const html = await res.text();
      const assignMatches = html.matchAll(/<a[^>]+href=["'][^"']*\/mod\/assign\/view\.php\?id=(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi);
      let count = 0;
      for (const m of assignMatches) {
        count++;
        console.log('Found assign CMID:', m[1], 'Text:', m[2].replace(/<[^>]+>/g, '').trim());
      }
      console.log('Total assigns on course page:', count);
    }
    
    if (allAssigns.length > 0) {
      console.log("\n--- 4. Testing getSubmissionStatus ---");
      try {
        const status = await client.getSubmissionStatus(allAssigns[0].id);
        report.sampleAssignmentStatus = status.lastattempt?.submission?.status || "Unknown";
        console.log(`[SUCCESS] Checked sample assignment "${allAssigns[0].name}": Status = ${report.sampleAssignmentStatus}`);
      } catch (e) {
        console.log(`[ERROR] Could not get submission status: ${e.message}`);
      }
    }

    if (courses.length > 0) {
      console.log("\n--- 5. Testing getCourseContents (Looking for Zoom links) ---");
      // Pick a course from the current year if possible, otherwise first available
      const currentCourses = report.coursesByYear['Current'] || courses;
      const courseId = currentCourses[0].id;
      console.log(`Fetching contents for course ${courseId} (${currentCourses[0].fullname})...`);
      
      const contents = await client.getCourseContents(courseId);
      for (const section of contents) {
        for (const module of section.modules) {
          if (module.modname === 'lti' && module.name.toLowerCase().includes('zoom')) {
            console.log(`  [ZOOM] Found LTI module: ${module.name}`);
            report.zoomLinksFound++;
          } else if (module.modname === 'url' && module.contents?.[0]?.fileurl?.includes('zoom.us')) {
            console.log(`  [ZOOM] Found URL module: ${module.name}`);
            report.zoomLinksFound++;
          }
        }
      }
      console.log(`[SUCCESS] Found ${report.zoomLinksFound} Zoom links in this course.`);
    }

    /*
    console.log("\n--- 6. Testing Calendar Storage (Save, Get, Delete) ---");
    try {
      const testData = { testTime: Date.now(), message: "Noodle API Test Data" };
      console.log("[CALENDAR] Saving test data...");
      await client.saveNoodleSettings(JSON.stringify(testData));
      report.calendarSaved = true;
      
      console.log("[CALENDAR] Loading test data...");
      const loadedData = await client.loadNoodleSettings();
      report.calendarLoaded = !!loadedData;
      console.log(`[CALENDAR] Data verified: ${loadedData?.message === testData.message ? 'YES' : 'NO'}`);

      console.log("[CALENDAR] Cleaning up... Deleting test event.");
      const calResponse = await client.apiCall('core_calendar_get_calendar_events', {
        'events[eventids][0]': 0,
        'options[userevents]': 1,
        'options[timeend]': 4102444800 + 86400,
        'options[timestart]': 4102444800 - 86400,
      });
      
      if (calResponse && calResponse.events) {
        const existingEvents = calResponse.events.filter(e => e.name === 'NOODLE_SYNC_DATA');
        if (existingEvents.length > 0) {
          const deleteParams = {};
          for (let i = 0; i < existingEvents.length; i++) {
            deleteParams[`events[${i}][eventid]`] = existingEvents[i].id;
            deleteParams[`events[${i}][repeat]`] = 0;
          }
          await client.apiCall('core_calendar_delete_calendar_events', deleteParams, 'POST');
          report.calendarDeleted = true;
          console.log("[CALENDAR] Test event successfully deleted.");
        }
      }
    } catch (e) {
      console.log(`[CALENDAR ERROR] Calendar tests failed: ${e.message}`);
    }
    */
    
    console.log("\n=======================================================");
    console.log("                DETAILED EXECUTION REPORT                ");
    console.log("=======================================================");
    console.log(`User Authenticated : ${report.siteInfo?.fullname || 'No'}`);
    console.log(`Total Courses      : ${report.totalCourses}`);
    console.log(`Years Discovered   : ${Object.keys(report.coursesByYear).join(', ')}`);
    console.log(`Total Assignments  : ${report.totalAssignments}`);
    console.log(`Zoom Links Checked : Found ${report.zoomLinksFound} in sample course`);
    console.log(`Calendar Store     : Saved=${report.calendarSaved}, Loaded=${report.calendarLoaded}, Deleted=${report.calendarDeleted}`);
    console.log("=======================================================\n");

  } catch (err) {
    console.error("\n[FATAL ERROR] Tests aborted:", err);
  } finally {
    rl.close();
  }
}

main();
