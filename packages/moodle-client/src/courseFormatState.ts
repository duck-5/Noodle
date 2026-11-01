import { CookieJar, mfetch, mfetchFollow } from './zoomScraper.js';

export interface ParsedSectionState {
  parentSectionId: number | null;
  level: 0 | 1;
  sectionUrl?: string;
}

export interface ParsedCourseFormatState {
  sections: Map<number, ParsedSectionState>;
}

export async function fetchSesskeyFromJar(jar: CookieJar, instanceBaseUrl: string): Promise<string | null> {
  try {
    const targetUrl = `${instanceBaseUrl.replace(/\/$/, '')}/my/`;
    const { response } = await mfetchFollow(jar, targetUrl);
    if (!response.ok) return null;
    const html = await response.text();
    const match = html.match(/["']sesskey["']\s*:\s*["']([A-Za-z0-9]+)["']/i) ||
                  html.match(/sesskey=([A-Za-z0-9]+)/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export async function fetchCourseFormatState(options: {
  instanceBaseUrl: string;
  courseId: number;
  sesskey: string;
  jar?: CookieJar;
}): Promise<ParsedCourseFormatState | null> {
  const { instanceBaseUrl, courseId, sesskey, jar } = options;
  if (!sesskey || !courseId) return null;

  try {
    const url = `${instanceBaseUrl.replace(/\/$/, '')}/lib/ajax/service.php?sesskey=${encodeURIComponent(sesskey)}&info=core_courseformat_get_state`;
    const body = JSON.stringify([
      {
        index: 0,
        methodname: 'core_courseformat_get_state',
        args: { courseid: courseId },
      },
    ]);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    let res: Response;
    if (jar) {
      res = await mfetch(jar, url, {
        method: 'POST',
        headers,
        body,
      });
    } else {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        credentials: 'include',
      });
    }

    if (!res.ok) return null;

    const resJson = await res.json();
    if (!Array.isArray(resJson) || !resJson[0] || resJson[0].error) {
      return null;
    }

    const rawData = resJson[0].data;
    if (!rawData) return null;

    const data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    const sectionMap = new Map<number, ParsedSectionState>();

    if (Array.isArray(data.section)) {
      for (const s of data.section) {
        const secId = Number(s.id);
        if (isNaN(secId)) continue;

        const rawParentId = s.parentid !== undefined && s.parentid !== null && s.parentid !== ''
          ? Number(s.parentid)
          : null;
        const parentSectionId = rawParentId !== null && rawParentId !== secId ? rawParentId : null;
        const levelsan = typeof s.levelsan === 'number' ? s.levelsan : Number(s.levelsan);
        const level: 0 | 1 = (levelsan >= 1 || parentSectionId !== null) ? 1 : 0;
        const sectionUrl = s.sectionurl ? String(s.sectionurl) : undefined;

        sectionMap.set(secId, {
          parentSectionId,
          level,
          sectionUrl,
        });
      }
    }

    // Inspect course.tabsdata (used by multitopic courses)
    if (data.course && Array.isArray(data.course.tabsdata)) {
      for (const tab of data.course.tabsdata) {
        const topSecId = Number(tab.sectionid);
        if (isNaN(topSecId) || !Array.isArray(tab.subtree)) continue;

        for (const child of tab.subtree) {
          const childSecId = Number(child.sectionid);
          if (isNaN(childSecId) || childSecId === topSecId) continue;

          const existing = sectionMap.get(childSecId);
          sectionMap.set(childSecId, {
            parentSectionId: topSecId,
            level: 1,
            sectionUrl: existing?.sectionUrl,
          });
        }
      }
    }

    return { sections: sectionMap };
  } catch {
    return null;
  }
}
