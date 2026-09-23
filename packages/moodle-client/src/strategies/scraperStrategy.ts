import {
  MoodleApiError,
  MoodleSiteInfo,
  RawCourseFileContent,
  RawCourseModule,
  RawCourseSection,
  RawGradeItem,
  RawGradeReportResponse,
  RawMoodleAssignment,
  RawMoodleAssignmentsResponse,
  RawMoodleCourse,
  RawSubmissionPluginFile,
  RawSubmissionStatus,
} from '../moodleApi.js';
import { parseTauCourseMetadata } from '../courseParser.js';
import { IMoodleStrategy, StrategyContext, UnsupportedStrategyError } from './types.js';

export function decodeHtmlEntities(text: string): string {
  if (!text) return '';
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x3d;/gi, '=')
    .replace(/&#x3D;/gi, '=')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .trim();
}

function stripHtmlTags(html: string): string {
  if (!html) return '';
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, '').trim());
}

export class ScraperMoodleStrategy implements IMoodleStrategy {
  public readonly name = 'Scraper';
  private courseYearMap = new Map<number, string>();
  private assignYearMap = new Map<number, string>();

  constructor(private context: StrategyContext) {}

  private getRootUrl(): string {
    const base = this.context.baseUrl.replace(/\/$/, '');
    return base.replace(/\/webservice\/rest\/server\.php$/, '');
  }

  private async fetchHtml(pathOrUrl: string, allowSsoRetry = true): Promise<string> {
    const root = this.getRootUrl();
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${root}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;

    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`Scraper HTTP error! status: ${response.status} for URL: ${url}`);
    }

    const text = await response.text();

    if (text.includes('Ecom_User_ID') || /<input[^>]+name="Ecom_User_ID"/i.test(text)) {
      throw new MoodleApiError('AUTH_SESSION_EXPIRED', 'Moodle SSO session expired. Manual login required.');
    }

    if (allowSsoRetry && text.includes('name="SAMLResponse"') && text.includes('saml2-acs.php')) {
      const actionMatch = text.match(/<form[^>]+action="([^"]+)"/i);
      const samlMatch = text.match(/<input[^>]+name="SAMLResponse"[^>]+value="([^"]+)"/i);
      const relayMatch = text.match(/<input[^>]+name="RelayState"[^>]+value="([^"]*)"/i);

      if (actionMatch && samlMatch) {
        const actionUrl = decodeHtmlEntities(actionMatch[1]);
        const samlResponse = decodeHtmlEntities(samlMatch[1]);
        const relayState = relayMatch ? decodeHtmlEntities(relayMatch[1]) : '';

        const formData = new URLSearchParams();
        formData.append('SAMLResponse', samlResponse);
        if (relayState) {
          formData.append('RelayState', relayState);
        }

        const postResponse = await fetch(actionUrl, {
          method: 'POST',
          credentials: 'include',
          body: formData,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          }
        });

        if (!postResponse.ok) {
          throw new Error(`SAML ACS POST failed! status: ${postResponse.status}`);
        }

        return this.fetchHtml(pathOrUrl, false);
      }
    }

    return text;
  }

  public async getSiteInfo(): Promise<MoodleSiteInfo> {
    let html = await this.fetchHtml('/my/');

    // 1. Extract User ID
    let userid = 0;
    const uidMatch =
      html.match(/"userid"\s*:\s*"?(\d+)"?/i) ||
      html.match(/data-userid="(\d+)"/i) ||
      html.match(/\/user\/(?:profile|view)\.php\?id=(\d+)/i) ||
      html.match(/"sesskey"\s*:\s*"[^"]+"\s*,\s*"userid"\s*:\s*(\d+)/i);

    if (uidMatch) {
      userid = parseInt(uidMatch[1], 10);
    }

    // If userid <= 1 (guest/not authenticated on /my/), attempt /user/preferences.php
    if (userid <= 1) {
      try {
        const prefHtml = await this.fetchHtml('/user/preferences.php');
        const prefUidMatch =
          prefHtml.match(/\/user\/(?:profile|view)\.php\?id=(\d+)/i) ||
          prefHtml.match(/"userid"\s*:\s*"?(\d+)"?/i) ||
          prefHtml.match(/data-userid="(\d+)"/i);
        if (prefUidMatch && parseInt(prefUidMatch[1], 10) > 1) {
          userid = parseInt(prefUidMatch[1], 10);
          html = prefHtml;
        }
      } catch {
        // Continue with current html
      }
    }

    if (userid <= 1) {
      throw new Error(`Scraper failed to identify authenticated student session (userid: ${userid})`);
    }

    // 2. Extract Full Name
    let fullname = 'Student';
    const nameMatch =
      html.match(/<span[^>]+class="[^"]*usertext[^"]*"[^>]*>([^<]+)<\/span>/i) ||
      html.match(/<span[^>]+class="[^"]*user-fullname[^"]*"[^>]*>([^<]+)<\/span>/i) ||
      html.match(/alt="User picture of ([^"]+)"/i) ||
      html.match(/alt="תמונת המשתמש של ([^"]+)"/i);

    if (nameMatch) {
      fullname = decodeHtmlEntities(nameMatch[1].trim());
    }

    // 3. Extract Sitename
    let sitename = 'Moodle TAU';
    const siteMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (siteMatch) {
      sitename = decodeHtmlEntities(siteMatch[1].trim());
    }

    // 4. Extract Username
    let username = String(userid || 'user');
    const uNameMatch = html.match(/"username"\s*:\s*"([^"]+)"/i);
    if (uNameMatch) {
      username = uNameMatch[1];
    }

    return {
      userid,
      username,
      fullname,
      sitename,
    };
  }

  private discoverArchiveYears(html: string): string[] {
    const years = new Set<string>();
    const currentYear = new Date().getFullYear();
    const minYear = currentYear - 4;
    const maxYear = currentYear + 1;

    // Matches href or links like /2025/ or https://moodle.tau.ac.il/2025/
    const yearMatches = html.matchAll(/(?:href=["'](?:https?:\/\/moodle\.tau\.ac\.il)?\/|moodle\.tau\.ac\.il\/)(20\d{2})\b/gi);
    for (const m of yearMatches) {
      const y = parseInt(m[1], 10);
      if (y >= minYear && y <= maxYear) {
        years.add(String(y));
      }
    }

    // Matches dropdown options e.g. <option value=".../2025/...">
    const optMatches = html.matchAll(/<option[^>]+value=["'](?:https?:\/\/moodle\.tau\.ac\.il)?\/(20\d{2})\b/gi);
    for (const m of optMatches) {
      const y = parseInt(m[1], 10);
      if (y >= minYear && y <= maxYear) {
        years.add(String(y));
      }
    }

    return Array.from(years);
  }

  private async extractCoursesViaAjax(
    html: string,
    coursesMap: Map<number, RawMoodleCourse>,
    yearContext?: string
  ): Promise<void> {
    const sesskeyMatch = html.match(/(?:"sesskey":"([^"]+)"|name="sesskey" value="([^"]+)")/);
    if (!sesskeyMatch) {
      if (this.context.devMode) {
        console.log(`[ScraperStrategy] extractCoursesViaAjax(${yearContext || 'root'}): no sesskey found in HTML`);
      }
      return;
    }
    const sesskey = sesskeyMatch[1] || sesskeyMatch[2];
    
    const prefix = yearContext ? `/${yearContext}` : '';
    const root = this.getRootUrl();
    const endpoint = `${root}${prefix}/lib/ajax/service.php?sesskey=${sesskey}&info=core_course_get_enrolled_courses_by_timeline_classification`;

    if (this.context.devMode) {
      console.log(`[ScraperStrategy] extractCoursesViaAjax(${yearContext || 'root'}): using sesskey=${sesskey.substring(0,4)}..., endpoint=${endpoint}`);
    }

    const classifications = ['all', 'inprogress', 'future', 'past', 'favourites'];
    for (const classification of classifications) {
      try {
        const payload = [{
          index: 0,
          methodname: 'core_course_get_enrolled_courses_by_timeline_classification',
          args: { classification, limit: 100, offset: 0, sort: 'fullname' }
        }];

        const response = await fetch(endpoint, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/javascript, */*; q=0.01'
          },
          body: JSON.stringify(payload)
        });

        if (this.context.devMode) {
          console.log(`[ScraperStrategy] AJAX(${yearContext || 'root'}/${classification}): HTTP ${response.status}`);
        }

        if (response.ok) {
          const data = await response.json();
          const result = data[0];
          if (this.context.devMode) {
            console.log(`[ScraperStrategy] AJAX(${yearContext || 'root'}/${classification}): error=${result.error}, courses=${result.data?.courses?.length ?? 'N/A'}`);
          }
          if (!result.error && result.data && Array.isArray(result.data.courses)) {
            for (const c of result.data.courses) {
              if (c.id > 1 && !coursesMap.has(c.id)) {
                coursesMap.set(c.id, {
                  id: c.id,
                  fullname: c.fullname || '',
                  shortname: c.shortname || c.fullname || '',
                  idnumber: c.idnumber || '',
                  year: yearContext,
                  instanceUrl: `${root}${prefix}`
                });
              }
            }
            if (result.data.courses.length > 0) {
              // Found courses, no need to try other classifications for this year
              return;
            }
          }
        }
      } catch (err: any) {
        if (this.context.devMode) {
          console.warn(`[ScraperStrategy] AJAX(${yearContext || 'root'}/${classification}): error=${err?.message || err}`);
        }
      }
    }
  }

  private parseCoursesFromHtml(
    html: string,
    coursesMap: Map<number, RawMoodleCourse>,
    yearContext?: string
  ): void {
    const beforeCount = coursesMap.size;

    // Log a brief snippet of the HTML for diagnostics
    if (this.context.devMode) {
      // Check for key indicators
      const hasCourseViewLink = html.includes('/course/view.php');
      const hasGradeReportLink = html.includes('/grade/report/');
      const hasDataCourseId = html.includes('data-course-id');
      const hasCoursesJson = html.includes('"courses"');
      const hasSesskey = html.includes('sesskey');
      console.log(`[ScraperStrategy] parseCoursesFromHtml(${yearContext || 'root'}): HTML indicators: courseViewLink=${hasCourseViewLink}, gradeReport=${hasGradeReportLink}, dataCourseId=${hasDataCourseId}, coursesJson=${hasCoursesJson}, sesskey=${hasSesskey}`);
    }
    const IGNORED_NAMES = new Set([
      'הקורסים שלי',
      'my courses',
      'ראשי',
      'home',
      'לוח בקרה',
      'dashboard',
      'סמן בכוכב',
      'star this course',
      'הסתר מהתצוגה',
      'hide from view',
      'הסר מהתצוגה',
      'remove from view',
      'פעולות עבור הקורס',
      'course options',
      'view course',
      'צפייה בקורס',
    ]);

    // 1. Check data-course-id attributes (common in Moodle 4.x cards and blocks)
    // Phase A: Match tags where data-course-id and aria-label/title coexist (either order)
    const cardRegexForward = /data-course-id="(\d+)"[^>]*(?:aria-label="([^"]+)"|title="([^"]+)")/gi;
    const cardRegexReverse = /(?:aria-label="([^"]+)"|title="([^"]+)")[^>]*data-course-id="(\d+)"/gi;
    for (const cm of html.matchAll(cardRegexForward)) {
      const id = parseInt(cm[1], 10);
      const name = decodeHtmlEntities(cm[2] || cm[3] || '').trim();
      if (id > 1 && name && !IGNORED_NAMES.has(name.toLowerCase()) && !coursesMap.has(id)) {
        this.addCourseToMap(coursesMap, id, name, undefined, undefined, yearContext);
      }
    }
    for (const cm of html.matchAll(cardRegexReverse)) {
      const id = parseInt(cm[3], 10);
      const name = decodeHtmlEntities(cm[1] || cm[2] || '').trim();
      if (id > 1 && name && !IGNORED_NAMES.has(name.toLowerCase()) && !coursesMap.has(id)) {
        this.addCourseToMap(coursesMap, id, name, undefined, undefined, yearContext);
      }
    }

    // Phase B: Find data-course-id elements where the course name is in child elements
    // (common in Moodle 4.x: data-course-id on a container div, name in nested spans)
    const dataCourseIdRegex = /data-course-id="(\d+)"/gi;
    let dcMatch: RegExpExecArray | null;
    while ((dcMatch = dataCourseIdRegex.exec(html)) !== null) {
      const id = parseInt(dcMatch[1], 10);
      if (isNaN(id) || id <= 1 || coursesMap.has(id)) continue;

      // Extract a block of HTML after this match (up to the next data-course-id or 2000 chars)
      const blockStart = dcMatch.index;
      const nextCourseId = html.indexOf('data-course-id=', blockStart + dcMatch[0].length);
      const blockEnd = nextCourseId > -1 ? Math.min(nextCourseId, blockStart + 2000) : blockStart + 2000;
      const block = html.substring(blockStart, Math.min(blockEnd, html.length));

      let name = '';
      // Try coursename/multiline spans (most common in Moodle 4.x dashboard cards)
      const courseNameSpan = block.match(/class="[^"]*(?:coursename|multiline|course-title|course-name)[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
      if (courseNameSpan) {
        name = stripHtmlTags(courseNameSpan[1]).trim();
      }
      // Try aria-label or title on any child element
      if (!name) {
        const childAriaMatch = block.match(/(?:aria-label|title)=["']([^"']{3,})["']/i);
        if (childAriaMatch) {
          name = decodeHtmlEntities(childAriaMatch[1]).trim();
        }
      }
      // Try <a> link text pointing to course/view.php within the block
      if (!name) {
        const linkMatch = block.match(/<a\b[^>]*href=["'][^"']*\/course\/view\.php\?[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
        if (linkMatch) {
          name = stripHtmlTags(linkMatch[1]).trim();
        }
      }

      name = name.replace(/\s+/g, ' ').trim();
      if (name && name.length >= 2 && !IGNORED_NAMES.has(name.toLowerCase())) {
        this.addCourseToMap(coursesMap, id, name, undefined, undefined, yearContext);
      }
    }

    // 2. Match standard course links: /course/view.php?id=, /grade/report/user/index.php?id=, /grade/report/overview/index.php?id=, /user/view.php?...&course=
    const courseLinkRegex = /<a\b([^>]*(?:href=["'][^"']*(?:\/course\/view\.php\?[^"']*\bid=|\/grade\/report\/user\/index\.php\?[^"']*\bid=|\/grade\/report\/overview\/index\.php\?[^"']*\bid=|\/user\/view\.php\?[^"']*\bcourse=)(\d+)[^"']*)[^>]*)>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;

    while ((match = courseLinkRegex.exec(html)) !== null) {
      const fullAttrs = match[1] || '';
      const id = parseInt(match[2], 10);
      if (isNaN(id) || id <= 1) continue;

      const linkContent = match[3] || '';

      let name = '';
      // Prefer aria-label or title if present on <a>
      const ariaMatch = fullAttrs.match(/(?:aria-label|title)=["']([^"']+)["']/i);
      if (ariaMatch) {
        name = decodeHtmlEntities(ariaMatch[1]).trim();
      }

      // If no aria-label, check inner span classes
      if (!name) {
        const courseNameSpan = linkContent.match(/class="[^"]*(?:coursename|multiline|course-title)[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
        if (courseNameSpan) {
          name = stripHtmlTags(courseNameSpan[1]).trim();
        } else {
          name = stripHtmlTags(linkContent).trim();
        }
      }

      name = name.replace(/\s+/g, ' ').trim();
      if (!name || name.length < 2) continue;
      if (IGNORED_NAMES.has(name.toLowerCase())) continue;

      const yearInUrlMatch = fullAttrs.match(/(?:moodle\.tau\.ac\.il\/|\/)(20\d{2})\/(?:course\/view\.php|grade\/report\/)/i);
      const detectedYear = yearInUrlMatch ? yearInUrlMatch[1] : yearContext;

      if (!coursesMap.has(id)) {
        this.addCourseToMap(coursesMap, id, name, undefined, undefined, detectedYear);
      }
    }

    // 3. Embedded JSON courses in Moodle page JavaScript (e.g., Moodle course overview block state)
    const jsonCourseRegex = /"courses"\s*:\s*(\[[^\]]+\])/g;
    let jsonMatch: RegExpExecArray | null;
    while ((jsonMatch = jsonCourseRegex.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (Array.isArray(parsed)) {
          for (const c of parsed) {
            const id = Number(c.id);
            if (id > 1 && c.fullname && !coursesMap.has(id)) {
              this.addCourseToMap(coursesMap, id, c.fullname, c.shortname, c.idnumber, yearContext);
            }
          }
        }
      } catch {
        // Ignore JSON parse errors in inline scripts
      }
    }

    // 4. Course selection dropdowns in calendar/grades/reports
    const optionMatches = html.matchAll(/<option[^>]+value=["']?(\d+)["']?[^>]*>([^<]+)<\/option>/gi);
    for (const om of optionMatches) {
      const id = parseInt(om[1], 10);
      const optText = decodeHtmlEntities(om[2]).trim();
      if (id > 1 && optText && !IGNORED_NAMES.has(optText.toLowerCase()) && !coursesMap.has(id)) {
        if (!optText.includes('כל הקורסים') && !optText.toLowerCase().includes('all courses')) {
          this.addCourseToMap(coursesMap, id, optText, undefined, undefined, yearContext);
        }
      }
    }

    if (this.context.devMode) {
      const newCourses = coursesMap.size - beforeCount;
      console.log(`[ScraperStrategy] parseCoursesFromHtml(${yearContext || 'root'}): found ${newCourses} new courses (total now: ${coursesMap.size})`);
    }
  }

  private addCourseToMap(
    coursesMap: Map<number, RawMoodleCourse>,
    id: number,
    fullname: string,
    providedShortname?: string,
    providedIdnumber?: string,
    yearContext?: string
  ): void {
    let shortname = providedShortname || fullname;
    let idnumber = providedIdnumber || '';

    if (!idnumber) {
      const tauCodeMatch = fullname.match(/(\d{4}[-\s]?\d{4}[-\s]?\d{2})/);
      if (tauCodeMatch) {
        idnumber = tauCodeMatch[1].replace(/[-\s]/g, '');
      } else {
        const parts = fullname.split('-');
        if (parts.length >= 2 && /^\d+$/.test(parts[0].trim())) {
          idnumber = parts[0].trim();
        }
      }
    }

    let year = yearContext || '';
    if (idnumber) {
      const meta = parseTauCourseMetadata(idnumber);
      if (meta?.year) {
        year = meta.year;
      }
    }

    if (!year) {
      const yearMatch = fullname.match(/\b(20\d{2})\b/);
      if (yearMatch) {
        year = yearMatch[1];
      }
    }

    const root = this.getRootUrl();
    const instanceUrl = year ? `${root}/${year}` : root;

    if (year) {
      this.courseYearMap.set(id, year);
    }

    coursesMap.set(id, {
      id,
      fullname,
      shortname,
      idnumber,
      year: year || undefined,
      instanceUrl,
    });
  }

  public async getEnrolledCourses(userId: number): Promise<RawMoodleCourse[]> {
    const currentYear = new Date().getFullYear();
    const candidatePastYears = [String(currentYear - 1), String(currentYear - 2)];

    interface FetchTarget {
      url: string;
      year?: string;
    }

    const targets: FetchTarget[] = [
      { url: '/grade/report/overview/index.php' },
      { url: '/my/courses.php' },
      { url: '/my/' },
    ];
    if (userId && userId > 1) {
      targets.push({ url: `/user/profile.php?id=${userId}` });
    }
    targets.push({ url: '/user/profile.php' });

    // Add candidate past years
    for (const year of candidatePastYears) {
      targets.push({ url: `/${year}/grade/report/overview/index.php`, year });
      targets.push({ url: `/${year}/my/courses.php`, year });
      targets.push({ url: `/${year}/my/`, year });
      if (userId && userId > 1) {
        targets.push({ url: `/${year}/user/profile.php?id=${userId}`, year });
      }
    }

    if (this.context.devMode) {
      console.log(`[ScraperStrategy] Fetching enrolled courses across ${targets.length} candidate URLs (including past years: ${candidatePastYears.join(', ')})...`);
    }

    const coursesMap = new Map<number, RawMoodleCourse>();
    const discoveredYears = new Set<string>();
    const ajaxYearsDone = new Set<string>();

    const results = await Promise.allSettled(
      targets.map(async (target) => {
        const html = await this.fetchHtml(target.url);
        if (this.context.devMode) {
          console.log(`[ScraperStrategy] Successfully fetched '${target.url}' (${html.length} bytes)`);
        }
        return { target, html };
      })
    );

    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      if (res.status === 'fulfilled' && res.value?.html) {
        const { target, html } = res.value;
        this.parseCoursesFromHtml(html, coursesMap, target.year);
        
        const effectiveYear = target.year || 'root';
        if (!ajaxYearsDone.has(effectiveYear)) {
          ajaxYearsDone.add(effectiveYear);
          await this.extractCoursesViaAjax(html, coursesMap, target.year);
        }

        if (!target.year) {
          const foundYears = this.discoverArchiveYears(html);
          foundYears.forEach((y) => {
            if (y !== String(currentYear) && !candidatePastYears.includes(y)) {
              discoveredYears.add(y);
            }
          });
        }
      } else if (res.status === 'rejected') {
        if (this.context.devMode) {
          console.warn(`[ScraperStrategy] Failed to fetch '${targets[i].url}':`, res.reason?.message || res.reason);
        }
      }
    }

    // If new archive years were discovered that were not in default candidate years, fetch their overview pages too
    if (discoveredYears.size > 0) {
      const extraTargets: FetchTarget[] = [];
      discoveredYears.forEach((year) => {
        extraTargets.push({ url: `/${year}/grade/report/overview/index.php`, year });
        extraTargets.push({ url: `/${year}/my/courses.php`, year });
      });

      if (this.context.devMode) {
        console.log(`[ScraperStrategy] Querying ${extraTargets.length} newly discovered archive endpoints: ${Array.from(discoveredYears).join(', ')}`);
      }

      const extraResults = await Promise.allSettled(
        extraTargets.map(async (target) => {
          const html = await this.fetchHtml(target.url);
          return { target, html };
        })
      );

      for (const res of extraResults) {
        if (res.status === 'fulfilled' && res.value?.html) {
          const { target, html } = res.value;
          this.parseCoursesFromHtml(html, coursesMap, target.year);
          
          const effectiveYear = target.year || 'root';
          if (!ajaxYearsDone.has(effectiveYear)) {
            ajaxYearsDone.add(effectiveYear);
            await this.extractCoursesViaAjax(html, coursesMap, target.year);
          }
        }
      }
    }

    if (this.context.devMode) {
      console.log(`[ScraperStrategy] Finished parsing. Total unique courses found across all years: ${coursesMap.size}`);
    }

    return Array.from(coursesMap.values());
  }

  public async getAssignments(): Promise<RawMoodleAssignmentsResponse> {
    const currentYear = new Date().getFullYear();
    const yearsToCheck = new Set<string>(['']);
    for (const year of this.courseYearMap.values()) {
      if (year) yearsToCheck.add(year);
    }
    yearsToCheck.add(String(currentYear - 1));

    const coursesMap = new Map<number, { id: number; fullname: string; shortname: string; assignments: RawMoodleAssignment[] }>();
    const eventRegex = /<div[^>]+class="[^"]*event[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;

    for (const year of yearsToCheck) {
      const path = year ? `/${year}/calendar/view.php?view=upcoming` : '/calendar/view.php?view=upcoming';
      try {
        const html = await this.fetchHtml(path);
        let eventMatch: RegExpExecArray | null;

        while ((eventMatch = eventRegex.exec(html)) !== null) {
          const eventHtml = eventMatch[1];
          const assignMatch = eventHtml.match(/\/mod\/assign\/view\.php\?id=(\d+)[^>]*>([^<]+)<\/a>/i);
          if (!assignMatch) continue;

          const cmid = parseInt(assignMatch[1], 10);
          const name = decodeHtmlEntities(assignMatch[2]);

          const courseMatch = eventHtml.match(/\/course\/view\.php\?id=(\d+)[^>]*>([^<]+)<\/a>/i);
          const courseId = courseMatch ? parseInt(courseMatch[1], 10) : 0;
          const courseName = courseMatch ? decodeHtmlEntities(courseMatch[2]) : `Course ${courseId}`;

          let duedate = 0;
          const timeMatch = eventHtml.match(/data-timestamp="(\d+)"/i);
          if (timeMatch) {
            duedate = parseInt(timeMatch[1], 10);
          }

          if (year) {
            this.assignYearMap.set(cmid, year);
            if (courseId > 0) this.courseYearMap.set(courseId, year);
          }

          if (!coursesMap.has(courseId)) {
            coursesMap.set(courseId, {
              id: courseId,
              fullname: courseName,
              shortname: courseName,
              assignments: [],
            });
          }

          coursesMap.get(courseId)!.assignments.push({
            id: cmid,
            cmid,
            course: courseId,
            name,
            duedate,
            cutoffdate: 0,
            allowsubmissionsfromdate: 0,
          });
        }
      } catch (err: any) {
        if (this.context.devMode) {
          console.warn(`[ScraperStrategy] Failed fetching calendar for year '${year}':`, err?.message || err);
        }
      }
    }

    return {
      courses: Array.from(coursesMap.values()),
    };
  }

  public async getSubmissionStatus(assignId: number): Promise<RawSubmissionStatus> {
    const year = this.assignYearMap.get(assignId);
    let html = '';

    if (year) {
      try {
        html = await this.fetchHtml(`/${year}/mod/assign/view.php?id=${assignId}`);
      } catch {
        html = await this.fetchHtml(`/mod/assign/view.php?id=${assignId}`);
      }
    } else {
      try {
        html = await this.fetchHtml(`/mod/assign/view.php?id=${assignId}`);
      } catch (err) {
        const currentYear = new Date().getFullYear();
        let found = false;
        for (const candidateYear of [currentYear - 1, currentYear - 2]) {
          try {
            html = await this.fetchHtml(`/${candidateYear}/mod/assign/view.php?id=${assignId}`);
            this.assignYearMap.set(assignId, String(candidateYear));
            found = true;
            break;
          } catch {}
        }
        if (!found) throw err;
      }
    }

    const isSubmitted =
      html.includes('הוגש להערכה') ||
      html.includes('Submitted for grading') ||
      html.includes('submissionstatussubmitted');

    const isGraded =
      html.includes('הוערך') ||
      html.includes('Graded') ||
      html.includes('submissiongraded');

    // Extract submitted files if present
    const submittedFiles: RawSubmissionPluginFile[] = [];
    const fileMatches = html.matchAll(/<a[^>]+href="([^"]*\/pluginfile\.php\/[^"]+)"[^>]*>([^<]+)<\/a>/gi);
    for (const fm of fileMatches) {
      const fileurl = decodeHtmlEntities(fm[1]);
      const filename = decodeHtmlEntities(fm[2]);
      if (fileurl && filename && !fileurl.includes('/user/icon/')) {
        submittedFiles.push({
          filename,
          fileurl,
          filesize: 0,
        });
      }
    }

    return {
      lastattempt: {
        gradingstatus: isGraded ? 'graded' : 'notgraded',
        submission: {
          status: isSubmitted ? 'submitted' : 'new',
          plugins: [
            {
              type: 'file',
              name: 'File submissions',
              fileareas: [
                {
                  area: 'submission_files',
                  files: submittedFiles,
                },
              ],
            },
          ],
        },
      },
    };
  }

  public async getGradeItems(courseId: number, _userId: number): Promise<RawGradeReportResponse> {
    const year = this.courseYearMap.get(courseId);
    let html = '';

    if (year) {
      try {
        html = await this.fetchHtml(`/${year}/grade/report/user/index.php?id=${courseId}`);
      } catch {
        html = await this.fetchHtml(`/grade/report/user/index.php?id=${courseId}`);
      }
    } else {
      try {
        html = await this.fetchHtml(`/grade/report/user/index.php?id=${courseId}`);
      } catch (err) {
        const currentYear = new Date().getFullYear();
        let found = false;
        for (const candidateYear of [currentYear - 1, currentYear - 2]) {
          try {
            html = await this.fetchHtml(`/${candidateYear}/grade/report/user/index.php?id=${courseId}`);
            this.courseYearMap.set(courseId, String(candidateYear));
            found = true;
            break;
          } catch {}
        }
        if (!found) throw err;
      }
    }

    const gradeitems: RawGradeItem[] = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;

    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const rowHtml = rowMatch[1];
      const assignLinkMatch = rowHtml.match(/\/mod\/assign\/view\.php\?id=(\d+)[^>]*>([^<]+)<\/a>/i);
      if (!assignLinkMatch) continue;

      const cmid = parseInt(assignLinkMatch[1], 10);
      const gradeMatch = rowHtml.match(/<td[^>]+class="[^"]*column-grade[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
      const gradeText = gradeMatch ? stripHtmlTags(gradeMatch[1]) : '';
      const rawNum = parseFloat(gradeText);

      gradeitems.push({
        itemtype: 'mod',
        itemmodule: 'assign',
        cmid,
        gradeformatted: gradeText || '-',
        graderaw: isNaN(rawNum) ? null : rawNum,
        grademax: 100,
        gradeishidden: false,
      });
    }

    return {
      usergrades: [
        {
          courseid: courseId,
          userid: _userId,
          gradeitems,
        },
      ],
    };
  }

  public async getCourseContents(courseId: number): Promise<RawCourseSection[]> {
    const year = this.courseYearMap.get(courseId);
    let html = '';
    let effectiveYear = year || '';

    if (effectiveYear) {
      try {
        html = await this.fetchHtml(`/${effectiveYear}/course/view.php?id=${courseId}`);
      } catch {
        html = await this.fetchHtml(`/course/view.php?id=${courseId}`);
        effectiveYear = '';
      }
    } else {
      try {
        html = await this.fetchHtml(`/course/view.php?id=${courseId}`);
      } catch (err) {
        const currentYear = new Date().getFullYear();
        let found = false;
        for (const candidateYear of [currentYear - 1, currentYear - 2]) {
          try {
            html = await this.fetchHtml(`/${candidateYear}/course/view.php?id=${courseId}`);
            effectiveYear = String(candidateYear);
            this.courseYearMap.set(courseId, effectiveYear);
            found = true;
            break;
          } catch {}
        }
        if (!found) throw err;
      }
    }

    const sections: RawCourseSection[] = [];
    const sectionRegex = /<(?:li|section|div)[^>]+id="section-(\d+)"[^>]*>([\s\S]*?)(?=<(?:li|section|div)[^>]+id="section-\d+"|<\/(?:ul|section)>|$)/gi;
    let secMatch: RegExpExecArray | null;

    while ((secMatch = sectionRegex.exec(html)) !== null) {
      const secId = parseInt(secMatch[1], 10);
      const secHtml = secMatch[2];

      const nameMatch =
        secHtml.match(/<h[234][^>]+class="[^"]*sectionname[^"]*"[^>]*>([\s\S]*?)<\/h[234]>/i) ||
        secHtml.match(/<span[^>]+class="[^"]*sectionname[^"]*"[^>]*>([\s\S]*?)<\/span>/i);

      const sectionName = nameMatch ? stripHtmlTags(nameMatch[1]) : `Section ${secId}`;
      const modules: RawCourseModule[] = [];

      const modRegex = /<(?:li|div)[^>]+class="[^"]*modtype_([a-z0-9_]+)[^"]*"[^>]+id="module-(\d+)"[^>]*>([\s\S]*?)(?=<(?:li|div)[^>]+class="[^"]*modtype_|<\/ul>|$)/gi;
      let mMatch: RegExpExecArray | null;

      while ((mMatch = modRegex.exec(secHtml)) !== null) {
        const modname = mMatch[1];
        const moduleId = parseInt(mMatch[2], 10);
        const modHtml = mMatch[3];

        const instMatch = modHtml.match(/<span[^>]+class="[^"]*instancename[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
        const modName = instMatch ? stripHtmlTags(instMatch[1]) : `${modname} ${moduleId}`;

        const contents: RawCourseFileContent[] = [];

        if (modname === 'resource' || modname === 'folder') {
          const fileMatch = modHtml.match(/<a[^>]+href="([^"]*(?:pluginfile\.php|mod\/resource\/view\.php)[^"]*)"[^>]*>/i);
          if (fileMatch) {
            let fileurl = decodeHtmlEntities(fileMatch[1]);
            if (fileurl.startsWith('/')) {
              fileurl = `${this.getRootUrl()}${fileurl}`;
            }
            contents.push({
              type: 'file',
              filename: modName,
              fileurl,
              filesize: 0,
              mimetype: 'application/octet-stream',
              timemodified: 0,
            });
          }
        }

        const yearPrefix = effectiveYear ? `/${effectiveYear}` : '';
        modules.push({
          id: moduleId,
          name: modName,
          modname,
          url: `${this.getRootUrl()}${yearPrefix}/mod/${modname}/view.php?id=${moduleId}`,
          instance: moduleId,
          contents: contents.length > 0 ? contents : undefined,
        });
      }

      sections.push({
        id: secId,
        name: sectionName,
        modules,
      });
    }

    return sections;
  }

  public async uploadFile(_filename: string, _fileContentBase64: string): Promise<{ itemid: number }> {
    throw new UnsupportedStrategyError('Scraper', 'uploadFile', 'Use REST strategy for direct file uploads');
  }

  public async saveSubmission(_assignId: number, _itemId: number): Promise<any> {
    throw new UnsupportedStrategyError('Scraper', 'saveSubmission', 'Web submission saving not yet automated via scraper');
  }

  public async submitForGrading(_assignId: number): Promise<any> {
    throw new UnsupportedStrategyError('Scraper', 'submitForGrading', 'Submission statement not automated via scraper');
  }

  public async getAutoLoginKey(): Promise<{ key: string; autologinurl: string }> {
    throw new UnsupportedStrategyError('Scraper', 'getAutoLoginKey', 'Auto-login keys are REST exclusive');
  }

  public async saveNoodleSettings(_settingsJson: string): Promise<void> {
    throw new UnsupportedStrategyError('Scraper', 'saveNoodleSettings', 'Calendar settings saving deferred to browser storage');
  }

  public async loadNoodleSettings(): Promise<any> {
    const html = await this.fetchHtml('/calendar/view.php?view=upcoming');
    const syncMatch = html.match(/NOODLE_SYNC_DATA[\s\S]*?<div[^>]+class="description[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (!syncMatch) return null;

    const rawJson = stripHtmlTags(syncMatch[1]);
    try {
      return JSON.parse(rawJson);
    } catch {
      return null;
    }
  }
}
