import browser from 'webextension-polyfill';
import { useState, useEffect, useMemo, useRef, Fragment, createContext, useContext } from 'react';
import type {
  SyncResult,
  SyncError,
  Assignment,
  CourseFile,
  CourseSection,
  CourseFolder,
  CourseFolderFile,
  CourseLink,
  CourseAnnouncement,
  ZoomMeeting,
  PanoptoRecording,
  CourseStaffMember,
  CoursePanoptoStaffEntry,
  PanoptoRecordingType,
  GroupedCoursesResult,
  SyncProgressState,
} from '@tautracker/moodle-client';
import {
  parseTauCourseMetadata,
  MoodleClient,
  isValidIsraeliId,
  isZoomUrl,
  isZoomJoinUrl,
  getZoomMeetingKey,
  isZoomMeetingHidden,
  collapseRecurringMeetings,
  extractPanoptoFolderId,
  buildPanoptoFolderUrl,
  reclassifyPanoptoRecordings,
  doesRecordingMatchStaffEntries,
  partitionPanoptoRecordingsByTrackedHosts,
  toggleTrackedHostEntry,
  normalizePersonName,
  downloadFolderAsZip,
  groupEnrolledCourses,
  expandTrackedCourseIds,
  aggregateUnifiedCourseItems,
  isAdministrativeCourse,
  getActivityUid,
  isActivityHidden,
  isActivityCompleted,
  isMoodleActivitySubmitted,
  matchesActivityIdentifier,
  hasGracePeriod,
  getCanonicalFileUrlPath,
  calculateGradesSummary,
} from '@tautracker/moodle-client';
import {
  getStoredToken,
  setStoredToken,
  getStoredSesskey,
  getTrackedCourseIds,
  setTrackedCourseIds,
  getCachedSyncResult,
  setCachedSyncResult,
  getCachedCourseStaff,
  mergeCachedCourseStaff,
  getSettings,
  setSettings,
  getMoodleCredentials,
  setMoodleCredentials,
  DEFAULT_SETTINGS,
  getGoogleOAuthRedirectUrl,
  getLocalFsConfig,
  getLocalFsManifest,
  getLocalFsStatus,
  DEFAULT_LOCAL_FS_CONFIG,
  DEFAULT_LOCAL_FS_STATUS,
  getEffectiveTheme,
  getStoreUpdateStatus,
  getDismissedUpdateVersion,
  setDismissedUpdateVersion,
  STORE_UPDATE_STATUS_KEY,
  DISMISSED_UPDATE_VERSION_KEY,
} from '../shared/storage.js';
import type {
  ExtensionSettings,
  LocalFsConfig,
  LocalFsManifestRecord,
  LocalFsManifestStore,
  LocalFsStatus,
} from '../shared/storage.js';
import {
  fetchEnrolledCoursesOnBackground,
  syncNowOnBackground,
  syncGoogleTasksOnBackground,
  loginTauSsoOnBackground,
  logoutOnBackground,
  resumeLocalFsSyncOnBackground,
  reconcileLocalFsOnBackground,
  fetchCourseStaffOnBackground,
  checkStoreUpdateOnBackground,
} from '../shared/messaging.js';
import { compareVersions, type StoreVersionCheckResult } from '../shared/versionChecker.js';
import { PanoptoStaffEditor, CourseStaffHostColumnCell } from './PanoptoStaffEditor.js';
import { getDueTextAndClass, formatGracePeriodTooltip } from '../shared/dateUtils.js';
import { getInlineMimeType } from '../shared/mimeUtils.js';
import { createFileSystemProvider, isFirefoxExtensionRuntime } from '../services/fs/FileSystemProvider.js';
import { ChromiumFsaProvider } from '../services/fs/ChromiumFsaProvider.js';
import { LocalFsSettingsSection } from './LocalFsSettingsSection.js';
import { translations } from '../shared/i18n';

import './App.css';
import logoImg from '../assets/logo.png';

const EMPTY_STAFF_ENTRIES: CoursePanoptoStaffEntry[] = [];

interface GroupedCourses {
  semesterKey: string;
  year: string;
  semester: 'SemesterA' | 'SemesterB' | 'Yearly' | 'Other';
  label: string;
  courses: any[];
}

export function buildFileDownloadUrl(rawUrl: string, token: string | null): string {
  if (!rawUrl) return '';
  let url = rawUrl;
  if (token && !token.startsWith('web_session_')) {
    url = `${url}${url.includes('?') ? '&' : '?'}token=${token}`;
  }
  return url;
}

export function buildFileOpenUrl(rawUrl: string, token: string | null): string {
  if (!rawUrl) return '';
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.delete('forcedownload');
    if (token && !token.startsWith('web_session_')) {
      parsed.searchParams.set('token', token);
    }
    return parsed.toString();
  } catch {
    let url = rawUrl.replace(/([?&])forcedownload=1(&|$)/g, (_m, p1, p2) => (p2 === '&' ? p1 : ''));
    if (token && !token.startsWith('web_session_')) {
      url = `${url}${url.includes('?') ? '&' : '?'}token=${token}`;
    }
    return url;
  }
}

function normalizeLocalFileLookupKey(rawUrl: string): string {
  const canonical = getCanonicalFileUrlPath(rawUrl);
  if (!canonical) return '';
  return canonical.replace(
    /\/webservice\/pluginfile\.php(?=\/|$)/,
    '/pluginfile.php'
  );
}

interface LocalFilesContextValue {
  enabled: boolean;
  findRecord: (rawUrl: string) => LocalFsManifestRecord | null;
  markLocalMissing: (moodleFileId: string) => void;
}

const LocalFilesContext = createContext<LocalFilesContextValue>({
  enabled: false,
  findRecord: () => null,
  markLocalMissing: () => { },
});

let cachedLocalLookup: {
  initialized: boolean;
  enabled: boolean;
  byUrl: Map<string, LocalFsManifestRecord>;
} = {
  initialized: false,
  enabled: false,
  byUrl: new Map(),
};

function buildLocalFileLookupMap(manifest: LocalFsManifestStore): Map<string, LocalFsManifestRecord> {
  const byUrl = new Map<string, LocalFsManifestRecord>();
  for (const rec of Object.values(manifest.files || {})) {
    if (rec?.canonicalUrlPath) {
      byUrl.set(normalizeLocalFileLookupKey(rec.canonicalUrlPath), rec);
    }
  }
  return byUrl;
}

export async function handleOpenFileInNewTab(
  e: React.MouseEvent<HTMLElement>,
  rawUrl: string,
  token: string | null,
  fileName: string,
  preResolvedLocalRecord?: LocalFsManifestRecord | null,
  onLocalOpenMissing?: (moodleFileId: string) => void
): Promise<void> {
  e.preventDefault();
  e.stopPropagation();

  // #5: Prefer locally synced filesystem copy for instantaneous opening when available.
  // Resolve synchronously before any await so Firefox retains click activation for downloads.open().
  try {
    let localEnabled = Boolean(preResolvedLocalRecord) || cachedLocalLookup.enabled;
    let matchedRecord: LocalFsManifestRecord | undefined = preResolvedLocalRecord ?? undefined;

    if (preResolvedLocalRecord === undefined && rawUrl) {
      if (cachedLocalLookup.initialized) {
        if (localEnabled) {
          matchedRecord = cachedLocalLookup.byUrl.get(normalizeLocalFileLookupKey(rawUrl));
        }
      } else if (!isFirefoxExtensionRuntime()) {
        // Only perform async storage fallback in non-Firefox runtimes where user activation isn't required for downloads.open
        const fsConfig = await getLocalFsConfig();
        localEnabled = fsConfig.enabled;
        if (localEnabled) {
          const manifest = await getLocalFsManifest();
          matchedRecord = buildLocalFileLookupMap(manifest).get(normalizeLocalFileLookupKey(rawUrl));
        }
      }
    }

    const canOpenViaLocalBackend = Boolean(
      localEnabled &&
      matchedRecord &&
      (!isFirefoxExtensionRuntime() || typeof matchedRecord.downloadId === 'number')
    );

    if (canOpenViaLocalBackend && matchedRecord) {
      const provider = createFileSystemProvider();
      const openedLocally = await provider.openLocalFile(matchedRecord);
      if (openedLocally) {
        return;
      }
      onLocalOpenMissing?.(matchedRecord.moodleFileId);
    }
  } catch (err) {
    console.warn('[LocalFS] Local file open check failed, falling back to Moodle URL:', err);
  }

  const openUrl = buildFileOpenUrl(rawUrl, token);
  if (!openUrl) return;

  const inlineMime = getInlineMimeType(fileName);
  const isSubmissionFile = openUrl.includes('assignsubmission_file') || openUrl.includes('submission_files');

  // If Moodle forces attachment download (especially on submitted files) and the browser can render the file inline,
  // fetch the bytes and open a blob URL with the explicit inline MIME type in a new tab.
  if (inlineMime && (isSubmissionFile || rawUrl.includes('forcedownload=1'))) {
    try {
      const res = await fetch(openUrl, { credentials: 'include' });
      const contentType = res.headers.get('content-type') || '';
      // Only use the blob if we didn't get redirected to an HTML login page (unless the file itself is HTML)
      if (res.ok && (!contentType.includes('text/html') || inlineMime.startsWith('text/html'))) {
        const arrayBuffer = await res.arrayBuffer();
        const blob = new Blob([arrayBuffer], { type: inlineMime });
        const blobUrl = URL.createObjectURL(blob);
        await browser.tabs.create({ url: blobUrl });
        setTimeout(() => URL.revokeObjectURL(blobUrl), 5 * 60 * 1000);
        return;
      }
    } catch (err) {
      console.warn('Inline blob preview failed, falling back to direct tab open:', err);
    }
  }

  await browser.tabs.create({ url: openUrl });
}

const PcIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

const GlobeIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

function FileOpenAction({
  rawUrl,
  openUrl,
  fileName,
  token,
  t,
  lang,
  style,
}: {
  rawUrl: string;
  openUrl: string;
  fileName: string;
  token: string | null;
  t: (key: keyof (typeof translations)['en']) => string;
  lang: 'he' | 'en';
  style?: React.CSSProperties;
}) {
  const localCtx = useContext(LocalFilesContext);
  const localRec = localCtx.enabled ? localCtx.findRecord(rawUrl) : null;
  const isFirefoxScanOnly = Boolean(
    localRec && isFirefoxExtensionRuntime() && typeof localRec.downloadId !== 'number'
  );

  if (localRec && !isFirefoxScanOnly) {
    const localLabel = lang === 'he' ? 'פתח' : 'Open';
    const localTooltip =
      lang === 'he'
        ? `עותק מקומי במחשב (${localRec.relativePath}) — לחץ לפתיחה`
        : `Local copy on PC (${localRec.relativePath}) — Click to open`;
    return (
      <button
        type="button"
        className="file-action-btn file-action-local"
        style={style}
        title={localTooltip}
        aria-label={localTooltip}
        onClick={(ev) =>
          handleOpenFileInNewTab(ev, rawUrl, token, fileName, localRec, localCtx.markLocalMissing)
        }
      >
        <PcIcon size={12} />
        <span>{localLabel}</span>
      </button>
    );
  }

  const webTooltip = isFirefoxScanOnly
    ? t('local_fs_scan_only_open_tooltip')
    : lang === 'he'
      ? 'פתח מ-Moodle (לא מסונכרן מקומית)'
      : 'Open from Moodle (not synced locally)';
  return (
    <a
      href={openUrl}
      target="_blank"
      rel="noreferrer"
      className="file-action-btn file-action-web"
      style={style}
      title={webTooltip}
      onClick={(ev) =>
        handleOpenFileInNewTab(ev, rawUrl, token, fileName, isFirefoxScanOnly ? null : undefined)
      }
    >
      <GlobeIcon size={12} />
      <span>{t('open_file')}</span>
    </a>
  );
}




function SyncProgressWindow({
  isOpen,
  isCollapsed,
  onCollapse,
  onExpand,
  isSyncing,
  syncState,
  syncError,
  hasPanopto,
  t,
  lang,
}: {
  isOpen: boolean;
  isCollapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  isSyncing: boolean;
  syncState: SyncProgressState | null;
  syncError?: string | null;
  hasPanopto?: boolean;
  t: (key: any) => string;
  lang: 'he' | 'en';
}) {
  useEffect(() => {
    if (!isOpen || isCollapsed) return;
    const handleClickOutside = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (
        target &&
        !target.closest('.sync-progress-window') &&
        !target.closest('.sync-progress-collapsed') &&
        !target.closest('.header-sync-btn')
      ) {
        onCollapse();
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, isCollapsed, onCollapse]);

  if (!isOpen) return null;

  const currentStage = syncState?.stage || (isSyncing ? 'init' : 'idle');
  const isComplete = currentStage === 'complete' || (!isSyncing && !syncError && syncState?.percent === 100);

  if (isCollapsed) {
    return (
      <div
        className="sync-progress-collapsed"
        onClick={onExpand}
        title={t('sync_expand')}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onExpand();
        }}
      >
        <div className="sync-collapsed-icon-wrap">
          {isComplete ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : syncError ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={isSyncing ? 'spinning-sync-icon' : ''}>
              <path d="M21 2v6h-6"></path>
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path>
              <path d="M3 22v-6h6"></path>
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path>
            </svg>
          )}
        </div>
        <span className="sync-collapsed-label">
          {isComplete ? t('sync_success') : `${syncState?.percent || (isSyncing ? 2 : 0)}%`}
        </span>
        <button
          className="sync-collapsed-arrow-btn"
          aria-label={t('sync_expand')}
          title={t('sync_expand')}
          onClick={(e) => {
            e.stopPropagation();
            onExpand();
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
      </div>
    );
  }

  const STAGE_ORDER: Record<string, number> = {
    idle: 0,
    init: 1,
    mapping: 2,
    global_fetch: 3,
    courses: 4,
    activities: 5,
    panopto: 6,
    finalizing: hasPanopto ? 7 : 6,
    complete: hasPanopto ? 8 : 7,
  };

  const currentStageIndex = isComplete
    ? (hasPanopto ? 8 : 7)
    : (STAGE_ORDER[currentStage] ?? (isSyncing ? 1 : 0));

  const tasks = [
    {
      id: 'init',
      order: 1,
      title: t('sync_task_init'),
    },
    {
      id: 'mapping',
      order: 2,
      title: t('sync_task_mapping'),
    },
    {
      id: 'global_fetch',
      order: 3,
      title: t('sync_task_global_fetch'),
    },
    {
      id: 'courses',
      order: 4,
      title: t('sync_task_courses'),
      subtext:
        currentStage === 'courses' && (syncState?.totalCourses || 0) > 0
          ? `${syncState?.coursesCompleted || 0} / ${syncState?.totalCourses} ${t('sync_courses_scanned')}`
          : undefined,
    },
    {
      id: 'activities',
      order: 5,
      title: t('sync_task_activities'),
      subtext:
        currentStage === 'activities' && (syncState?.totalActivities || 0) > 0
          ? `${syncState?.activitiesCompleted || 0} / ${syncState?.totalActivities} ${t('sync_activities_checked')}`
          : undefined,
    },
    ...(hasPanopto
      ? [
        {
          id: 'panopto',
          order: 6,
          title: t('sync_task_panopto'),
          subtext:
            currentStage === 'panopto' && (syncState?.totalPanoptoCourses || 0) > 0
              ? `${syncState?.panoptoCoursesCompleted || 0} / ${syncState?.totalPanoptoCourses} ${t('sync_panopto_scanned')}`
              : undefined,
        },
      ]
      : []),
    {
      id: 'finalizing',
      order: hasPanopto ? 7 : 6,
      title: t('sync_task_finalizing'),
    },
  ];

  return (
    <div
      className="sync-progress-window"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="sync-window-header">
        <div className="sync-window-title-row">
          {isComplete ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : syncError ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={isSyncing ? 'spinning-sync-icon' : ''}>
              <path d="M21 2v6h-6"></path>
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path>
              <path d="M3 22v-6h6"></path>
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path>
            </svg>
          )}
          <span className="sync-window-title">
            {isComplete ? t('sync_success') : syncError ? t('sync_failed') : t('sync_window_title')}
          </span>
        </div>
        <button
          className="sync-window-collapse-btn"
          onClick={onCollapse}
          aria-label={t('sync_collapse')}
          title={t('sync_collapse')}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      <div className="sync-tasks-list">
        {tasks.map((task) => {
          let status: 'done' | 'active' | 'pending' | 'failed' = 'pending';
          if (syncError && task.order === currentStageIndex) {
            status = 'failed';
          } else if (currentStageIndex > task.order || isComplete) {
            status = 'done';
          } else if (currentStageIndex === task.order && isSyncing) {
            status = 'active';
          }

          return (
            <div key={task.id} className={`sync-task-item status-${status}`}>
              <div className="sync-task-icon-col">
                {status === 'done' ? (
                  <div className="sync-task-badge done">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                ) : status === 'active' ? (
                  <div className="sync-task-badge active">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="spinning-sync-icon">
                      <line x1="12" y1="2" x2="12" y2="6"></line>
                      <line x1="12" y1="18" x2="12" y2="22"></line>
                      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                      <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                      <line x1="2" y1="12" x2="6" y2="12"></line>
                      <line x1="18" y1="12" x2="22" y2="12"></line>
                      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                      <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
                    </svg>
                  </div>
                ) : status === 'failed' ? (
                  <div className="sync-task-badge" style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid #ef4444', color: '#ef4444' }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </div>
                ) : (
                  <div className="sync-task-badge pending">
                    <div className="sync-task-dot" />
                  </div>
                )}
              </div>
              <div className="sync-task-content">
                <div className="sync-task-title">{task.title}</div>
                {task.subtext && <div className="sync-task-subtext">{task.subtext}</div>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="sync-window-footer">
        <span className="sync-window-status-msg">
          {syncError ? syncError : isComplete ? (lang === 'he' ? 'הכל מעודכן' : 'All up to date') : syncState?.message || t('syncing')}
        </span>
        <span className="sync-window-pct">
          {syncError ? '' : isComplete ? '100%' : `${syncState?.percent || (isSyncing ? 2 : 0)}%`}
        </span>
      </div>
    </div>
  );
}

export function getCourseMoodleUrl(
  courseIdOrObj: number | string | { id?: number; year?: string; instanceUrl?: string },
  fallbackLink?: string
): string {
  if (typeof courseIdOrObj === 'object' && courseIdOrObj !== null) {
    if (courseIdOrObj.instanceUrl) {
      return `${courseIdOrObj.instanceUrl}/course/view.php?id=${courseIdOrObj.id ?? ''}`;
    }
    if (courseIdOrObj.year && courseIdOrObj.year !== String(new Date().getFullYear())) {
      return `https://moodle.tau.ac.il/${courseIdOrObj.year}/course/view.php?id=${courseIdOrObj.id ?? ''}`;
    }
    return `https://moodle.tau.ac.il/course/view.php?id=${courseIdOrObj.id ?? ''}`;
  }

  const courseId = Number(courseIdOrObj);
  if (fallbackLink && fallbackLink.includes('/mod/')) {
    const root = fallbackLink.split('/mod/')[0];
    return `${root}/course/view.php?id=${courseId}`;
  }
  return `https://moodle.tau.ac.il/course/view.php?id=${courseId}`;
}

function groupAndSortCourses(courses: any[], lang: 'he' | 'en'): GroupedCourses[] {
  const groups: Record<string, any[]> = {};

  courses.forEach(c => {
    const idNum = c.idnumber || c.shortname || '';
    const meta = parseTauCourseMetadata(idNum);
    const year = meta?.year || c.year || '';
    const semester = meta?.semester || c.semester || 'Other';

    const key = year ? `${year}-${semester}` : 'Other';
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(c);
  });

  const result: GroupedCourses[] = [];

  Object.keys(groups).forEach(key => {
    if (key === 'Other') {
      result.push({
        semesterKey: 'Other',
        year: '',
        semester: 'Other',
        label: lang === 'he' ? 'אחר' : 'Other',
        courses: groups[key]
      });
    } else {
      const [year, semester] = key.split('-');
      let label = '';
      if (lang === 'he') {
        const semName = semester === 'SemesterA' ? "סמסטר א'" : semester === 'SemesterB' ? "סמסטר ב'" : semester === 'Yearly' ? "שנתי" : "קורסים כלליים";
        label = `${semName} (${year})`;
      } else {
        const semName = semester === 'SemesterA' ? "Semester A" : semester === 'SemesterB' ? "Semester B" : semester === 'Yearly' ? "Yearly" : "General";
        label = `${semName} (${year})`;
      }
      result.push({
        semesterKey: key,
        year,
        semester: semester as any,
        label,
        courses: groups[key]
      });
    }
  });

  result.sort((a, b) => {
    if (a.semesterKey === 'Other') return 1;
    if (b.semesterKey === 'Other') return -1;

    const yearDiff = parseInt(b.year) - parseInt(a.year);
    if (yearDiff !== 0) return yearDiff;

    const getSemValue = (sem: string) => {
      if (sem === 'SemesterB') return 3;
      if (sem === 'SemesterA') return 2;
      if (sem === 'Yearly') return 1;
      return 0;
    };

    return getSemValue(b.semester) - getSemValue(a.semester);
  });

  return result;
}

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [trackedCourseIds, setTrackedCourseIdsState] = useState<number[]>([]);
  const [settings, setSettingsState] = useState<ExtensionSettings | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [assignmentFilterCourseId, setAssignmentFilterCourseId] = useState<number | null>(null);
  const [focusedAssignmentId, setFocusedAssignmentId] = useState<number | null>(null);
  const [focusedRecordingId, setFocusedRecordingId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [showHiddenZoomCourseIds, setShowHiddenZoomCourseIds] = useState<Set<number>>(new Set());
  const [showHiddenPanoptoCourseIds, setShowHiddenPanoptoCourseIds] = useState<Set<number>>(new Set());
  const [cachedCourseStaff, setCachedCourseStaff] = useState<Record<number, CourseStaffMember[]>>({});
  const [loadingStaffCourseIds, setLoadingStaffCourseIds] = useState<Set<number>>(new Set());
  const autoFetchedStaffCourseIdsRef = useRef<Set<number>>(new Set());
  const [labModalCourse, setLabModalCourse] = useState<{ id: number; name: string } | null>(null);
  const [pendingLabHideCourseIds, setPendingLabHideCourseIds] = useState<number[]>([]);

  const handleToggleShowHiddenZoom = (courseId: number) => {
    setShowHiddenZoomCourseIds((prev) => {
      const next = new Set(prev);
      if (next.has(courseId)) {
        next.delete(courseId);
      } else {
        next.add(courseId);
      }
      return next;
    });
  };

  const handleToggleShowHiddenPanopto = (courseId: number) => {
    setShowHiddenPanoptoCourseIds((prev) => {
      const next = new Set(prev);
      if (next.has(courseId)) {
        next.delete(courseId);
      } else {
        next.add(courseId);
      }
      return next;
    });
  };

  useEffect(() => {
    browser.storage.local.get('sidebarCollapsed').then((res) => {
      if (res && res.sidebarCollapsed !== undefined) {
        setSidebarCollapsed(!!res.sidebarCollapsed);
      }
    });
  }, []);

  const toggleSidebarCollapse = async () => {
    const val = !sidebarCollapsed;
    setSidebarCollapsed(val);
    await browser.storage.local.set({ sidebarCollapsed: val });
  };

  const [signingInToMoodle, setSigningInToMoodle] = useState<boolean>(false);

  useEffect(() => {
    const handleGlobalClick = async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest('a');
      if (link && link.href && link.href.includes('moodle.tau.ac.il') && link.dataset.moodleLink === 'true') {
        e.preventDefault();
        e.stopPropagation();

        setSigningInToMoodle(true);
        try {
          const allCookies = await browser.cookies.getAll({ domain: 'moodle.tau.ac.il' }).catch(() => []);
          const hasSession = allCookies.some((c) => c.name.startsWith('MoodleSession'));
          if (hasSession) {
            await browser.tabs.create({ url: link.href });
            return;
          }

          const creds = await getMoodleCredentials();
          if (creds && creds.username && creds.password) {
            try {
              await loginTauSsoOnBackground(creds.username, creds.idNumber || '', creds.password, true);
            } catch (err) {
              console.error('SSO auto-login failed', err);
            }
          }
          await browser.tabs.create({ url: link.href });
        } finally {
          setSigningInToMoodle(false);
        }
      }
    };
    document.addEventListener('click', handleGlobalClick, true);
    return () => document.removeEventListener('click', handleGlobalClick, true);
  }, []);

  // Toast and Tour States
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [showTour, setShowTour] = useState<boolean>(false);
  const [tourStep, setTourStep] = useState<number>(-1);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
  };

  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(id);
    }
  }, [toast]);

  const trackedCourseIdsRef = useRef(trackedCourseIds);
  trackedCourseIdsRef.current = trackedCourseIds;

  useEffect(() => {
    if (tourStep >= 0 && tourStep <= 4) {
      setActiveTab('dashboard');
      setSelectedCourseId(null);
    } else if (tourStep === 5) {
      setActiveTab('dashboard');
      setSelectedCourseId(trackedCourseIdsRef.current[0] ?? null);
    } else if (tourStep === 6) {
      setActiveTab('assignments');
      setSelectedCourseId(null);
    } else if (tourStep === 7) {
      setActiveTab('grades');
      setSelectedCourseId(null);
    } else if (tourStep === 8) {
      setActiveTab('settings');
      setSelectedCourseId(null);
    } else if (tourStep === 9) {
      setActiveTab('about');
      setSelectedCourseId(null);
    }
  }, [tourStep]);

  const handleStartTour = () => {
    setSelectedCourseId(null);
    setActiveTab('dashboard');
    setShowTour(true);
    setTourStep(0);
  };

  const handleCloseTour = async () => {
    setShowTour(false);
    setTourStep(-1);
    setActiveTab('dashboard');
    setSelectedCourseId(null);
    await browser.storage.local.set({ hasSeenTour: true });
  };

  // Store Version Checker States
  const [storeUpdateStatus, setStoreUpdateStatus] = useState<StoreVersionCheckResult | null>(null);
  const [dismissedUpdateVersion, setDismissedUpdateVersionState] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [cached, dismissed] = await Promise.all([
        getStoreUpdateStatus(),
        getDismissedUpdateVersion(),
      ]);
      if (!active) return;
      if (cached) setStoreUpdateStatus(cached);
      if (dismissed) setDismissedUpdateVersionState(dismissed);

      const res = await checkStoreUpdateOnBackground(false);
      if (!active) return;
      if (res?.success && res.result?.latestVersion) {
        setStoreUpdateStatus((prev) =>
          prev && prev.checkedAt > res.result!.checkedAt ? prev : res.result!
        );
      }
    })();

    const onStorageChange = (changes: Record<string, browser.Storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local') return;
      if (changes[STORE_UPDATE_STATUS_KEY]) {
        setStoreUpdateStatus((changes[STORE_UPDATE_STATUS_KEY].newValue as StoreVersionCheckResult) || null);
      }
      if (changes[DISMISSED_UPDATE_VERSION_KEY]) {
        setDismissedUpdateVersionState((changes[DISMISSED_UPDATE_VERSION_KEY].newValue as string) || null);
      }
    };
    browser.storage.onChanged.addListener(onStorageChange);
    return () => {
      active = false;
      browser.storage.onChanged.removeListener(onStorageChange);
    };
  }, []);

  const handleDismissStoreUpdate = async (version: string) => {
    setDismissedUpdateVersionState(version);
    await setDismissedUpdateVersion(version);
  };

  const currentManifestVersion = browser.runtime.getManifest()?.version || '0.0.0';
  const showSidebarUpdateBanner = Boolean(
    storeUpdateStatus?.latestVersion &&
    dismissedUpdateVersion !== storeUpdateStatus.latestVersion &&
    compareVersions(storeUpdateStatus.latestVersion, currentManifestVersion) > 0
  );

  // Onboarding States
  const [moodleUsername, setMoodleUsername] = useState<string>('');
  const [moodleId, setMoodleId] = useState<string>('');
  const [moodlePassword, setMoodlePassword] = useState<string>('');
  const [rememberMe, setRememberMe] = useState<boolean>(true);
  const [validatingToken, setValidatingToken] = useState<boolean>(false);
  const [availableCourses, setAvailableCourses] = useState<any[]>([]);
  const [onboardingStep, setOnboardingStep] = useState<number>(1); // 1 = connect moodle, 2 = select courses

  // Settings tab states
  const [googleSyncStatus, setGoogleSyncStatus] = useState<string | null>(null);
  const [googleSyncLoading, setGoogleSyncLoading] = useState<boolean>(false);
  const [hasGoogleTasksToken, setHasGoogleTasksToken] = useState<boolean>(false);
  const [googleTasksAuthError, setGoogleTasksAuthError] = useState<string | null>(null);
  const [localFsConfig, setLocalFsConfigState] = useState<LocalFsConfig>(DEFAULT_LOCAL_FS_CONFIG);
  const [localFsStatus, setLocalFsStatusState] = useState<LocalFsStatus>(DEFAULT_LOCAL_FS_STATUS);
  const [localFsManifest, setLocalFsManifestState] = useState<LocalFsManifestStore>({
    files: {},
    courseFolderNames: {},
  });
  const [missingLocalFileIds, setMissingLocalFileIds] = useState<Set<string>>(() => new Set());

  // Panopto Host Permissions State
  const PANOPTO_ORIGINS = ['https://*.panopto.eu/*', '*://*.panopto.tau.ac.il/*'];
  const [hasPanoptoPermission, setHasPanoptoPermission] = useState<boolean>(true);

  const checkPanoptoPermission = async () => {
    if (typeof browser !== 'undefined' && browser.permissions?.contains) {
      try {
        const hasIt = await browser.permissions.contains({ origins: PANOPTO_ORIGINS });
        setHasPanoptoPermission(hasIt);
        return hasIt;
      } catch {
        setHasPanoptoPermission(true);
        return true;
      }
    }
    return true;
  };

  useEffect(() => {
    checkPanoptoPermission();
  }, [settings?.panoptoEnabled]);

  const handleRequestPanoptoPermission = async () => {
    if (typeof browser !== 'undefined' && browser.permissions?.request) {
      try {
        const granted = await browser.permissions.request({ origins: PANOPTO_ORIGINS });
        if (granted) {
          setHasPanoptoPermission(true);
          handleManualSync();
        }
        return granted;
      } catch (err) {
        console.warn('[Panopto] Error requesting permissions:', err);
      }
    }
    return false;
  };


  // Backup and custom disconnect states
  const [showDisconnectModal, setShowDisconnectModal] = useState<boolean>(false);
  const [deletePermanently, setDeletePermanently] = useState<boolean>(false);
  const [isManageModalOpen, setIsManageModalOpen] = useState<boolean>(false);



  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [showSyncWindow, setShowSyncWindow] = useState<boolean>(false);
  const [isSyncWindowCollapsed, setIsSyncWindowCollapsed] = useState<boolean>(false);
  const [syncState, setSyncState] = useState<SyncProgressState | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Dashboard Max Width State (persisted in localStorage, default 1200px)
  const DEFAULT_DASHBOARD_WIDTH = 1200;
  const [dashboardMaxWidth, setDashboardMaxWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('noodle_dashboard_max_width');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 720 && parsed <= 3840) {
          return parsed;
        }
      }
    } catch {
      // Ignore
    }
    return DEFAULT_DASHBOARD_WIDTH;
  });

  const [isResizingWidth, setIsResizingWidth] = useState<boolean>(false);
  const mainViewportRef = useRef<HTMLDivElement | null>(null);

  const handleUpdateDashboardWidth = (width: number) => {
    const clamped = Math.max(720, Math.min(width, 3840));
    setDashboardMaxWidth(clamped);
    try {
      localStorage.setItem('noodle_dashboard_max_width', String(clamped));
    } catch {
      // Ignore
    }
  };

  const handleResetDashboardWidth = () => {
    setDashboardMaxWidth(DEFAULT_DASHBOARD_WIDTH);
    try {
      localStorage.setItem('noodle_dashboard_max_width', String(DEFAULT_DASHBOARD_WIDTH));
    } catch {
      // Ignore
    }
  };

  const handleResizeMouseDown = (e: React.MouseEvent, _side: 'left' | 'right') => {
    e.preventDefault();
    if (!mainViewportRef.current) return;

    const viewportRect = mainViewportRef.current.getBoundingClientRect();
    const centerX = viewportRect.left + viewportRect.width / 2;
    setIsResizingWidth(true);

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    let currentWidth = dashboardMaxWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      const distFromCenter = Math.abs(moveEvent.clientX - centerX);
      let newWidth = Math.round(distFromCenter * 2);

      // Snap to full width if within 25px of the viewport width
      if (newWidth >= viewportRect.width - 30) {
        newWidth = Math.round(viewportRect.width);
      }

      const minW = Math.min(760, Math.round(viewportRect.width - 20));
      const maxW = Math.round(viewportRect.width);
      const clamped = Math.max(minW, Math.min(newWidth, maxW));

      currentWidth = clamped;
      setDashboardMaxWidth(clamped);
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setIsResizingWidth(false);

      try {
        localStorage.setItem('noodle_dashboard_max_width', String(currentWidth));
      } catch {
        // Ignore
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  useEffect(() => {
    // Ask the background for its live in-memory sync state first; the persisted
    // `isSyncing` storage flag can be stale after an extension reload mid-sync.
    browser.runtime
      .sendMessage({ type: 'GET_SYNC_STATUS' })
      .then((res: any) => {
        if (res && typeof res.isSyncing === 'boolean') {
          setIsSyncing(res.isSyncing);
          if (res.isSyncing) {
            if (res.syncState) setSyncState(res.syncState);
          }
          if (!res.isSyncing) browser.storage.local.set({ isSyncing: false }).catch(() => { });
          return;
        }
        throw new Error('No sync status');
      })
      .catch(() =>
        browser.storage.local.get('isSyncing').then((res: any) => {
          if (res.isSyncing !== undefined) setIsSyncing(res.isSyncing);
        })
      );

    // Keep in sync with syncs triggered elsewhere (popup, alarm, other tabs)
    const onStorage = (changes: Record<string, any>, area: string) => {
      if (area === 'local' && 'isSyncing' in changes) {
        setIsSyncing(Boolean(changes.isSyncing?.newValue));
      }
    };
    browser.storage.onChanged.addListener(onStorage);
    return () => browser.storage.onChanged.removeListener(onStorage);
  }, []);

  useEffect(() => {
    const messageListener = (msg: any) => {
      if (msg.type === 'SYNC_START') {
        setIsSyncing(true);
        if (msg.isManual) {
          setShowSyncWindow(true);
          setIsSyncWindowCollapsed(false);
        }
        setSyncError(null);
      }
      if (msg.type === 'SYNC_PROGRESS') {
        if (typeof msg.percent === 'number' && !isNaN(msg.percent)) {
        }
        if (msg.syncState) {
          setSyncState(msg.syncState);
        } else if (msg.stage) {
          setSyncState((prev) => ({
            percent: msg.percent ?? prev?.percent ?? 0,
            stage: msg.stage,
            message: msg.msg || prev?.message || '',
            coursesCompleted: prev?.coursesCompleted ?? 0,
            totalCourses: prev?.totalCourses ?? 0,
            activitiesCompleted: prev?.activitiesCompleted ?? 0,
            totalActivities: prev?.totalActivities ?? 0,
          }));
        }
      }
      if (msg.type === 'SYNC_PARTIAL') {
        if (msg.partial && typeof msg.partial === 'object') {
          if (msg.partial.courseStaff && Object.keys(msg.partial.courseStaff).length > 0) {
            setCachedCourseStaff((prev) => ({ ...prev, ...msg.partial.courseStaff }));
          }
          setSyncResult((prev) => ({
            ...prev,
            syncedAt: msg.partial.syncedAt || prev?.syncedAt || new Date().toISOString(),
            assignments: msg.partial.assignments ?? prev?.assignments ?? [],
            meetings: msg.partial.meetings ?? prev?.meetings ?? [],
            files: msg.partial.files ?? prev?.files ?? [],
            recordings: msg.partial.recordings ?? prev?.recordings ?? [],
            sections: msg.partial.sections ?? prev?.sections ?? [],
            folders: msg.partial.folders ?? prev?.folders ?? [],
            links: msg.partial.links ?? prev?.links ?? [],
            announcements: msg.partial.announcements ?? prev?.announcements ?? [],
            gradeSummaries: msg.partial.gradeSummaries ?? prev?.gradeSummaries ?? {},
            ...(msg.partial.courseStaff ?? prev?.courseStaff
              ? { courseStaff: msg.partial.courseStaff ?? prev?.courseStaff }
              : {}),
            errors: msg.partial.errors ?? prev?.errors ?? [],
          }));
        } else {
          getCachedSyncResult().then((cached) => {
            if (cached) setSyncResult(cached);
          });
        }
      }
      if (msg.type === 'SYNC_COMPLETE') {
        setSyncState((prev) => ({
          percent: 100,
          stage: 'complete',
          message: 'Sync completed.',
          coursesCompleted: prev?.totalCourses || prev?.coursesCompleted || 0,
          totalCourses: prev?.totalCourses || 0,
          activitiesCompleted: prev?.totalActivities || prev?.activitiesCompleted || 0,
          totalActivities: prev?.totalActivities || 0,
        }));
        setTimeout(() => {
          setIsSyncing(false);
          setLoading(false);
        }, 500);
        setTimeout(() => {
          setShowSyncWindow(false);
          setIsSyncWindowCollapsed(false);
        }, 2500);
        // Re-read settings/trackedCourseIds from storage in case sync applied remote changes
        Promise.all([getTrackedCourseIds(), getSettings(), getCachedSyncResult(), getCachedCourseStaff()]).then(([ids, extSettings, cached, staffCache]) => {
          setTrackedCourseIdsState(ids);
          setSettingsState(extSettings);
          if (cached) setSyncResult(cached);
          if (staffCache && Object.keys(staffCache).length > 0) {
            setCachedCourseStaff(staffCache);
          }
        });
        if (msg.result) {
          setSyncResult(msg.result);
        }
      }
    };
    browser.runtime.onMessage.addListener(messageListener);
    return () => browser.runtime.onMessage.removeListener(messageListener);
  }, []);

  useEffect(() => {
    loadData();

    const handleStorageChange = (changes: { [key: string]: any }, areaName: string) => {
      if (areaName === 'local') {
        if (changes.wstoken && changes.wstoken.newValue) {
          // If the token is identical to our current state or we are in active course selection, avoid re-running onboarding
          if (changes.wstoken.newValue !== token && onboardingStep !== 2) {
            loadData();
          }
        }
        if (changes.googleAccessToken || changes.googleTokenExpiry) {
          const hasToken = !!(changes.googleAccessToken?.newValue && (!changes.googleTokenExpiry?.newValue || changes.googleTokenExpiry.newValue > Date.now()));
          setHasGoogleTasksToken(hasToken);
        }
        if ('googleTasksAuthError' in changes) {
          setGoogleTasksAuthError(changes.googleTasksAuthError?.newValue || null);
        }
        if (changes.cachedSyncResult?.newValue) {
          setSyncResult(changes.cachedSyncResult.newValue);
        }
        if ('cachedCourseStaff' in changes) {
          setCachedCourseStaff(changes.cachedCourseStaff?.newValue || {});
        }
        if (changes.localFsConfig?.newValue) {
          setLocalFsConfigState({ ...DEFAULT_LOCAL_FS_CONFIG, ...changes.localFsConfig.newValue });
        }
        if (changes.localFsStatus?.newValue) {
          setLocalFsStatusState({ ...DEFAULT_LOCAL_FS_STATUS, ...changes.localFsStatus.newValue });
        }
        if (changes.localFsManifest?.newValue) {
          setLocalFsManifestState({
            files: {},
            courseFolderNames: {},
            ...changes.localFsManifest.newValue,
          });
          setMissingLocalFileIds(new Set());
        } else if ('localFsManifest' in changes && !changes.localFsManifest?.newValue) {
          setLocalFsManifestState({ files: {}, courseFolderNames: {} });
          setMissingLocalFileIds(new Set());
        }
      }
    };
    browser.storage.onChanged.addListener(handleStorageChange);
    return () => browser.storage.onChanged.removeListener(handleStorageChange);
  }, [token, onboardingStep]);

  const localFilesByUrl = useMemo(() => buildLocalFileLookupMap(localFsManifest), [localFsManifest]);

  useEffect(() => {
    cachedLocalLookup = {
      initialized: true,
      enabled: localFsConfig.enabled,
      byUrl: localFilesByUrl,
    };
  }, [localFsConfig.enabled, localFilesByUrl]);

  const localFilesCtxValue = useMemo<LocalFilesContextValue>(() => ({
    enabled: localFsConfig.enabled,
    findRecord: (rawUrl: string) => {
      if (!localFsConfig.enabled || !rawUrl) return null;
      const rec = localFilesByUrl.get(normalizeLocalFileLookupKey(rawUrl));
      if (!rec || missingLocalFileIds.has(rec.moodleFileId)) return null;
      return rec;
    },
    markLocalMissing: (moodleFileId: string) => {
      setMissingLocalFileIds((prev) => {
        if (prev.has(moodleFileId)) return prev;
        const next = new Set(prev);
        next.add(moodleFileId);
        return next;
      });
    },
  }), [localFsConfig.enabled, localFilesByUrl, missingLocalFileIds]);

  useEffect(() => {
    const applyTheme = () => {
      const eff = getEffectiveTheme(settings);
      document.body.className = `theme-${eff}`;
    };
    applyTheme();
    if (settings?.theme === 'time') {
      const interval = setInterval(applyTheme, 30000);
      return () => clearInterval(interval);
    }
  }, [settings?.theme, settings?.themeTimeDayStart, settings?.themeTimeDayEnd]);

  useEffect(() => {
    if (token && trackedCourseIds && trackedCourseIds.length > 0 && settings) {
      getMoodleCredentials().then((creds) => {
        const backup: any = {
          version: "TauTrackerConfig-v1",
          trackedCourseIds: trackedCourseIds,
          settings: settings
        };
        if (creds) {
          backup.wstoken = token;
        }
        browser.storage.local.set({ config_backup: backup });
      });
    }
  }, [token, trackedCourseIds, settings]);

  const groupedCoursesResult = useMemo(() => groupEnrolledCourses(availableCourses), [availableCourses]);
  const excludedGpaCourseIds = useMemo(() => {
    const ids = new Set<number>();
    if (groupedCoursesResult.administrativeUmbrella) {
      ids.add(-5900);
      for (const sub of groupedCoursesResult.administrativeUmbrella.subCourses) {
        ids.add(sub.courseId);
      }
    }
    for (const c of availableCourses) {
      if (isAdministrativeCourse(c)) ids.add(c.id);
    }
    return ids;
  }, [groupedCoursesResult, availableCourses]);

  // Merge tracked sub-course items into parent academic portals when multiple portals exist for the same course and parent is tracked
  const mergedSyncView = useMemo(() => {
    if (!syncResult) return null;
    const baseStaffMap: Record<number, CourseStaffMember[]> = {
      ...cachedCourseStaff,
      ...(syncResult.courseStaff || {}),
    };
    const trackedSet = new Set(trackedCourseIds);
    const multiPortalGroups = groupedCoursesResult.academicCourses
      .filter((u) => u.subCourses.length > 1 && trackedSet.has(u.id))
      .map((u) => ({
        ...u,
        subCourses: u.subCourses.filter((s) => trackedSet.has(s.courseId)),
      }))
      .filter((u) => u.subCourses.length > 1);
    if (multiPortalGroups.length === 0) {
      if ((syncResult.recordings && syncResult.recordings.length > 0) || Object.keys(baseStaffMap).length > 0) {
        return {
          ...syncResult,
          ...(Object.keys(baseStaffMap).length > 0 ? { courseStaff: baseStaffMap } : {}),
          recordings: reclassifyPanoptoRecordings(
            syncResult.recordings || [],
            settings?.coursesPanoptoStaff,
            baseStaffMap
          ),
        };
      }
      return syncResult;
    }

    const childCourseIds = new Set<number>();
    for (const u of multiPortalGroups) {
      for (const s of u.subCourses) {
        if (s.courseId !== u.id) childCourseIds.add(s.courseId);
      }
    }
    if (childCourseIds.size === 0) {
      if ((syncResult.recordings && syncResult.recordings.length > 0) || Object.keys(baseStaffMap).length > 0) {
        return {
          ...syncResult,
          ...(Object.keys(baseStaffMap).length > 0 ? { courseStaff: baseStaffMap } : {}),
          recordings: reclassifyPanoptoRecordings(
            syncResult.recordings || [],
            settings?.coursesPanoptoStaff,
            baseStaffMap
          ),
        };
      }
      return syncResult;
    }

    let assignments = (syncResult.assignments || []).filter((a) => !childCourseIds.has(a.courseId));
    let files = (syncResult.files || []).filter((f) => !childCourseIds.has(f.courseId));
    let meetings = (syncResult.meetings || []).filter((m) => !childCourseIds.has(m.courseId));
    let folders = (syncResult.folders || []).filter((fld) => !childCourseIds.has(fld.courseId));
    let links = (syncResult.links || []).filter((lnk) => !childCourseIds.has(lnk.courseId));
    let sections = (syncResult.sections || []).filter((sec) => !childCourseIds.has(sec.courseId));
    let announcements = (syncResult.announcements || []).filter((ann) => !childCourseIds.has(ann.courseId));
    let recordings = (syncResult.recordings || []).filter((rec) => !childCourseIds.has(rec.courseId));
    const gradeSummaries = { ...(syncResult.gradeSummaries || {}) };
    const courseStaff: Record<number, CourseStaffMember[]> = { ...baseStaffMap };

    for (const u of multiPortalGroups) {
      const agg = aggregateUnifiedCourseItems(u, syncResult);
      assignments = assignments.filter((a) => a.courseId !== u.id).concat(agg.assignments);
      files = files.filter((f) => f.courseId !== u.id).concat(agg.files);
      meetings = meetings.filter((m) => m.courseId !== u.id).concat(agg.meetings);
      folders = folders.filter((fld) => fld.courseId !== u.id).concat(agg.folders);
      links = links.filter((lnk) => lnk.courseId !== u.id).concat(agg.links);
      sections = sections.filter((sec) => sec.courseId !== u.id).concat(agg.sections);
      announcements = announcements.filter((ann) => ann.courseId !== u.id).concat(agg.announcements);
      recordings = recordings.filter((rec) => rec.courseId !== u.id).concat(agg.recordings);
      if (agg.gradeSummary) {
        gradeSummaries[u.id] = agg.gradeSummary;
      }
      if (Object.keys(baseStaffMap).length > 0) {
        const combinedStaff: CourseStaffMember[] = [];
        const seenNames = new Set<string>();
        for (const sub of u.subCourses) {
          for (const member of baseStaffMap[sub.courseId] || []) {
            const key = normalizePersonName(member.fullName);
            if (!key || seenNames.has(key)) continue;
            seenNames.add(key);
            combinedStaff.push(member);
          }
        }
        if (combinedStaff.length > 0) {
          courseStaff[u.id] = combinedStaff;
        }
      }
    }

    return {
      ...syncResult,
      assignments,
      files,
      meetings,
      folders,
      links,
      sections,
      announcements,
      recordings:
        recordings.length > 0
          ? reclassifyPanoptoRecordings(
            recordings,
            settings?.coursesPanoptoStaff,
            courseStaff,
            (() => {
              const aliases = new Map<number, number[]>();
              for (const u of multiPortalGroups) {
                const memberIds = u.subCourses.map((s) => s.courseId);
                for (const id of memberIds) aliases.set(id, memberIds);
              }
              return aliases;
            })()
          )
          : recordings,
      gradeSummaries,
      ...(Object.keys(courseStaff).length > 0 ? { courseStaff } : {}),
    };
  }, [syncResult, cachedCourseStaff, groupedCoursesResult, trackedCourseIds, settings?.coursesPanoptoStaff]);

  const assignmentsList = useMemo(() => {
    const rawAssignments = (mergedSyncView || syncResult)?.assignments || [];
    return rawAssignments.map((a) => {
      const isMoodleSubmitted = isMoodleActivitySubmitted(a);
      const isCompleted = isActivityCompleted(
        a,
        settings?.completedAssignments,
        settings?.uncompletedAssignments
      );

      const isHidden = isActivityHidden(a, settings?.hiddenAssignments);

      return {
        ...a,
        isMoodleSubmitted,
        isCompleted,
        isHidden,
        status: a.status as 'Assigned' | 'Submitted' | 'Not submitted',
      };
    });
  }, [mergedSyncView, syncResult?.assignments, settings?.completedAssignments, settings?.uncompletedAssignments, settings?.hiddenAssignments]);

  const filesList = mergedSyncView?.files || [];
  const meetingsList = mergedSyncView?.meetings || [];
  const recordingsList = mergedSyncView?.recordings || [];

  async function loadData() {
    setLoading(true);
    try {
      const storedToken = await getStoredToken();
      const ids = await getTrackedCourseIds();
      const extensionSettings = await getSettings();

      // Load cached enrolled courses if available
      const cachedCoursesRes = (await browser.storage.local.get('enrolledCoursesCache')) as { enrolledCoursesCache?: any[] };
      if (cachedCoursesRes.enrolledCoursesCache) {
        setAvailableCourses(cachedCoursesRes.enrolledCoursesCache);
      }

      // Prefill credentials if they exist
      const credentials = await getMoodleCredentials();
      if (credentials) {
        if (credentials.username) setMoodleUsername(credentials.username);
        if (credentials.idNumber) setMoodleId(credentials.idNumber);
      }

      const tourSeenRes = await browser.storage.local.get('hasSeenTour');
      const googleAuthRes = (await browser.storage.local.get([
        'googleAccessToken',
        'googleTokenExpiry',
        'googleTasksAuthError',
      ])) as {
        googleAccessToken?: string;
        googleTokenExpiry?: number;
        googleTasksAuthError?: string | null;
      };
      const isGoogleAuth = !!(googleAuthRes.googleAccessToken && (!googleAuthRes.googleTokenExpiry || googleAuthRes.googleTokenExpiry > Date.now()));
      setHasGoogleTasksToken(isGoogleAuth);
      setGoogleTasksAuthError(googleAuthRes.googleTasksAuthError || null);

      setToken(storedToken);
      setTrackedCourseIdsState(ids);
      setSettingsState(extensionSettings);

      const [fsCfg, fsStat, fsManifest] = await Promise.all([
        getLocalFsConfig(),
        getLocalFsStatus(),
        getLocalFsManifest(),
      ]);
      setLocalFsConfigState(fsCfg);
      setLocalFsStatusState(fsStat);
      setLocalFsManifestState(fsManifest);

      if (fsCfg.enabled && isFirefoxExtensionRuntime()) {
        // Reconcile stale Firefox downloadIds via background lock so UI never races storage
        void reconcileLocalFsOnBackground().then((res) => {
          if (
            res.success &&
            !fsCfg.autoResyncMissingFiles &&
            Array.isArray(res.confirmedMissingIds) &&
            res.confirmedMissingIds.length > 0
          ) {
            setMissingLocalFileIds((prev) => {
              const next = new Set(prev);
              for (const id of res.confirmedMissingIds!) next.add(id);
              return next;
            });
          }
        });
      }

      const [cached, storedStaff] = await Promise.all([
        getCachedSyncResult(),
        getCachedCourseStaff(),
      ]);
      setSyncResult(cached);
      const mergedStaffCache: Record<number, CourseStaffMember[]> = {
        ...(cached?.courseStaff || {}),
        ...storedStaff,
      };
      setCachedCourseStaff(mergedStaffCache);
      if (cached?.courseStaff && Object.keys(cached.courseStaff).length > 0 && Object.keys(storedStaff).length === 0) {
        void mergeCachedCourseStaff(cached.courseStaff);
      }

      if (storedToken && ids.length > 0) {
        setOnboardingStep(3); // Fully set up
        fetchEnrolledCoursesInBackground(storedToken);
        if (!tourSeenRes.hasSeenTour) {
          setShowTour(true);
          setTourStep(0);
        }
      } else if (storedToken) {
        if (cachedCoursesRes.enrolledCoursesCache && cachedCoursesRes.enrolledCoursesCache.length > 0) {
          setOnboardingStep((prev) => (prev === 3 ? 3 : 2));
        }
        // Token exists but courses might not be tracked yet — try to restore from Moodle
        restoreMoodleSettingsForOnboarding(storedToken);
      } else {
        setOnboardingStep(1);
      }
    } catch (e) {
      console.error('Error loading extension data:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleMoodleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!moodleUsername || !moodleId || !moodlePassword) return;

    if (!isValidIsraeliId(moodleId)) {
      showToast(currentLang === 'he' ? 'מספר תעודת זהות לא תקין' : 'Invalid Israeli ID', 'error');
      return;
    }

    setLoading(true);
    try {
      const res = await loginTauSsoOnBackground(moodleUsername, moodleId, moodlePassword);
      if (!res?.success || !res.token) {
        throw new Error(res?.error || 'Failed to generate token from SSO');
      }
      const fetchedToken = res.token;
      await setStoredToken(fetchedToken);
      if (rememberMe) {
        await setMoodleCredentials({ username: moodleUsername, idNumber: moodleId, password: moodlePassword });
      } else {
        await setMoodleCredentials(null);
      }
      setToken(fetchedToken);
      await restoreMoodleSettingsForOnboarding(fetchedToken);
    } catch (err: any) {
      showToast(`Login failed: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function fetchEnrolledCoursesInBackground(t: string) {
    try {
      const res = await fetchEnrolledCoursesOnBackground(t);
      if (res?.success && res.courses) {
        setAvailableCourses(res.courses);
        await browser.storage.local.set({ enrolledCoursesCache: res.courses });
      }
    } catch (e) {
      console.warn('Failed to background fetch enrolled courses:', e);
    }
  }

  async function restoreMoodleSettingsForOnboarding(t: string) {
    if (validatingToken) return;
    setValidatingToken(true);
    try {
      const sesskey = await getStoredSesskey();
      const client = new MoodleClient(t, undefined, {
        sesskey: sesskey || undefined,
        devMode: true,
        enableScraping: false // Legacy Web Scraping fallback removed
      });
      const remoteSettings = await client.loadNoodleSettings();
      if (remoteSettings && Object.keys(remoteSettings).length > 0) {
        // We found existing remote settings, apply them directly!
        const updatedSettings = { ...settings } as ExtensionSettings;
        let foundTrackedCourses = false;

        for (const [key, trackedVal] of Object.entries(remoteSettings)) {
          if (trackedVal && typeof trackedVal === 'object' && 'value' in trackedVal) {
            if (key === 'trackedCourseIds') {
              foundTrackedCourses = true;
              const idsArray = Array.isArray(trackedVal.value) ? trackedVal.value : [];
              const ids = idsArray.map(Number);
              setTrackedCourseIdsState(ids);
              await setTrackedCourseIds(ids, true);
            } else if (key === 'googleTasksEnabled' || key === 'googleClientId') {
              // Keep local Google Tasks toggle if already enabled locally
              if (key === 'googleTasksEnabled' && updatedSettings.googleTasksEnabled) continue;
              (updatedSettings as any)[key] = trackedVal.value;
            } else {
              (updatedSettings as any)[key] = trackedVal.value;
            }
          }
        }

        setSettingsState(updatedSettings);
        await setSettings(updatedSettings, true);

        // Persist the remote timestamps so future syncs don't think local is newer
        const remoteTimestamps: Record<string, number> = {};
        for (const [key, trackedVal] of Object.entries(remoteSettings)) {
          if (trackedVal && typeof trackedVal === 'object' && 'updatedAt' in trackedVal) {
            remoteTimestamps[key] = (trackedVal as any).updatedAt;
          }
        }
        await browser.storage.sync.set({ settings_timestamps: remoteTimestamps });

        if (foundTrackedCourses) {
          // Successfully restored, jump straight to dashboard
          setOnboardingStep(3);

          // Also fetch their courses in background so they have names immediately
          fetchEnrolledCoursesInBackground(t);

          // Run initial sync
          const res = await syncNowOnBackground();
          if (res?.success && res.result) {
            setSyncResult(res.result);
          }
          return; // Skip normal onboarding
        }
      }

      // If no remote settings found, or no tracked courses, proceed to normal onboarding step 2
      await fetchEnrolledCoursesForOnboarding(t);
    } catch (e) {
      console.error('[Onboarding] Error restoring settings:', e);
      await fetchEnrolledCoursesForOnboarding(t); // Fallback
    } finally {
      setValidatingToken(false);
    }
  }

  async function fetchEnrolledCoursesForOnboarding(t: string) {
    setValidatingToken(true);
    try {
      const res = await fetchEnrolledCoursesOnBackground(t);
      console.log('[Onboarding] fetchEnrolledCoursesOnBackground response:', res);
      if (res?.success && res.courses && res.courses.length > 0) {
        setAvailableCourses(res.courses);
        await browser.storage.local.set({ enrolledCoursesCache: res.courses });
        setOnboardingStep((prev) => (prev === 3 ? 3 : 2));
      } else if (res?.success && res.courses && res.courses.length === 0) {
        console.warn('[Onboarding] Enrolled courses array is empty');
        showToast(currentLang === 'he' ? 'לא נמצאו קורסים מקושרים לחשבון' : 'No enrolled courses found for account', 'info');
        setAvailableCourses([]);
        setOnboardingStep((prev) => (prev === 3 ? 3 : 2));
      } else {
        const isAuthError = res?.errorcode === 'AUTH_SESSION_EXPIRED' || res?.errorcode === 'invalidtoken';
        setOnboardingStep((prev) => {
          if (availableCourses.length > 0 || prev === 2) {
            if (isAuthError) {
              showToast(res?.error || 'Session expired. Please log in again.', 'error');
              return 1;
            }
            console.warn('[Onboarding] Background fetch reported error but courses already present:', res?.error);
            return prev;
          } else {
            showToast(res?.error || 'Failed to fetch enrolled courses.', 'error');
            return 1; // Fallback to login if we can't load courses initially
          }
        });
      }
    } catch (e: any) {
      const isAuthError = e?.errorcode === 'AUTH_SESSION_EXPIRED' || e?.errorcode === 'invalidtoken';
      setOnboardingStep((prev) => {
        if (availableCourses.length > 0 || prev === 2) {
          if (isAuthError) {
            showToast(e?.message || 'Session expired. Please log in again.', 'error');
            return 1;
          }
          console.warn('[Onboarding] Background fetch exception but courses already present:', e?.message || e);
          return prev;
        } else {
          showToast(e?.message || 'Failed to fetch enrolled courses', 'error');
          return 1;
        }
      });
    } finally {
      setValidatingToken(false);
    }
  }



  async function handleConfirmHideLabAssignments(courseId: number) {
    setPendingLabHideCourseIds((prev) => Array.from(new Set([...prev, courseId])));
    if (syncResult?.assignments) {
      const courseAssignIds = syncResult.assignments
        .filter((a) => a.courseId === courseId)
        .map((a) => a.id);
      if (courseAssignIds.length > 0 && settings) {
        const currentHidden = new Set(settings.hiddenAssignments || []);
        courseAssignIds.forEach((id) => currentHidden.add(id));
        const updated = { ...settings, hiddenAssignments: Array.from(currentHidden) };
        setSettingsState(updated);
        await setSettings(updated);
        if (updated.googleTasksEnabled) {
          syncGoogleTasksOnBackground(false).catch(() => { });
        }
      }
    }
    showToast(t('lab_assignments_hidden_toast'), 'success');
  }

  async function handleOnboardingCourseToggle(courseId: number) {
    if (trackedCourseIds.includes(courseId)) {
      setTrackedCourseIdsState(trackedCourseIds.filter((id) => id !== courseId));
    } else {
      setTrackedCourseIdsState([...trackedCourseIds, courseId]);
      const course = availableCourses.find((c) => c.id === courseId);
      if (course && ((course.fullname && course.fullname.includes('מעבדה')) || (course.shortname && course.shortname.includes('מעבדה')))) {
        setLabModalCourse({
          id: courseId,
          name: course.fullname || course.shortname || `Course ${courseId}`,
        });
      }
    }
  }

  async function handleSaveOnboardingCourses() {
    setLoading(true);
    try {
      const expandedIds = expandTrackedCourseIds(trackedCourseIds, groupedCoursesResult);
      setTrackedCourseIdsState(expandedIds);
      await setTrackedCourseIds(expandedIds);
      setOnboardingStep(3);
      // Run initial sync
      const res = await syncNowOnBackground();
      if (res?.success && res.result) {
        setSyncResult(res.result);
        if (pendingLabHideCourseIds.length > 0 && settings) {
          const assignsToHide = res.result.assignments
            .filter((a) => pendingLabHideCourseIds.includes(a.courseId))
            .map((a) => a.id);
          if (assignsToHide.length > 0) {
            const currentHidden = new Set(settings.hiddenAssignments || []);
            assignsToHide.forEach((id) => currentHidden.add(id));
            const updated = { ...settings, hiddenAssignments: Array.from(currentHidden) };
            setSettingsState(updated);
            await setSettings(updated);
          }
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleManualSync() {
    setLoading(true);
    setShowSyncWindow(true);
    setIsSyncWindowCollapsed(false);
    setSyncError(null);
    try {
      const res = await syncNowOnBackground();
      if (res?.success && res.result) {
        setSyncResult(res.result);
        if (settings?.googleTasksEnabled && (res.result as any).googleSyncError) {
          showToast(t('google_tasks_auth_warning_title'), 'error');
          setGoogleTasksAuthError((res.result as any).googleSyncError);
        }
      } else if (res && !res.success) {
        setSyncError(res.error || 'Sync failed');
        showToast(`Sync failed: ${res.error}`, 'error');
      }
      setTimeout(() => {
      }, 500);
    } catch (e: any) {
      setSyncError(e?.message || 'Sync failed');
      showToast(`Sync failed: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnectClick() {
    setDeletePermanently(false);
    setShowDisconnectModal(true);
  }

  async function confirmDisconnect() {
    setLoading(true);
    setShowDisconnectModal(false);
    try {
      // clearUserSession() in the service worker handles:
      //   • Clearing all TAU/Moodle SSO cookies (so next login is always a fresh challenge)
      //   • Removing wstoken, moodleCredentials, cachedSyncResult, enrolledCoursesCache,
      //     googleAccessToken, googleTokenExpiry, and all notified_* keys from local storage
      //   • Removing trackedCourseIds from sync storage
      await logoutOnBackground();

      // Handle config_backup separately (UI-layer concern not owned by the service worker)
      if (deletePermanently) {
        await browser.storage.local.remove('config_backup');
      } else {
        // Strip the token from the backup so restoring it later doesn't auto-login
        const backupRes = (await browser.storage.local.get('config_backup')) as { config_backup?: any };
        if (backupRes.config_backup) {
          const updatedBackup = { ...backupRes.config_backup };
          delete updatedBackup.wstoken;
          await browser.storage.local.set({ config_backup: updatedBackup });
        }
      }

      // Reset ALL user-specific React state so the UI reflects a clean slate immediately
      setToken(null);
      setTrackedCourseIdsState([]);
      setSyncResult(null);
      setCachedCourseStaff({});
      autoFetchedStaffCourseIdsRef.current.clear();
      setAvailableCourses([]);
      setMoodleUsername('');
      setMoodleId('');
      setMoodlePassword('');
      setLocalFsConfigState(DEFAULT_LOCAL_FS_CONFIG);
      setLocalFsStatusState(DEFAULT_LOCAL_FS_STATUS);
      setLocalFsManifestState({ files: {}, courseFolderNames: {} });
      setMissingLocalFileIds(new Set());
      setOnboardingStep(1);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function handleExportConfig() {
    if (!token || !settings) {
      showToast('No configuration found to export.', 'error');
      return;
    }
    const config = {
      version: "TauTrackerConfig-v1",
      trackedCourseIds: trackedCourseIds,
      settings: settings,
      zoomLinks: settings.interestedMeetings || [],
      hiddenZoomMeetings: settings.hiddenZoomMeetings || []
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tau_tracker_config_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportConfig(file: File) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        const data = JSON.parse(text);
        if (data.version !== "TauTrackerConfig-v1" || !data.trackedCourseIds || !data.settings) {
          throw new Error('Invalid file format');
        }

        setLoading(true);
        // We do NOT overwrite the wstoken during manual config import since the user is already signed in.
        await setTrackedCourseIds(data.trackedCourseIds);

        if (data.zoomLinks && Array.isArray(data.zoomLinks)) {
          data.settings.interestedMeetings = Array.from(new Set([
            ...(data.settings.interestedMeetings || []),
            ...data.zoomLinks
          ]));
        }
        if (data.hiddenZoomMeetings && Array.isArray(data.hiddenZoomMeetings)) {
          data.settings.hiddenZoomMeetings = Array.from(new Set([
            ...(data.settings.hiddenZoomMeetings || []),
            ...data.hiddenZoomMeetings
          ]));
        }

        await setSettings(data.settings);

        setTrackedCourseIdsState(data.trackedCourseIds);
        setSettingsState(data.settings);

        const syncRes = await syncNowOnBackground();
        if (syncRes && syncRes.success && syncRes.result) {
          setSyncResult(syncRes.result);
        }

        showToast(t('import_success'), 'success');
        loadData();
      } catch (err: any) {
        showToast(`${t('import_failed')}: ${err.message}`, 'error');
      } finally {
        setLoading(false);
      }
    };
    reader.readAsText(file);
  }
  async function handleToggleGoogleTasks(enabled: boolean) {
    if (!settings) return;
    const updated = { ...settings, googleTasksEnabled: enabled };
    setSettingsState(updated);
    await setSettings({ googleTasksEnabled: enabled });
    if (enabled) {
      handleSyncGoogleTasks();
    }
  }

  async function handleUpdateGoogleListName(name: string) {
    if (!settings) return;
    const updated = { ...settings, googleTasksListName: name };
    setSettingsState(updated);
    await setSettings(updated);
  }

  async function handleToggleMeetingInterest(targetMeetingKey: string, _allMeetingKeys: string[]) {
    if (!settings) return;
    const currentHidden = settings.hiddenZoomMeetings || [];
    let updatedHidden: string[];
    if (currentHidden.includes(targetMeetingKey)) {
      // Unhide meeting (make visible)
      updatedHidden = currentHidden.filter((key) => key !== targetMeetingKey);
    } else {
      // Hide meeting
      updatedHidden = [...currentHidden, targetMeetingKey];
    }
    const updated = { ...settings, hiddenZoomMeetings: updatedHidden };
    setSettingsState(updated);
    await setSettings(updated);
  }

  async function handleSetCourseMeetingsVisibility(courseMeetings: ZoomMeeting[], makeVisible: boolean) {
    if (!settings) return;
    const courseKeys = courseMeetings.map((m) => getZoomMeetingKey(m));
    const courseKeySet = new Set(courseKeys);
    const currentHidden = settings.hiddenZoomMeetings || [];

    let updatedHidden: string[];
    if (makeVisible) {
      // Remove all course meetings from hiddenZoomMeetings
      updatedHidden = currentHidden.filter((key) => !courseKeySet.has(key));
    } else {
      // Add all course meetings to hiddenZoomMeetings
      updatedHidden = Array.from(new Set([...currentHidden, ...courseKeys]));
    }

    const updated = { ...settings, hiddenZoomMeetings: updatedHidden };
    setSettingsState(updated);
    await setSettings(updated);
  }



  async function handleSyncGoogleTasks() {
    setGoogleSyncLoading(true);
    setGoogleSyncStatus('Connecting to Google...');
    try {
      const res = await syncGoogleTasksOnBackground(true); // Interactive login allowed
      if (res.success) {
        setGoogleSyncStatus(res.status || 'Tasks synchronized successfully.');
        setGoogleTasksAuthError(null);
        setHasGoogleTasksToken(true);
        showToast(t('google_tasks_status_connected'), 'success');
      } else {
        const errMsg = res.error || 'Authentication failed';
        setGoogleSyncStatus(`Google Sync failed: ${errMsg}`);
        setGoogleTasksAuthError(errMsg);
        showToast(`Google Sync failed: ${errMsg}`, 'error');
      }
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      setGoogleSyncStatus(`Google Sync failed: ${errMsg}`);
      setGoogleTasksAuthError(errMsg);
      showToast(`Google Sync failed: ${errMsg}`, 'error');
    } finally {
      setGoogleSyncLoading(false);
      setTimeout(() => setGoogleSyncStatus(null), 8000);
    }
  }

  // Course customization helpers
  async function handleUpdateCourseColor(courseId: number, color: string) {
    if (!settings) return;
    const updatedMap = { ...settings.coursesColorMap, [courseId]: color };
    const updated = { ...settings, coursesColorMap: updatedMap };
    setSettingsState(updated);
    await setSettings(updated);
  }

  async function handleUpdateCourseCustomName(courseId: number, customName: string) {
    if (!settings) return;
    const updatedMap = { ...settings.coursesCustomNames, [courseId]: customName };
    const updated = { ...settings, coursesCustomNames: updatedMap };
    setSettingsState(updated);
    await setSettings(updated);
  }

  async function handleUpdateCoursePanopto(courseId: number, panoptoValue: string, triggerSync = false) {
    if (!settings) return;
    const updatedMap = { ...(settings.coursesPanoptoMap || {}), [courseId]: panoptoValue.trim() };
    if (!panoptoValue.trim()) {
      delete updatedMap[courseId];
    }
    const updated = { ...settings, coursesPanoptoMap: updatedMap };
    setSettingsState(updated);
    await setSettings(updated);
    if (triggerSync) {
      handleManualSync();
    }
  }

  function buildCourseAliasMap(): Map<number, number[]> {
    const aliases = new Map<number, number[]>();
    for (const u of groupedCoursesResult.academicCourses) {
      const memberIds = u.subCourses.map((s) => s.courseId);
      if (memberIds.length > 1) {
        for (const id of memberIds) {
          aliases.set(id, memberIds);
        }
      }
    }
    return aliases;
  }

  async function handleUpdateCoursePanoptoStaff(courseId: number, entries: CoursePanoptoStaffEntry[]) {
    if (!settings) return;
    const nextStaffMap: Record<number, CoursePanoptoStaffEntry[]> = {
      ...(settings.coursesPanoptoStaff || {}),
    };
    if (entries.length === 0) {
      delete nextStaffMap[courseId];
    } else {
      nextStaffMap[courseId] = entries;
    }
    const updated = { ...settings, coursesPanoptoStaff: nextStaffMap };
    setSettingsState(updated);
    await setSettings({ coursesPanoptoStaff: nextStaffMap });

    if (syncResult?.recordings && syncResult.recordings.length > 0) {
      const aliasMap = buildCourseAliasMap();
      const reclassified = reclassifyPanoptoRecordings(
        syncResult.recordings,
        nextStaffMap,
        syncResult.courseStaff,
        aliasMap
      );
      const updatedSync: SyncResult = { ...syncResult, recordings: reclassified };
      setSyncResult(updatedSync);
      await setCachedSyncResult(updatedSync);
    }
  }

  async function handleImportCourseStaff(courseId: number, forceRefresh = false): Promise<CourseStaffMember[]> {
    const unified = groupedCoursesResult.academicCourses.find(
      (u) => u.id === courseId || u.subCourses.some((s) => s.courseId === courseId)
    );
    const targetIds = unified
      ? Array.from(new Set(unified.subCourses.map((s) => s.courseId)))
      : [courseId];

    const courseBaseUrls: Record<number, string> = {};
    for (const id of targetIds) {
      const found = availableCourses.find((c) => c.id === id);
      const courseBase =
        found?.instanceUrl ||
        (found?.year && found.year !== String(new Date().getFullYear())
          ? `https://moodle.tau.ac.il/${found.year}`
          : undefined) ||
        found?.url;
      if (courseBase) {
        courseBaseUrls[id] = courseBase;
      }
    }

    const res = await fetchCourseStaffOnBackground(targetIds, courseBaseUrls, forceRefresh);
    if (!res?.success || !res.byCourseId) {
      if (res?.error) {
        showToast(res.error, 'error');
      }
      return [];
    }

    const combined: CourseStaffMember[] = [];
    const seen = new Set<string>();
    for (const id of targetIds) {
      for (const member of res.byCourseId[id] || []) {
        const key = normalizePersonName(member.fullName);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        combined.push(member);
      }
    }

    if (Object.keys(res.byCourseId).length > 0) {
      setCachedCourseStaff((prev) => ({ ...prev, ...res.byCourseId }));
      await mergeCachedCourseStaff(res.byCourseId);
      if (syncResult) {
        const updatedSync: SyncResult = {
          ...syncResult,
          courseStaff: { ...(syncResult.courseStaff || {}), ...res.byCourseId },
        };
        setSyncResult(updatedSync);
        await setCachedSyncResult(updatedSync);
      }
    }

    return combined;
  }

  async function handleToggleTrackHost(
    courseId: number,
    hostName: string,
    recordingType: PanoptoRecordingType
  ) {
    if (!settings) return;
    const existingEntries =
      settings.coursesPanoptoStaff?.[courseId] ||
      (settings.coursesPanoptoStaff as Record<string, CoursePanoptoStaffEntry[]> | undefined)?.[String(courseId)] ||
      [];
    const moodleStaff =
      mergedSyncView?.courseStaff?.[courseId] ||
      cachedCourseStaff[courseId] ||
      syncResult?.courseStaff?.[courseId];
    const nextEntries = toggleTrackedHostEntry(existingEntries, hostName, recordingType, moodleStaff);
    await handleUpdateCoursePanoptoStaff(courseId, nextEntries);
  }

  // One-time automatic Moodle staff population when Manage Courses opens (for courses not yet cached in local storage)
  useEffect(() => {
    if (!isManageModalOpen || !settings?.panoptoEnabled || !token) return;

    const candidateParents = groupedCoursesResult.academicCourses.filter((u) =>
      u.subCourses.some((s) => trackedCourseIds.includes(s.courseId)) || trackedCourseIds.includes(u.id)
    );
    const parentIdsToFetch: number[] = [];
    const allSubIdsToFetch: number[] = [];
    const baseUrls: Record<number, string> = {};

    for (const u of candidateParents) {
      if (autoFetchedStaffCourseIdsRef.current.has(u.id)) continue;
      const memberIds = Array.from(new Set(u.subCourses.map((s) => s.courseId)));
      const alreadyCached = memberIds.some((mid) => {
        const list = cachedCourseStaff[mid] || syncResult?.courseStaff?.[mid];
        return Array.isArray(list) && list.length > 0;
      });
      if (alreadyCached) {
        autoFetchedStaffCourseIdsRef.current.add(u.id);
        continue;
      }
      autoFetchedStaffCourseIdsRef.current.add(u.id);
      parentIdsToFetch.push(u.id);
      for (const mid of memberIds) {
        allSubIdsToFetch.push(mid);
        const found = availableCourses.find((c) => c.id === mid);
        const courseBase =
          found?.instanceUrl ||
          (found?.year && found.year !== String(new Date().getFullYear())
            ? `https://moodle.tau.ac.il/${found.year}`
            : undefined) ||
          found?.url;
        if (courseBase) {
          baseUrls[mid] = courseBase;
        }
      }
    }

    if (allSubIdsToFetch.length === 0) return;

    let cancelled = false;
    setLoadingStaffCourseIds((prev) => {
      const next = new Set(prev);
      parentIdsToFetch.forEach((id) => next.add(id));
      return next;
    });

    void fetchCourseStaffOnBackground(allSubIdsToFetch, baseUrls, false)
      .then(async (res) => {
        if (cancelled) return;
        if (res?.success && res.byCourseId && Object.keys(res.byCourseId).length > 0) {
          setCachedCourseStaff((prev) => ({ ...prev, ...res.byCourseId }));
          await mergeCachedCourseStaff(res.byCourseId);
        }
      })
      .catch(() => { })
      .finally(() => {
        if (cancelled) return;
        setLoadingStaffCourseIds((prev) => {
          const next = new Set(prev);
          parentIdsToFetch.forEach((id) => next.delete(id));
          return next;
        });
      });

    return () => {
      cancelled = true;
    };
  }, [isManageModalOpen, settings?.panoptoEnabled, token, groupedCoursesResult, trackedCourseIds, cachedCourseStaff, syncResult?.courseStaff, availableCourses]);

  async function handleToggleRecordingWatched(recordingId: string) {
    if (!settings || !recordingId) return;
    const currentWatched = settings.watchedRecordings || [];
    const updatedWatched = currentWatched.includes(recordingId)
      ? currentWatched.filter((id) => id !== recordingId)
      : [...currentWatched, recordingId];
    const updated = { ...settings, watchedRecordings: updatedWatched };
    setSettingsState(updated);
    await setSettings(updated);
  }

  async function handleToggleRecordingHidden(recordingId: string) {
    if (!settings || !recordingId) return;
    const currentHidden = settings.hiddenRecordings || [];
    const updatedHidden = currentHidden.includes(recordingId)
      ? currentHidden.filter((id) => id !== recordingId)
      : [...currentHidden, recordingId];
    const updated = { ...settings, hiddenRecordings: updatedHidden };
    setSettingsState(updated);
    await setSettings(updated);
  }

  async function handleToggleCompleted(assignmentId: number | string) {
    if (!settings) return;
    const rawAssignments = (mergedSyncView || syncResult)?.assignments || [];
    const assign = rawAssignments.find(
      (x) => matchesActivityIdentifier(assignmentId, x) || x.uid === assignmentId || getActivityUid(x) === String(assignmentId) || x.id === assignmentId || x.id === Number(assignmentId)
    );
    const targetKey = assign ? getActivityUid(assign) : String(assignmentId);
    const isMoodleSubmitted = assign ? isMoodleActivitySubmitted(assign) : false;

    const currentCompleted = settings.completedAssignments || [];
    const currentUncompleted = settings.uncompletedAssignments || [];

    const isCurrentlyCompleted = isActivityCompleted(
      assign || { id: Number(assignmentId), status: 'Not submitted' },
      currentCompleted,
      currentUncompleted
    );

    let updatedCompleted = currentCompleted.filter(
      (id) => !matchesActivityIdentifier(id, assign || { id: Number(assignmentId) })
    );
    let updatedUncompleted = currentUncompleted.filter(
      (id) => !matchesActivityIdentifier(id, assign || { id: Number(assignmentId) })
    );

    const willBeCompleted = !isCurrentlyCompleted;
    if (willBeCompleted) {
      if (!isMoodleSubmitted) {
        updatedCompleted.push(targetKey);
      }
    } else {
      if (isMoodleSubmitted) {
        updatedUncompleted.push(targetKey);
      }
    }

    const updated = {
      ...settings,
      completedAssignments: updatedCompleted,
      uncompletedAssignments: updatedUncompleted,
    };
    setSettingsState(updated);
    await setSettings(updated);

    if (assign && assign.requiresManualCompletion && token) {
      try {
        const instanceBaseUrl = assign.link ? new URL(assign.link).origin : undefined;
        const client = new MoodleClient(token, instanceBaseUrl);
        client.updateActivityCompletionManually(assign.cmid, willBeCompleted).catch(() => { });
      } catch { }
    }
    if (updated.googleTasksEnabled) {
      syncGoogleTasksOnBackground(false).catch(() => { });
    }
  }

  async function handleToggleHidden(assignmentId: number | string) {
    if (!settings) return;
    const rawAssignments = (mergedSyncView || syncResult)?.assignments || [];
    const assign = rawAssignments.find(
      (x) => matchesActivityIdentifier(assignmentId, x) || x.uid === assignmentId || getActivityUid(x) === String(assignmentId) || x.id === assignmentId || x.id === Number(assignmentId)
    );
    const targetKey = assign ? getActivityUid(assign) : String(assignmentId);
    const currentHidden = settings.hiddenAssignments || [];

    const isCurrentlyHidden = isActivityHidden(
      assign || { id: Number(assignmentId) },
      currentHidden
    );

    let updatedHidden = currentHidden.filter(
      (id) => !matchesActivityIdentifier(id, assign || { id: Number(assignmentId) })
    );
    if (!isCurrentlyHidden) {
      updatedHidden.push(targetKey);
    }

    const updated = { ...settings, hiddenAssignments: updatedHidden };
    setSettingsState(updated);
    await setSettings(updated);
    if (updated.googleTasksEnabled) {
      syncGoogleTasksOnBackground(false).catch(() => { });
    }
  }

  async function handleToggleHideAllCourse(courseAssignIds: number[], shouldHideAll: boolean) {
    if (!settings) return;
    const currentHidden = new Set(settings.hiddenAssignments || []);
    if (shouldHideAll) {
      courseAssignIds.forEach((id) => currentHidden.add(id));
    } else {
      courseAssignIds.forEach((id) => currentHidden.delete(id));
    }
    const updated = { ...settings, hiddenAssignments: Array.from(currentHidden) };
    setSettingsState(updated);
    await setSettings(updated);
    if (updated.googleTasksEnabled) {
      syncGoogleTasksOnBackground(false).catch(() => { });
    }
  }

  async function handleAddMockCourse() {
    const mockCourseId = 9999;
    const mockCourseName = '0368-2161 מבני נתונים (קורס לדוגמה)';
    const mockColor = '#8b5cf6';
    const mockCustomName = 'מבני נתונים 📚';
    const nowTime = Date.now();

    const mockMeetings: ZoomMeeting[] = [
      {
        courseId: mockCourseId,
        courseName: mockCourseName,
        title: "הרצאה שבועית - פרופ' כהן (פעיל עכשיו)",
        startTime: new Date(nowTime - 15 * 60 * 1000).toISOString(),
        meetingUrl: 'https://tau-ac-il.zoom.us/j/9999001',
        meetingNumber: '9999001',
        sectionName: 'כללי',
      },
      {
        courseId: mockCourseId,
        courseName: mockCourseName,
        title: 'תרגול 4 - עצים בינאריים ו-AVL',
        startTime: new Date(nowTime + 24 * 60 * 60 * 1000).toISOString(),
        meetingUrl: 'https://tau-ac-il.zoom.us/j/9999002',
        meetingNumber: '9999002',
        sectionName: 'שבוע 4: עצים מאוזנים',
      },
      {
        courseId: mockCourseId,
        courseName: mockCourseName,
        title: 'שעת קבלה - מתרגל דני',
        startTime: new Date(nowTime + 5 * 24 * 60 * 60 * 1000).toISOString(),
        meetingUrl: 'https://tau-ac-il.zoom.us/j/9999003',
        meetingNumber: '9999003',
        sectionName: 'כללי',
      },
    ];

    const mockAssignments: Assignment[] = [
      {
        id: 999901,
        cmid: 999901,
        courseId: mockCourseId,
        courseName: mockCourseName,
        name: 'מטלה 3: עצי AVL וטבלאות גיבוב',
        sectionName: 'שבוע 4: עצים מאוזנים',
        deadline: new Date(nowTime + 2 * 24 * 3600 * 1000).toISOString(),
        opened: new Date(nowTime - 7 * 24 * 3600 * 1000).toISOString(),
        status: 'Assigned',
        grade: null,
        gradeMax: 100,
        link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=999901',
        attachments: [
          { name: 'hw3_avl_trees.pdf', url: 'https://moodle.tau.ac.il/sample_hw3.pdf' },
          { name: 'template.zip', url: 'https://moodle.tau.ac.il/template.zip' },
        ],
        submittedFiles: [],
      },
      {
        id: 999902,
        cmid: 999902,
        courseId: mockCourseId,
        courseName: mockCourseName,
        name: 'מטלה 4: גרפים וחיפוש לעומק/לרוחב',
        sectionName: 'שבוע 5: אלגוריתמי גרפים',
        deadline: new Date(nowTime + 9 * 24 * 3600 * 1000).toISOString(),
        opened: new Date(nowTime - 3 * 24 * 3600 * 1000).toISOString(),
        status: 'Assigned',
        grade: null,
        gradeMax: 100,
        link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=999902',
        attachments: [
          { name: 'hw4_graphs.pdf', url: 'https://moodle.tau.ac.il/hw4.pdf' },
        ],
        submittedFiles: [],
      },
      {
        id: 999903,
        cmid: 999903,
        courseId: mockCourseId,
        courseName: mockCourseName,
        name: 'פרויקט אמצע סמסטר: מימוש מנוע חיפוש פנימי',
        sectionName: 'פרויקט סמסטריאלי',
        deadline: null,
        opened: new Date(nowTime - 14 * 24 * 3600 * 1000).toISOString(),
        status: 'Assigned',
        grade: null,
        gradeMax: 100,
        link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=999903',
        attachments: [
          { name: 'project_spec.pdf', url: 'https://moodle.tau.ac.il/project_spec.pdf' },
        ],
        submittedFiles: [],
      },
      {
        id: 999904,
        cmid: 999904,
        courseId: mockCourseId,
        courseName: mockCourseName,
        name: 'מטלה 2: תורים וערימות בינאריות',
        sectionName: 'שבוע 3: ערימות',
        deadline: new Date(nowTime - 3 * 24 * 3600 * 1000).toISOString(),
        opened: new Date(nowTime - 17 * 24 * 3600 * 1000).toISOString(),
        status: 'Submitted',
        grade: 96,
        gradeMax: 100,
        link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=999904',
        attachments: [
          { name: 'hw2_heaps.pdf', url: 'https://moodle.tau.ac.il/hw2_heaps.pdf' },
        ],
        submittedFiles: [
          { name: 'solution_312345678.pdf', url: 'https://moodle.tau.ac.il/submission_2.pdf' },
          { name: 'code.py', url: 'https://moodle.tau.ac.il/code.py' },
        ],
      },
      {
        id: 999905,
        cmid: 999905,
        courseId: mockCourseId,
        courseName: mockCourseName,
        name: 'מטלה 1: ניתוח סיבוכיות ואסימפטוטיקה',
        sectionName: 'שבוע 1: מבוא',
        deadline: new Date(nowTime - 14 * 24 * 3600 * 1000).toISOString(),
        opened: new Date(nowTime - 28 * 24 * 3600 * 1000).toISOString(),
        status: 'Assigned',
        grade: null,
        gradeMax: 100,
        link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=999905',
        attachments: [],
        submittedFiles: [],
      },
    ];

    const mockFiles: CourseFile[] = [
      {
        fileName: 'lecture4_avl_trees_slides.pdf',
        fileUrl: 'https://moodle.tau.ac.il/lecture4_slides.pdf',
        fileSize: 2400000,
        mimeType: 'application/pdf',
        sectionName: 'שבוע 4: עצים מאוזנים',
        timeModified: Math.floor(nowTime / 1000),
        courseId: mockCourseId,
        courseName: mockCourseName,
      },
      {
        fileName: 'tutorial4_avl_rotations.pdf',
        fileUrl: 'https://moodle.tau.ac.il/tutorial4.pdf',
        fileSize: 1100000,
        mimeType: 'application/pdf',
        sectionName: 'שבוע 4: עצים מאוזנים',
        timeModified: Math.floor(nowTime / 1000),
        courseId: mockCourseId,
        courseName: mockCourseName,
      },
      {
        fileName: 'graphs_bfs_dfs_notes.pdf',
        fileUrl: 'https://moodle.tau.ac.il/graphs.pdf',
        fileSize: 3500000,
        mimeType: 'application/pdf',
        sectionName: 'שבוע 5: אלגוריתמי גרפים',
        timeModified: Math.floor(nowTime / 1000),
        courseId: mockCourseId,
        courseName: mockCourseName,
      },
      {
        fileName: 'syllabus_2026.pdf',
        fileUrl: 'https://moodle.tau.ac.il/syllabus.pdf',
        fileSize: 520000,
        mimeType: 'application/pdf',
        sectionName: 'סילבוס וחומר עזר',
        timeModified: Math.floor(nowTime / 1000),
        courseId: mockCourseId,
        courseName: mockCourseName,
      },
    ];

    const mockRecordings: PanoptoRecording[] = [
      {
        id: 'mock-panopto-lec-4',
        title: 'הרצאה 4 - עצי חיפוש מאוזנים (AVL)',
        recordingUrl: 'https://tau.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=05c6571f-fd73-4f88-a06c-b3ff00a6d491',
        publishedDate: new Date(nowTime - 3 * 24 * 3600 * 1000).toISOString().slice(0, 10),
        type: 'Lecture',
        courseId: mockCourseId,
        courseName: mockCourseName,
        sectionName: 'שבוע 4: עצים מאוזנים',
        durationSeconds: 5400,
      },
      {
        id: 'mock-panopto-rec-4',
        title: 'תרגול 4 - סיבובי AVL ואיזון עצים',
        recordingUrl: 'https://tau.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=15c6571f-fd73-4f88-a06c-b3ff00a6d492',
        publishedDate: new Date(nowTime - 2 * 24 * 3600 * 1000).toISOString().slice(0, 10),
        type: 'Recitation',
        courseId: mockCourseId,
        courseName: mockCourseName,
        sectionName: 'שבוע 4: עצים מאוזנים',
        durationSeconds: 3600,
      },
      {
        id: 'mock-panopto-lec-5',
        title: 'הרצאה 5 - אלגוריתמי גרפים (BFS & DFS)',
        recordingUrl: 'https://tau.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=25c6571f-fd73-4f88-a06c-b3ff00a6d493',
        publishedDate: new Date(nowTime - 1 * 24 * 3600 * 1000).toISOString().slice(0, 10),
        type: 'Lecture',
        courseId: mockCourseId,
        courseName: mockCourseName,
        sectionName: 'שבוע 5: אלגוריתמי גרפים',
        durationSeconds: 5200,
      },
    ];

    const newTracked = Array.from(new Set([...trackedCourseIds, mockCourseId]));
    setTrackedCourseIdsState(newTracked);
    await setTrackedCourseIds(newTracked, true);

    const updatedSettings = {
      ...(settings || DEFAULT_SETTINGS),
      panoptoEnabled: true,
      coursesColorMap: { ...(settings?.coursesColorMap || {}), [mockCourseId]: mockColor },
      coursesCustomNames: { ...(settings?.coursesCustomNames || {}), [mockCourseId]: mockCustomName },
    };
    setSettingsState(updatedSettings);
    await setSettings(updatedSettings);

    const existingAssigns = (syncResult?.assignments || []).filter((a) => a.courseId !== mockCourseId);
    const existingMeetings = (syncResult?.meetings || []).filter((m) => m.courseId !== mockCourseId);
    const existingFiles = (syncResult?.files || []).filter((f) => f.courseId !== mockCourseId);
    const existingRecordings = (syncResult?.recordings || []).filter((r) => r.courseId !== mockCourseId);

    const newSyncResult: SyncResult = {
      syncedAt: new Date().toISOString(),
      assignments: [...mockAssignments, ...existingAssigns],
      meetings: [...mockMeetings, ...existingMeetings],
      files: [...mockFiles, ...existingFiles],
      recordings: [...mockRecordings, ...existingRecordings],
      errors: syncResult?.errors || [],
    };
    setSyncResult(newSyncResult);
    await setCachedSyncResult(newSyncResult);

    showToast(t('mock_course_added'), 'success');
  }

  const getCourseColor = (courseId: number) => {
    return settings?.coursesColorMap[courseId] || '#e07a5f';
  };

  const getCourseDisplayName = (courseId: number, defaultName: string) => {
    return settings?.coursesCustomNames[courseId] || defaultName;
  };

  const currentLang = settings?.language || 'he';
  const t = (key: keyof typeof translations['en']) => {
    return (translations[currentLang] as any)?.[key] || translations['en']?.[key] || key;
  };

  if (loading && onboardingStep === 1) {
    return (
      <div className="center-container" dir={currentLang === 'he' ? 'rtl' : 'ltr'}>
        <div className="spinner"></div>
        <p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>Loading Noodle...</p>
      </div>
    );
  }

  if (onboardingStep === 1) {
    return (
      <div className="onboarding-container" dir={currentLang === 'he' ? 'rtl' : 'ltr'}>
        <div className="onboarding-card glass-panel" style={{ position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem', position: 'absolute', top: '1rem', right: currentLang === 'he' ? 'auto' : '1rem', left: currentLang === 'he' ? '1rem' : 'auto' }}>
            <select
              value={currentLang}
              onChange={async (e) => {
                const newLang = e.target.value as 'he' | 'en';
                const updated = { ...(settings || DEFAULT_SETTINGS), language: newLang };
                setSettingsState(updated);
                await setSettings(updated);
              }}
              className="settings-select"
              style={{
                padding: '0.3rem 0.6rem',
                fontSize: '0.85rem',
                background: 'rgba(0,0,0,0.4)',
                color: 'white',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer'
              }}
            >
              <option value="he" style={{ background: '#1e1b18', color: 'white' }}>עברית</option>
              <option value="en" style={{ background: '#1e1b18', color: 'white' }}>English</option>
            </select>
          </div>

          <div className="logo-section">
            <img src={logoImg} alt="Noodle Logo" className="logo-image-large" />
            <h1>Noodle</h1>
            <p className="subtitle">{t('moodle_credentials_title')}</p>
          </div>

          <div className="form-section" style={{ textAlign: 'center', marginTop: '2rem' }}>
            <form onSubmit={handleMoodleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center', maxWidth: '300px', margin: '0 auto' }}>
              <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                {t('moodle_credentials_desc')}
              </p>
              <input
                type="text"
                placeholder={t('username_placeholder')}
                value={moodleUsername}
                onChange={(e) => setMoodleUsername(e.target.value)}
                className="noodle-input"
                style={{ width: '100%' }}
                required
              />
              <input
                type="text"
                placeholder={t('id_placeholder')}
                value={moodleId}
                onChange={(e) => setMoodleId(e.target.value)}
                className="noodle-input"
                style={{ width: '100%' }}
                required
              />
              <input
                type="password"
                placeholder={t('password_placeholder')}
                value={moodlePassword}
                onChange={(e) => setMoodlePassword(e.target.value)}
                className="noodle-input"
                style={{ width: '100%' }}
                required
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', justifyContent: 'flex-start', margin: '0.2rem 0' }}>
                <input
                  type="checkbox"
                  id="remember-me"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <label htmlFor="remember-me" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
                  {t('remember_me')}
                </label>
              </div>
              <button
                type="submit"
                className="primary-btn"
                style={{ padding: '0.8rem 1.5rem', fontSize: '1.1rem', width: '100%' }}
                disabled={loading}
              >
                {loading ? t('connecting') : t('connect_to_moodle')}
              </button>
            </form>
          </div>
        </div>
        {signingInToMoodle && (
          <div className="noodle-toast toast-info" dir={currentLang === 'he' ? 'rtl' : 'ltr'} style={{ zIndex: 100001 }}>
            <span className="toast-message" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="spinning-sync-icon">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              <span>{t('signing_in_to_moodle')}</span>
            </span>
          </div>
        )}

        {toast && (
          <div className={`noodle-toast toast-${toast.type}`} dir={currentLang === 'he' ? 'rtl' : 'ltr'}>
            <span className="toast-message">{toast.message}</span>
            <button className="toast-close" onClick={() => setToast(null)}>×</button>
          </div>
        )}
      </div>
    );
  }

  // Onboarding Step 2: Course Selection
  if (onboardingStep === 2) {
    return (
      <div className="onboarding-container" dir={currentLang === 'he' ? 'rtl' : 'ltr'}>
        <div className="onboarding-card glass-panel wide-card" style={{ position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem', position: 'absolute', top: '1rem', right: currentLang === 'he' ? 'auto' : '1rem', left: currentLang === 'he' ? '1rem' : 'auto' }}>
            <select
              value={currentLang}
              onChange={async (e) => {
                const newLang = e.target.value as 'he' | 'en';
                const updated = { ...(settings || DEFAULT_SETTINGS), language: newLang };
                setSettingsState(updated);
                await setSettings(updated);
              }}
              className="settings-select"
              style={{
                padding: '0.3rem 0.6rem',
                fontSize: '0.85rem',
                background: 'rgba(0,0,0,0.4)',
                color: 'white',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer'
              }}
            >
              <option value="he" style={{ background: '#1e1b18', color: 'white' }}>עברית</option>
              <option value="en" style={{ background: '#1e1b18', color: 'white' }}>English</option>
            </select>
          </div>
          <h2>{t('select_courses_title')}</h2>
          <p className="subtitle" style={{ marginBottom: '1.5rem' }}>
            {t('select_courses_desc')}
          </p>

          {validatingToken ? (
            <div className="center-container">
              <div className="spinner"></div>
              <p>{t('fetching_courses')}</p>
            </div>
          ) : (
            <>
              <div className="courses-grid-selection-grouped" style={{ width: '100%', maxHeight: '450px', overflowY: 'auto', paddingRight: '0.5rem' }}>
                {groupAndSortCourses(availableCourses, currentLang).map((group) => (
                  <div key={group.semesterKey} className="semester-group-section" style={{ marginBottom: '2rem' }}>
                    <h3 className="semester-group-title" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem', marginBottom: '1rem', color: 'var(--text-primary)', textAlign: currentLang === 'he' ? 'right' : 'left' }}>
                      {group.label}
                    </h3>
                    <div className="courses-grid-selection">
                      {[...group.courses].sort((a, b) => {
                        const isCheckedA = trackedCourseIds.includes(a.id);
                        const isCheckedB = trackedCourseIds.includes(b.id);
                        if (isCheckedA && !isCheckedB) return -1;
                        if (!isCheckedA && isCheckedB) return 1;
                        return 0;
                      }).map((c) => {
                        const isChecked = trackedCourseIds.includes(c.id);
                        return (
                          <div
                            key={c.id}
                            className={`course-selection-item glass-panel ${isChecked ? 'selected' : ''}`}
                            onClick={() => handleOnboardingCourseToggle(c.id)}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              readOnly
                            />
                            <div className="course-info-selection">
                              <span className="course-code">{c.shortname.split('-')[0]}</span>
                              <h4 className="course-fullname">{c.fullname}</h4>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="action-row" style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
                <button
                  className="primary-btn"
                  onClick={handleSaveOnboardingCourses}
                  disabled={trackedCourseIds.length === 0}
                  style={{ width: '100%', maxWidth: '280px' }}
                >
                  {t('start_tracking')} ({trackedCourseIds.length} {currentLang === 'he' ? 'קורסים' : 'Courses'})
                </button>
                <label className="secondary-btn btn-sm" style={{ width: '100%', maxWidth: '280px', textAlign: 'center', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                  <UploadIcon size={13} />
                  <span>{t('import_config_btn')}</span>
                  <input
                    type="file"
                    accept=".json"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleImportConfig(e.target.files[0]);
                      }
                    }}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>
            </>
          )}
        </div>
        {signingInToMoodle && (
          <div className="noodle-toast toast-info" dir={currentLang === 'he' ? 'rtl' : 'ltr'} style={{ zIndex: 100001 }}>
            <span className="toast-message" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="spinning-sync-icon">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              <span>{t('signing_in_to_moodle')}</span>
            </span>
          </div>
        )}

        {toast && (
          <div className={`noodle-toast toast-${toast.type}`} dir={currentLang === 'he' ? 'rtl' : 'ltr'}>
            <span className="toast-message">{toast.message}</span>
            <button className="toast-close" onClick={() => setToast(null)}>×</button>
          </div>
        )}
      </div>
    );
  }

  const handleSaveTrackedCourses = async (newIds: number[], panoptoOverrides?: Record<number, string>) => {
    const expandedIds = expandTrackedCourseIds(newIds, groupedCoursesResult);
    setTrackedCourseIdsState(expandedIds);
    await setTrackedCourseIds(expandedIds);
    if (panoptoOverrides && settings) {
      const cleanedMap: Record<number, string> = {};
      for (const [k, v] of Object.entries(panoptoOverrides)) {
        if (v && String(v).trim()) {
          cleanedMap[Number(k)] = String(v).trim();
        }
      }
      const updated = { ...settings, coursesPanoptoMap: cleanedMap };
      setSettingsState(updated);
      await setSettings(updated);
    }
    handleManualSync();
  };

  return (
    <LocalFilesContext.Provider value={localFilesCtxValue}>
      <div className={`dashboard-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`} dir={currentLang === 'he' ? 'rtl' : 'ltr'}>
        {/* Sidebar Navigation */}
        <aside className={`sidebar glass-panel ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-logo" style={{ flexDirection: 'column', alignItems: 'center', gap: '0.5rem', textAlign: 'center', marginBottom: '2rem' }}>
            <img src={logoImg} alt="Noodle Logo" className="sidebar-logo-img" />
            <span>Noodle</span>
          </div>

          <nav className="sidebar-nav">
            <button
              className={`nav-item ${activeTab === 'dashboard' && selectedCourseId === null ? 'active' : ''}`}
              onClick={() => { setActiveTab('dashboard'); setSelectedCourseId(null); setAssignmentFilterCourseId(null); }}
            >
              <DashboardIcon size={18} /> <span>{t('dashboard')}</span>
            </button>
            <button
              className={`nav-item ${activeTab === 'assignments' && selectedCourseId === null ? 'active' : ''}`}
              onClick={() => { setActiveTab('assignments'); setSelectedCourseId(null); setAssignmentFilterCourseId(null); }}
            >
              <AssignmentsIcon size={18} /> <span>{t('assignments')}</span>
            </button>
            <button
              className={`nav-item ${activeTab === 'recordings' && selectedCourseId === null ? 'active' : ''}`}
              onClick={() => { setActiveTab('recordings'); setSelectedCourseId(null); }}
            >
              <VideoIcon size={18} /> <span>{t('recordings')}</span>
            </button>
            <button
              className={`nav-item ${activeTab === 'grades' && selectedCourseId === null ? 'active' : ''}`}
              onClick={() => { setActiveTab('grades'); setSelectedCourseId(null); }}
            >
              <GradesIcon size={18} /> <span>{t('grades')}</span>
            </button>
            <button
              className={`nav-item ${activeTab === 'settings' && selectedCourseId === null ? 'active' : ''}`}
              onClick={() => { setActiveTab('settings'); setSelectedCourseId(null); }}
            >
              <SettingsIcon size={18} /> <span>{t('settings')}</span>
            </button>
            <button
              className={`nav-item ${activeTab === 'about' && selectedCourseId === null ? 'active' : ''}`}
              onClick={() => { setActiveTab('about'); setSelectedCourseId(null); }}
            >
              <AboutIcon size={18} /> <span>{t('about')}</span>
            </button>

            <button
              className="nav-item collapse-toggle-btn"
              onClick={toggleSidebarCollapse}
              style={{ marginTop: 'auto' }}
            >
              <CollapseSidebarIcon size={16} isCollapsed={sidebarCollapsed} isRtl={currentLang === 'he'} />
              <span>{t('collapse_sidebar')}</span>
            </button>
            <button
              type="button"
              className="nav-item sidebar-tour-btn"
              onClick={handleStartTour}
              title={t('take_tour_btn')}
              aria-label={t('take_tour_btn')}
            >
              <TourCompassIcon size={16} />
              <span>{t('take_tour_btn')}</span>
            </button>
          </nav>

          {showSidebarUpdateBanner && storeUpdateStatus?.latestVersion && (
            <div className="sidebar-update-banner" role="status" aria-live="polite">
              {sidebarCollapsed ? (
                <a
                  href={storeUpdateStatus.storeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="sidebar-update-compact"
                  title={`${t('update_banner_title')}: v${storeUpdateStatus.latestVersion}`}
                  aria-label={`${t('update_banner_title')}: v${storeUpdateStatus.latestVersion}`}
                >
                  <UpdateArrowIcon size={16} />
                </a>
              ) : (
                <>
                  <div className="sidebar-update-header">
                    <span className="sidebar-update-title">
                      <UpdateArrowIcon size={14} />
                      <span>{t('update_banner_title')}</span>
                    </span>
                    <button
                      type="button"
                      className="sidebar-update-dismiss"
                      onClick={() => handleDismissStoreUpdate(storeUpdateStatus.latestVersion!)}
                      title={t('update_banner_dismiss')}
                      aria-label={t('update_banner_dismiss')}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="sidebar-update-versions" dir="ltr">
                    v{currentManifestVersion} → v{storeUpdateStatus.latestVersion}
                  </div>
                  <a
                    href={storeUpdateStatus.storeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="sidebar-update-cta"
                  >
                    <span>{t('update_banner_cta')}</span>
                    <ExternalLinkIcon size={11} />
                  </a>
                </>
              )}
            </div>
          )}

          <div className="sidebar-footer">
            <a
              href="https://noodle.mantin.dev/"
              target="_blank"
              rel="noreferrer"
              className="sidebar-website-link"
              title="noodle.mantin.dev"
            >
              <span>noodle.mantin.dev</span>
              <ExternalLinkIcon size={12} />
            </a>
            <button className="text-btn danger-text disconnect-btn" onClick={handleDisconnectClick}>
              <ExitIcon size={16} />
              <span>{t('disconnect_account')}</span>
            </button>
          </div>
        </aside>

        {/* Main Viewport & Resizable Container */}
        <div className="main-viewport" ref={mainViewportRef}>
          <div
            className={`main-container ${isResizingWidth ? 'is-resizing' : ''}`}
            style={{ maxWidth: `${dashboardMaxWidth}px` }}
          >
            {/* Subtle Left Resize Handle */}
            <div
              className="content-resize-handle handle-left"
              onMouseDown={(e) => handleResizeMouseDown(e, 'left')}
              onDoubleClick={handleResetDashboardWidth}
              title={t('resize_width_tooltip')}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize width left"
            >
              <div className="resize-handle-line" />
              <div className="resize-handle-pill">
                <span className="resize-handle-grip">⋮</span>
                <span className="resize-handle-val">{dashboardMaxWidth}px</span>
              </div>
            </div>

            <main className="main-content">
              <header className="content-header">
                <div className="header-title">
                  <h2>
                    {selectedCourseId !== null
                      ? getCourseDisplayName(
                        selectedCourseId,
                        assignmentsList.find((a) => a.courseId === selectedCourseId)?.courseName ||
                        filesList.find((f) => f.courseId === selectedCourseId)?.courseName ||
                        `Course ${selectedCourseId}`
                      )
                      : t(activeTab as any)}
                  </h2>
                  <p className="subtitle">
                    {t('last_synced')}: {syncResult ? new Date(syncResult.syncedAt).toLocaleString() : t('never')}
                  </p>
                </div>
                <div className="header-actions" style={{ position: 'relative', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <button
                    className={`primary-btn btn-sm header-sync-btn ${tourStep === 1 ? 'tour-highlight' : ''}`}
                    onClick={() => {
                      if (loading || isSyncing) {
                        if (!showSyncWindow) {
                          setShowSyncWindow(true);
                          setIsSyncWindowCollapsed(false);
                        } else if (isSyncWindowCollapsed) {
                          setIsSyncWindowCollapsed(false);
                        } else {
                          setIsSyncWindowCollapsed(true);
                        }
                      } else {
                        handleManualSync();
                      }
                    }}
                    style={{
                      position: 'relative',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      cursor: 'pointer',
                    }}
                    title={loading || isSyncing ? t('sync_window_title') : t('sync_now')}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={loading || isSyncing ? 'spinning-sync-icon' : ''}
                    >
                      <path d="M21 2v6h-6"></path>
                      <path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path>
                      <path d="M3 22v-6h6"></path>
                      <path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path>
                    </svg>
                    <span>
                      {loading || isSyncing ? t('syncing') : t('sync_now')}
                    </span>
                  </button>

                  <SyncProgressWindow
                    isOpen={showSyncWindow}
                    isCollapsed={isSyncWindowCollapsed}
                    onCollapse={() => setIsSyncWindowCollapsed(true)}
                    onExpand={() => setIsSyncWindowCollapsed(false)}
                    isSyncing={loading || isSyncing}
                    syncState={syncState}
                    syncError={syncError}
                    hasPanopto={settings?.panoptoEnabled ?? false}
                    t={t}
                    lang={currentLang}
                  />
                </div>
              </header>

              {/* Tab Contents */}
              <div className="tab-pane">
                {selectedCourseId !== null ? (
                  <CourseDetailView
                    courseId={selectedCourseId}
                    assignments={assignmentsList}
                    files={filesList}
                    meetings={meetingsList}
                    recordings={recordingsList}
                    courseStaff={
                      mergedSyncView?.courseStaff?.[selectedCourseId] ||
                      cachedCourseStaff[selectedCourseId] ||
                      syncResult?.courseStaff?.[selectedCourseId]
                    }
                    courseSections={mergedSyncView?.sections}
                    courseFolders={mergedSyncView?.folders}
                    courseLinks={mergedSyncView?.links}
                    courseAnnouncements={mergedSyncView?.announcements}
                    syncErrors={syncResult?.errors}
                    token={token}
                    getCourseColor={getCourseColor}
                    getCourseDisplayName={getCourseDisplayName}
                    onBack={() => setSelectedCourseId(null)}
                    t={t}
                    lang={currentLang}
                    settings={settings}
                    onToggleMeetingInterest={handleToggleMeetingInterest}
                    onSetCourseMeetingsVisibility={handleSetCourseMeetingsVisibility}
                    showHiddenZoomCourseIds={showHiddenZoomCourseIds}
                    onToggleShowHiddenZoom={handleToggleShowHiddenZoom}
                    showHiddenPanoptoCourseIds={showHiddenPanoptoCourseIds}
                    onToggleShowHiddenPanopto={handleToggleShowHiddenPanopto}
                    onToggleCompleted={handleToggleCompleted}
                    onToggleHidden={handleToggleHidden}
                    onToggleHideAllCourse={handleToggleHideAllCourse}
                    onToggleRecordingWatched={handleToggleRecordingWatched}
                    onToggleTrackHost={handleToggleTrackHost}
                    onUpdatePanopto={handleUpdateCoursePanopto}
                    onUpdatePanoptoStaff={handleUpdateCoursePanoptoStaff}
                    onImportCourseStaff={handleImportCourseStaff}
                    isSyncing={loading || isSyncing}
                    hasPanoptoPermission={hasPanoptoPermission}
                    onRequestPanoptoPermission={handleRequestPanoptoPermission}
                    tourStep={tourStep}
                  />
                ) : activeTab === 'dashboard' ? (
                  <DashboardTab
                    assignments={assignmentsList}
                    meetings={meetingsList}
                    token={token}
                    getCourseColor={getCourseColor}
                    getCourseDisplayName={getCourseDisplayName}
                    settings={settings}
                    t={t}
                    lang={currentLang}
                    tourStep={tourStep}
                    onToggleMeetingInterest={handleToggleMeetingInterest}
                    onSetCourseMeetingsVisibility={handleSetCourseMeetingsVisibility}
                    showHiddenZoomCourseIds={showHiddenZoomCourseIds}
                    onToggleShowHiddenZoom={handleToggleShowHiddenZoom}
                    trackedCourseIds={trackedCourseIds}
                    enrolledCourses={availableCourses}
                    onUpdateColor={handleUpdateCourseColor}
                    onUpdateCustomName={handleUpdateCourseCustomName}
                    onUpdatePanopto={handleUpdateCoursePanopto}
                    onSaveTrackedCourses={handleSaveTrackedCourses}
                    onOpenManageCourses={() => setIsManageModalOpen(true)}
                    onGoToCourse={(courseId) => {
                      setSelectedCourseId(courseId);
                    }}
                    onViewCourseAssignments={(courseId) => {
                      setAssignmentFilterCourseId(courseId);
                      setActiveTab('assignments');
                    }}
                    syncResult={mergedSyncView || syncResult}
                    onToggleCompleted={handleToggleCompleted}
                    onToggleHidden={handleToggleHidden}
                    onLabDetected={(id, name) => setLabModalCourse({ id, name })}
                    hasGoogleTasksToken={hasGoogleTasksToken}
                    googleTasksAuthError={googleTasksAuthError}
                    onSyncGoogle={handleSyncGoogleTasks}
                    googleSyncLoading={googleSyncLoading}
                    onToggleRecordingWatched={handleToggleRecordingWatched}
                    groupedCoursesResult={groupedCoursesResult}
                    hasPanoptoPermission={hasPanoptoPermission}
                    onRequestPanoptoPermission={handleRequestPanoptoPermission}
                    localFsConfig={localFsConfig}
                    localFsStatus={localFsStatus}
                    onReconnectLocalFs={async () => {
                      const provider = createFileSystemProvider();
                      if (provider instanceof ChromiumFsaProvider) {
                        const granted = await provider.requestStoredPermission();
                        if (granted) {
                          await resumeLocalFsSyncOnBackground();
                          showToast(t('local_fs_status_idle'), 'success');
                        } else {
                          setActiveTab('settings');
                        }
                      } else {
                        setActiveTab('settings');
                      }
                    }}
                  />
                ) : activeTab === 'assignments' ? (
                  <AssignmentsTab
                    assignments={assignmentsList}
                    recordings={recordingsList}
                    files={filesList}
                    token={token}
                    getCourseColor={getCourseColor}
                    getCourseDisplayName={getCourseDisplayName}
                    filterCourseId={assignmentFilterCourseId}
                    onClearFilter={() => setAssignmentFilterCourseId(null)}
                    onGoToCourse={(courseId) => {
                      setSelectedCourseId(courseId);
                    }}
                    settings={settings}
                    t={t}
                    lang={currentLang}
                    tourStep={tourStep}
                    onToggleCompleted={handleToggleCompleted}
                    onToggleHidden={handleToggleHidden}
                    focusedAssignId={focusedAssignmentId}
                    onClearFocusedAssign={() => setFocusedAssignmentId(null)}
                    onFocusRecording={(recordingId) => {
                      setFocusedRecordingId(recordingId);
                      setActiveTab('recordings');
                    }}
                  />
                ) : activeTab === 'recordings' ? (
                  <RecordingsTab
                    recordings={recordingsList}
                    assignments={assignmentsList}
                    trackedCourseIds={trackedCourseIds}
                    enrolledCourses={availableCourses}
                    getCourseColor={getCourseColor}
                    getCourseDisplayName={getCourseDisplayName}
                    onGoToCourse={(courseId) => {
                      setSelectedCourseId(courseId);
                    }}
                    settings={settings}
                    t={t}
                    lang={currentLang}
                    onToggleRecordingWatched={handleToggleRecordingWatched}
                    onToggleRecordingHidden={handleToggleRecordingHidden}
                    onToggleTrackHost={handleToggleTrackHost}
                    hasPanoptoPermission={hasPanoptoPermission}
                    onRequestPanoptoPermission={handleRequestPanoptoPermission}
                    onOpenSettings={() => setActiveTab('settings')}
                    focusedRecordingId={focusedRecordingId}
                    onClearFocusedRecording={() => setFocusedRecordingId(null)}
                    onFocusAssignment={(assignId) => {
                      setFocusedAssignmentId(assignId);
                      setActiveTab('assignments');
                    }}
                  />
                ) : null}

                {activeTab === 'grades' && (
                  <GradesTab
                    assignments={assignmentsList}
                    excludedCourseIds={excludedGpaCourseIds}
                    settings={settings}
                    getCourseColor={getCourseColor}
                    getCourseDisplayName={getCourseDisplayName}
                    t={t}
                    lang={currentLang}
                    tourStep={tourStep}
                  />
                )}

                {activeTab === 'settings' && (
                  <SettingsTab
                    settings={settings}
                    onToggleGoogle={handleToggleGoogleTasks}
                    onUpdateListName={handleUpdateGoogleListName}
                    onSyncGoogle={handleSyncGoogleTasks}
                    googleSyncLoading={googleSyncLoading}
                    googleSyncStatus={googleSyncStatus}
                    hasGoogleTasksToken={hasGoogleTasksToken}
                    googleTasksAuthError={googleTasksAuthError}
                    syncResult={syncResult}
                    onDisconnectClick={handleDisconnectClick}
                    onToggleSyncWithoutDeadline={async (enabled: boolean) => {
                      if (!settings) return;
                      const updated = { ...settings, syncWithoutDeadline: enabled };
                      setSettingsState(updated);
                      await setSettings(updated);
                      if (updated.googleTasksEnabled) {
                        syncGoogleTasksOnBackground(false).catch(() => { });
                      }
                    }}
                    onUpdateGoogleClientId={async (id: string) => {
                      if (!settings) return;
                      const updated = { ...settings, googleClientId: id || null };
                      setSettingsState(updated);
                      await setSettings(updated);
                    }}
                    t={t}
                    lang={currentLang}
                    onUpdateLanguage={async (l: 'he' | 'en') => {
                      if (!settings) return;
                      const updated = { ...settings, language: l };
                      setSettingsState(updated);
                      await setSettings(updated);
                    }}
                    onUpdateTheme={async (theme: 'dark' | 'noodle' | 'coffee' | 'time') => {
                      if (!settings) return;
                      const updated = { ...settings, theme };
                      setSettingsState(updated);
                      await setSettings(updated);
                    }}
                    onUpdateTimeThemeHours={async (start: number, end: number) => {
                      if (!settings) return;
                      const updated = { ...settings, themeTimeDayStart: start, themeTimeDayEnd: end };
                      setSettingsState(updated);
                      await setSettings(updated);
                    }}
                    onOpenManageCourses={() => setIsManageModalOpen(true)}
                    onUpdateThresholds={async (green: number, yellow: number) => {
                      if (!settings) return;
                      const updated = { ...settings, assignmentGreenDaysThreshold: green, assignmentYellowDaysThreshold: yellow };
                      setSettingsState(updated);
                      await setSettings(updated);
                    }}
                    onTogglePanoptoFolderOverride={async (enabled: boolean) => {
                      if (!settings) return;
                      const updated = { ...settings, showPanoptoFolderOverride: enabled };
                      setSettingsState(updated);
                      await setSettings(updated);
                    }}
                    onTogglePanopto={async (enabled: boolean) => {
                      if (!settings) return;
                      if (enabled && typeof browser !== 'undefined' && browser.permissions?.request) {
                        try {
                          const hasPerm = await browser.permissions.contains({ origins: PANOPTO_ORIGINS });
                          if (!hasPerm) {
                            const granted = await browser.permissions.request({ origins: PANOPTO_ORIGINS });
                            setHasPanoptoPermission(granted);
                          } else {
                            setHasPanoptoPermission(true);
                          }
                        } catch (err) {
                          console.warn('[Panopto] Error requesting permissions:', err);
                        }
                      }
                      const updated = { ...settings, panoptoEnabled: enabled };
                      setSettingsState(updated);
                      await setSettings(updated);
                      if (enabled) {
                        handleManualSync();
                      }
                    }}
                    onToggleNotifications={async (enabled: boolean) => {
                      if (!settings) return;
                      const updated = { ...settings, notificationsEnabled: enabled };
                      setSettingsState(updated);
                      await setSettings(updated);
                    }}
                    onExportConfig={handleExportConfig}
                    onImportConfig={handleImportConfig}
                    onAddMockCourse={handleAddMockCourse}
                    tourStep={tourStep}
                    dashboardMaxWidth={dashboardMaxWidth}
                    onUpdateDashboardWidth={handleUpdateDashboardWidth}
                    onResetDashboardWidth={handleResetDashboardWidth}
                    onUpdateSyncInterval={async (val: number) => {
                      if (!settings) return;
                      const updated = { ...settings, syncIntervalMinutes: val };
                      setSettingsState(updated);
                      await setSettings(updated);
                      browser.runtime.sendMessage({ type: 'SYNC_SETTINGS' }).catch(() => { });
                    }}
                    hasPanoptoPermission={hasPanoptoPermission}
                    onRequestPanoptoPermission={handleRequestPanoptoPermission}
                    localFsConfig={localFsConfig}
                    localFsStatus={localFsStatus}
                    onLocalFsConfigChanged={setLocalFsConfigState}
                    onShowToast={showToast}
                  />
                )}

                {activeTab === 'about' && (
                  <AboutTab
                    t={t}
                    lang={currentLang}
                    tourStep={tourStep}
                    onStartTour={handleStartTour}
                  />
                )}
              </div>
            </main>

            {/* Subtle Right Resize Handle */}
            <div
              className="content-resize-handle handle-right"
              onMouseDown={(e) => handleResizeMouseDown(e, 'right')}
              onDoubleClick={handleResetDashboardWidth}
              title={t('resize_width_tooltip')}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize width right"
            >
              <div className="resize-handle-line" />
              <div className="resize-handle-pill">
                <span className="resize-handle-grip">⋮</span>
                <span className="resize-handle-val">{dashboardMaxWidth}px</span>
              </div>
            </div>
          </div>
        </div>

        {/* Manage Courses Modal */}
        {isManageModalOpen && (
          <div
            className="modal-backdrop"
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
              backdropFilter: 'blur(4px)',
              padding: '1.5rem'
            }}
            onClick={() => setIsManageModalOpen(false)}
          >
            <div
              className="modal-content manage-courses-modal glass-panel"
              style={{
                maxWidth: 'min(1280px, 95vw)',
                width: '100%',
                maxHeight: '85vh',
                overflowY: 'auto',
                padding: '1.75rem',
                borderRadius: 'var(--radius-md)'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h3 style={{ margin: 0 }}>{t('tracked_courses_config')}</h3>
                <button className="tour-close-btn" onClick={() => setIsManageModalOpen(false)} style={{ fontSize: '1.25rem', cursor: 'pointer' }}>
                  ✕
                </button>
              </div>

              <CoursesConfigTable
                trackedCourseIds={trackedCourseIds}
                syncResult={syncResult}
                cachedCourseStaff={cachedCourseStaff}
                loadingStaffCourseIds={loadingStaffCourseIds}
                enrolledCourses={availableCourses || []}
                getCourseColor={getCourseColor}
                getCourseDisplayName={getCourseDisplayName}
                coursesPanoptoMap={settings?.coursesPanoptoMap}
                coursesPanoptoStaff={settings?.coursesPanoptoStaff}
                panoptoEnabled={settings?.panoptoEnabled ?? false}
                showPanoptoFolderOverride={settings?.showPanoptoFolderOverride ?? false}
                onUpdateColor={handleUpdateCourseColor}
                onUpdateCustomName={handleUpdateCourseCustomName}
                onUpdatePanopto={handleUpdateCoursePanopto}
                onUpdatePanoptoStaff={handleUpdateCoursePanoptoStaff}
                onImportCourseStaff={handleImportCourseStaff}
                onSaveTrackedCourses={(newIds, panoptoOverrides) => {
                  setIsManageModalOpen(false);
                  handleSaveTrackedCourses(newIds, panoptoOverrides);
                }}
                onLabDetected={(id, name) => setLabModalCourse({ id, name })}
                t={t}
                lang={currentLang}
              />
            </div>
          </div>
        )}

        {showDisconnectModal && (
          <div className="modal-overlay">
            <div className="modal-content glass-panel" style={{ maxWidth: '450px', padding: '2rem' }}>
              <h3 style={{ marginTop: 0 }}>⚠️ {t('disconnect_account')}</h3>
              <p style={{ margin: '1rem 0', color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: '1.4' }}>
                {t('disconnect_warning')}
              </p>
              <div className="modal-checkbox-row" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '1.5rem 0' }}>
                <input
                  type="checkbox"
                  id="perm-delete-checkbox"
                  checked={deletePermanently}
                  onChange={(e) => setDeletePermanently(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <label htmlFor="perm-delete-checkbox" style={{ cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                  {t('perm_delete_checkbox')}
                </label>
              </div>
              <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                <button className="secondary-btn btn-sm" onClick={() => setShowDisconnectModal(false)}>
                  {t('cancel_btn')}
                </button>
                <button className="primary-btn btn-sm" style={{ background: 'var(--error-color, #ef4444)' }} onClick={confirmDisconnect}>
                  {t('disconnect_confirm_btn')}
                </button>
              </div>
            </div>
          </div>
        )}

        {labModalCourse && (
          <div className="modal-overlay" onClick={() => setLabModalCourse(null)}>
            <div
              className="modal-content glass-panel"
              style={{ maxWidth: '480px', padding: '2rem', textAlign: currentLang === 'he' ? 'right' : 'left' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <span style={{ fontSize: '2rem' }}>🧪</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.25rem' }}>{t('lab_detected_title')}</h3>
                  <span style={{ fontSize: '0.9rem', color: 'var(--primary)' }}>{labModalCourse.name}</span>
                </div>
              </div>
              <p style={{ margin: '1rem 0 1.5rem', color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: '1.5' }}>
                {t('lab_detected_desc')}
              </p>
              <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  className="secondary-btn btn-sm"
                  onClick={() => setLabModalCourse(null)}
                >
                  {t('lab_detected_keep_btn')}
                </button>
                <button
                  className="primary-btn btn-sm"
                  onClick={() => {
                    handleConfirmHideLabAssignments(labModalCourse.id);
                    setLabModalCourse(null);
                  }}
                >
                  {t('lab_detected_hide_btn')}
                </button>
              </div>
            </div>
          </div>
        )}

        {showTour && (
          <TourOverlay
            step={tourStep}
            setStep={setTourStep}
            onClose={handleCloseTour}
            t={t}
            lang={currentLang}
          />
        )}

        {signingInToMoodle && (
          <div className="noodle-toast toast-info" dir={currentLang === 'he' ? 'rtl' : 'ltr'} style={{ zIndex: 100001 }}>
            <span className="toast-message" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="spinning-sync-icon">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              <span>{t('signing_in_to_moodle')}</span>
            </span>
          </div>
        )}

        {toast && (
          <div className={`noodle-toast toast-${toast.type}`} dir={currentLang === 'he' ? 'rtl' : 'ltr'}>
            <span className="toast-message">{toast.message}</span>
            <button className="toast-close" onClick={() => setToast(null)}>×</button>
          </div>
        )}
      </div>
    </LocalFilesContext.Provider>
  );
}

// -------------------------------------------------------------------
// TAB COMPONENTS
// -------------------------------------------------------------------

type MeetingStatus = 'active' | 'upcoming' | 'unknown' | 'inactive';

function getMeetingStatus(startTimeStr?: string): MeetingStatus {
  if (!startTimeStr) return 'unknown';
  const startTime = new Date(startTimeStr);
  if (isNaN(startTime.getTime())) return 'unknown';
  const now = new Date();
  const activeStart = new Date(startTime.getTime() - 15 * 60 * 1000); // 15 min early join window
  const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000); // 2h duration
  if (now >= activeStart && now <= endTime) {
    return 'active';
  } else if (now < activeStart) {
    return 'upcoming';
  } else {
    return 'inactive';
  }
}

const VideoIcon = ({ size = 14, style }: { size?: number; style?: React.CSSProperties }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', ...style }}>
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

const EyeIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOffIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}>
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

const CheckIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const ExternalLinkIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

const BookOpenIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </svg>
);

const FolderIcon = ({ size = 13, style }: { size?: number; style?: React.CSSProperties }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', ...style }}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const ChevronDownIcon = ({ size = 14, expanded = false }: { size?: number; expanded?: boolean }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{
      transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
      transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
    }}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const DownloadIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <polyline points="19 12 12 19 5 12" />
  </svg>
);

const UploadIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}>
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
);

const TrashIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

const SyncIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 2v6h-6" />
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M3 22v-6h6" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
  </svg>
);

const TourCompassIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="nav-icon" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </svg>
);

const UpdateArrowIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 19V5" />
    <polyline points="5 12 12 5 19 12" />
    <path d="M5 20h14" />
  </svg>
);

const ClockIcon = ({ size = 13, className, style }: { size?: number; className?: string; style?: React.CSSProperties }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
    style={style}
  >
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const FileIcon = ({ size = 14, style }: { size?: number; style?: React.CSSProperties }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', ...style }}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);


const DashboardIcon = ({ size = 18 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="nav-icon"
  >
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </svg>
);

const AssignmentsIcon = ({ size = 18 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="nav-icon"
  >
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    <path d="M9 14l2 2 4-4" />
  </svg>
);

const GradesIcon = ({ size = 18 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="nav-icon"
  >
    <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
    <path d="M6 12v5c3 3 9 3 12 0v-5" />
  </svg>
);

const SettingsIcon = ({ size = 18 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="nav-icon"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const AboutIcon = ({ size = 18 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="nav-icon"
  >
    <circle cx="12" cy="10" r="8" />
    <line x1="12" y1="14" x2="12" y2="10" />
    <line x1="12" y1="7" x2="12.01" y2="7" />
  </svg>
);

const CollapseSidebarIcon = ({ size = 16, isCollapsed = false, isRtl = false }: { size?: number; isCollapsed?: boolean; isRtl?: boolean }) => {
  const pointLeft = isRtl ? isCollapsed : !isCollapsed;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="nav-icon toggle-arrow-svg"
      style={{ verticalAlign: 'middle', transition: 'transform 0.25s ease' }}
    >
      {pointLeft ? (
        <polyline points="15 18 9 12 15 6" />
      ) : (
        <polyline points="9 18 15 12 9 6" />
      )}
    </svg>
  );
};

const ExitIcon = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ verticalAlign: 'middle', flexShrink: 0 }}
  >
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

interface TabProps {
  getCourseColor: (id: number) => string;
  getCourseDisplayName: (id: number, def: string) => string;
  t: (key: any) => string;
  lang: 'he' | 'en';
}

type EnhancedAssignment = Assignment & {
  isMoodleSubmitted?: boolean;
  isCompleted?: boolean;
};

// Reusable Tracked Courses Configuration Table (Used in CoursesTab and Dashboard Manage Courses Modal)
function CoursesConfigTable({
  trackedCourseIds,
  syncResult,
  cachedCourseStaff,
  loadingStaffCourseIds,
  enrolledCourses,
  getCourseColor,
  getCourseDisplayName,
  coursesPanoptoMap,
  coursesPanoptoStaff,
  panoptoEnabled,
  showPanoptoFolderOverride,
  onUpdateColor,
  onUpdateCustomName,
  onUpdatePanopto,
  onUpdatePanoptoStaff,
  onImportCourseStaff,
  onSaveTrackedCourses,
  onLabDetected,
  t,
  lang,
}: {
  trackedCourseIds: number[];
  syncResult: SyncResult | null;
  cachedCourseStaff?: Record<number, CourseStaffMember[]>;
  loadingStaffCourseIds?: Set<number>;
  enrolledCourses?: any[];
  getCourseColor: (id: number) => string;
  getCourseDisplayName: (id: number, defaultName: string) => string;
  coursesPanoptoMap?: Record<number, string>;
  coursesPanoptoStaff?: Record<number, CoursePanoptoStaffEntry[]>;
  panoptoEnabled?: boolean;
  showPanoptoFolderOverride?: boolean;
  onUpdateColor?: (id: number, color: string) => void;
  onUpdateCustomName?: (id: number, name: string) => void;
  onUpdatePanopto?: (id: number, panoptoVal: string) => void;
  onUpdatePanoptoStaff?: (id: number, entries: CoursePanoptoStaffEntry[]) => void;
  onImportCourseStaff?: (id: number, forceRefresh?: boolean) => Promise<CourseStaffMember[]>;
  onSaveTrackedCourses?: (newIds: number[], panoptoOverrides?: Record<number, string>) => void;
  onLabDetected?: (id: number, name: string) => void;
  t: (key: any) => string;
  lang: 'he' | 'en';
}) {
  const [activeTrackedIds, setActiveTrackedIds] = useState<number[]>(trackedCourseIds);
  const [localPanoptoMap, setLocalPanoptoMap] = useState<Record<number, string>>(coursesPanoptoMap || {});
  const [expandedStaffCourseId, setExpandedStaffCourseId] = useState<number | null>(null);
  const showPanoptoCol = Boolean(panoptoEnabled && showPanoptoFolderOverride);
  const showStaffCols = Boolean(panoptoEnabled && onUpdatePanoptoStaff);
  const tableClassName = `courses-settings-table${showStaffCols ? ' with-staff-cols' : ''}${showPanoptoCol ? ' with-panopto-col' : ''}`;

  const getMergedMoodleStaffForIds = (ids: Iterable<number>): CourseStaffMember[] => {
    const combined: CourseStaffMember[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      const lists = [cachedCourseStaff?.[id], syncResult?.courseStaff?.[id]];
      for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const member of list) {
          const key = normalizePersonName(member.fullName);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          combined.push(member);
        }
      }
    }
    return combined;
  };

  const getDetectedHostsForIds = (memberIds: Set<number>): string[] =>
    Array.from(
      new Set(
        (syncResult?.recordings || [])
          .filter((r) => memberIds.has(r.courseId) || (r.sourceCourseId && memberIds.has(r.sourceCourseId)))
          .map((r) => r.host)
          .filter((h): h is string => Boolean(h && h.trim()))
      )
    );

  const getCourseStaffEntries = (courseId: number): CoursePanoptoStaffEntry[] =>
    coursesPanoptoStaff?.[courseId] ||
    (coursesPanoptoStaff as Record<string, CoursePanoptoStaffEntry[]> | undefined)?.[String(courseId)] ||
    EMPTY_STAFF_ENTRIES;

  useEffect(() => {
    setActiveTrackedIds(trackedCourseIds);
  }, [trackedCourseIds]);

  useEffect(() => {
    setLocalPanoptoMap(coursesPanoptoMap || {});
  }, [coursesPanoptoMap]);

  // Compute hierarchical groups using groupEnrolledCourses when full enrolled list is available
  const hierarchicalGrouping = useMemo(() => {
    if (!enrolledCourses || enrolledCourses.length === 0) return null;
    return groupEnrolledCourses(enrolledCourses);
  }, [enrolledCourses]);

  const handleToggle = (id: number) => {
    if (activeTrackedIds.includes(id)) {
      setActiveTrackedIds(activeTrackedIds.filter((cid) => cid !== id));
    } else {
      setActiveTrackedIds([...activeTrackedIds, id]);
      if (enrolledCourses) {
        const c = enrolledCourses.find((x) => x.id === id);
        if (c && ((c.fullname && c.fullname.includes('מעבדה')) || (c.shortname && c.shortname.includes('מעבדה')))) {
          onLabDetected?.(id, c.fullname || c.shortname || `Course ${id}`);
        }
      }
    }
  };

  // Fallback flat course mapping if enrolledCourses is not available
  const coursesMap = new Map<number, { id: number; name: string; idnumber: string }>();
  if (syncResult && (!enrolledCourses || enrolledCourses.length === 0)) {
    syncResult.assignments.forEach((a) => {
      coursesMap.set(a.courseId, { id: a.courseId, name: a.courseName, idnumber: '' });
    });
    syncResult.files.forEach((f) => {
      coursesMap.set(f.courseId, { id: f.courseId, name: f.courseName, idnumber: '' });
    });
  }
  const flatCoursesList = Array.from(coursesMap.values());

  if (!hierarchicalGrouping && flatCoursesList.length === 0) {
    return (
      <div className="empty-state">
        {lang === 'he' ? 'לא נטענו קורסים עדיין. הרץ סנכרון תחילה.' : 'No courses loaded yet. Run a sync first.'}
      </div>
    );
  }

  // Partition academic unified courses by semester
  const semesterSections = useMemo(() => {
    if (!hierarchicalGrouping) return [];
    const groups: Record<string, { semesterKey: string; label: string; courses: typeof hierarchicalGrouping.academicCourses }> = {};

    for (const u of hierarchicalGrouping.academicCourses) {
      const year = u.year || '';
      const sem = u.semester || 'Other';
      const key = year ? `${year}-${sem}` : 'Other';

      if (!groups[key]) {
        let label = key;
        if (key === 'Other') {
          label = lang === 'he' ? 'קורסים נוספים' : 'Other Courses';
        } else {
          const semName =
            sem === 'SemesterA'
              ? (lang === 'he' ? "סמסטר א'" : 'Semester A')
              : sem === 'SemesterB'
                ? (lang === 'he' ? "סמסטר ב'" : 'Semester B')
                : sem === 'Summer'
                  ? (lang === 'he' ? 'סמסטר קיץ' : 'Summer Semester')
                  : sem === 'Yearly'
                    ? (lang === 'he' ? 'שנתי' : 'Yearly')
                    : sem;
          label = lang === 'he' ? `שנת ${year} - ${semName}` : `Year ${year} - ${semName}`;
        }
        groups[key] = { semesterKey: key, label, courses: [] };
      }
      groups[key].courses.push(u);
    }

    // Sort semester sections descending by year
    return Object.values(groups).sort((a, b) => b.semesterKey.localeCompare(a.semesterKey));
  }, [hierarchicalGrouping, lang]);

  return (
    <>
      <div className="courses-grouped-container" style={{ maxHeight: '440px', overflowY: 'auto', paddingRight: '0.5rem' }}>
        {hierarchicalGrouping ? (
          <>
            {semesterSections.map((sec) => (
              <div key={sec.semesterKey} className="semester-group-section" style={{ marginBottom: '2rem' }}>
                <h4
                  className="semester-group-title"
                  style={{
                    borderBottom: '1px solid rgba(255,255,255,0.1)',
                    paddingBottom: '0.4rem',
                    marginBottom: '0.8rem',
                    color: 'var(--text-primary)',
                    textAlign: lang === 'he' ? 'right' : 'left',
                  }}
                >
                  {sec.label}
                </h4>
                <div className={tableClassName}>
                  <div className="table-header">
                    <div>{t('track')}</div>
                    <div>{t('course_code_name')}</div>
                    <div>{t('display_nickname')}</div>
                    {showStaffCols && <div>{t('panopto_col_lecturer')}</div>}
                    {showStaffCols && <div>{t('panopto_col_ta')}</div>}
                    <div>{t('theme_color_label')}</div>
                  </div>

                  {sec.courses.map((u) => {
                    const isMultiPortal = u.subCourses.length > 1;
                    const childSubCourses = isMultiPortal ? u.subCourses.filter((s) => s.courseId !== u.id) : [];
                    const staffEntries = getCourseStaffEntries(u.id);
                    const memberIds = new Set(u.subCourses.map((s) => s.courseId));
                    const detectedHosts = getDetectedHostsForIds(memberIds);
                    const moodleStaffCombined = getMergedMoodleStaffForIds(memberIds);
                    const isLoadingMoodle = Boolean(loadingStaffCourseIds?.has(u.id));
                    const isExpanded = expandedStaffCourseId === u.id;

                    return (
                      <Fragment key={u.id}>
                        {/* Parent Portal Row */}
                        <div className="table-row">
                          <div>
                            <input
                              type="checkbox"
                              checked={activeTrackedIds.includes(u.id)}
                              onChange={() => handleToggle(u.id)}
                            />
                          </div>
                          <div>
                            <span className="course-code-span">{u.courseCode}</span>
                            {isMultiPortal && (
                              <span
                                className="badge-primary"
                                style={{
                                  fontSize: '0.68rem',
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  marginInlineEnd: '6px',
                                  fontWeight: 600,
                                }}
                              >
                                {lang === 'he' ? 'פורטל ראשי' : 'Main Portal'}
                              </span>
                            )}
                            <p className="course-full-p" style={{ fontWeight: isMultiPortal ? 600 : 400 }}>
                              {u.fullname}
                            </p>
                          </div>
                          <div>
                            <input
                              type="text"
                              className="nickname-input"
                              defaultValue={getCourseDisplayName(u.id, '')}
                              placeholder={t('nickname_placeholder')}
                              onBlur={(e) => onUpdateCustomName && onUpdateCustomName(u.id, e.target.value)}
                            />
                          </div>
                          {showStaffCols && onUpdatePanoptoStaff && (
                            <>
                              <CourseStaffHostColumnCell
                                courseId={u.id}
                                role="Lecture"
                                entries={staffEntries}
                                moodleStaff={moodleStaffCombined}
                                detectedHosts={detectedHosts}
                                isLoadingMoodle={isLoadingMoodle}
                                onSaveEntries={onUpdatePanoptoStaff}
                                onRefreshFromMoodle={onImportCourseStaff ? (id) => onImportCourseStaff(id, true) : undefined}
                                t={t}
                                lang={lang}
                              />
                              <CourseStaffHostColumnCell
                                courseId={u.id}
                                role="Recitation"
                                entries={staffEntries}
                                moodleStaff={moodleStaffCombined}
                                detectedHosts={detectedHosts}
                                isLoadingMoodle={isLoadingMoodle}
                                onSaveEntries={onUpdatePanoptoStaff}
                                onRefreshFromMoodle={onImportCourseStaff ? (id) => onImportCourseStaff(id, true) : undefined}
                                t={t}
                                lang={lang}
                              />
                            </>
                          )}
                          {showPanoptoCol && (
                            <div>
                              <input
                                type="text"
                                className="nickname-input panopto-folder-input"
                                value={localPanoptoMap[u.id] ?? ''}
                                placeholder={t('panopto_folder_placeholder')}
                                dir="ltr"
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setLocalPanoptoMap((prev) => ({ ...prev, [u.id]: val }));
                                }}
                                onBlur={(e) => onUpdatePanopto && onUpdatePanopto(u.id, e.target.value)}
                              />
                            </div>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <input
                              type="color"
                              className="color-picker"
                              value={getCourseColor(u.id)}
                              onChange={(e) => onUpdateColor && onUpdateColor(u.id, e.target.value)}
                            />
                            {panoptoEnabled && onUpdatePanoptoStaff && onImportCourseStaff && (
                              <button
                                type="button"
                                className={`secondary-btn btn-xs panopto-staff-toggle-btn ${isExpanded ? 'active' : ''}`}
                                onClick={() => setExpandedStaffCourseId(isExpanded ? null : u.id)}
                                title={t('panopto_staff_title')}
                              >
                                {t('panopto_staff_short_btn')} ({staffEntries.length})
                              </button>
                            )}
                          </div>
                        </div>

                        {panoptoEnabled && onUpdatePanoptoStaff && onImportCourseStaff && isExpanded && (
                          <div className="panopto-staff-table-drawer">
                            <PanoptoStaffEditor
                              courseId={u.id}
                              entries={staffEntries}
                              moodleStaff={moodleStaffCombined}
                              detectedHosts={detectedHosts}
                              onSaveEntries={onUpdatePanoptoStaff}
                              onImportFromMoodle={(id) => onImportCourseStaff(id, true)}
                              t={t}
                              lang={lang}
                            />
                          </div>
                        )}

                        {/* Indented Sub-Course Rows */}
                        {childSubCourses.map((sub) => {
                          const isLab = sub.fullname && sub.fullname.includes('מעבדה');
                          return (
                            <div
                              key={sub.courseId}
                              className="table-row subcourse-row"
                              style={{
                                background: 'rgba(255, 255, 255, 0.02)',
                                paddingInlineStart: '2.2rem',
                              }}
                            >
                              <div>
                                <input
                                  type="checkbox"
                                  checked={activeTrackedIds.includes(sub.courseId)}
                                  onChange={() => handleToggle(sub.courseId)}
                                />
                              </div>
                              <div>
                                <span style={{ color: 'var(--text-muted)', marginInlineEnd: '0.4rem', fontFamily: 'monospace' }}>↳</span>
                                {sub.groupId && sub.groupId !== '00' && sub.groupId !== '99' && (
                                  <span
                                    className="badge-secondary"
                                    style={{
                                      fontSize: '0.68rem',
                                      padding: '1px 5px',
                                      borderRadius: '4px',
                                      marginInlineEnd: '4px',
                                    }}
                                  >
                                    {lang === 'he' ? `קבוצה ${sub.groupId}` : `Group ${sub.groupId}`}
                                  </span>
                                )}
                                {isLab && (
                                  <span
                                    className="badge-warning"
                                    style={{
                                      fontSize: '0.68rem',
                                      padding: '1px 5px',
                                      borderRadius: '4px',
                                      marginInlineEnd: '4px',
                                    }}
                                  >
                                    {lang === 'he' ? 'מעבדה' : 'Lab'}
                                  </span>
                                )}
                                <p className="course-full-p" style={{ display: 'inline', color: 'var(--text-secondary)' }}>
                                  {sub.fullname}
                                </p>
                              </div>
                              <div>
                                <input
                                  type="text"
                                  className="nickname-input"
                                  defaultValue={getCourseDisplayName(sub.courseId, '')}
                                  placeholder={t('nickname_placeholder')}
                                  onBlur={(e) => onUpdateCustomName && onUpdateCustomName(sub.courseId, e.target.value)}
                                />
                              </div>
                              {showStaffCols && <div />}
                              {showStaffCols && <div />}
                              {showPanoptoCol && (
                                <div>
                                  <input
                                    type="text"
                                    className="nickname-input panopto-folder-input"
                                    value={localPanoptoMap[sub.courseId] ?? ''}
                                    placeholder={t('panopto_folder_placeholder')}
                                    dir="ltr"
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setLocalPanoptoMap((prev) => ({ ...prev, [sub.courseId]: val }));
                                    }}
                                    onBlur={(e) => onUpdatePanopto && onUpdatePanopto(sub.courseId, e.target.value)}
                                  />
                                </div>
                              )}
                              <div>
                                <input
                                  type="color"
                                  className="color-picker"
                                  value={getCourseColor(sub.courseId)}
                                  onChange={(e) => onUpdateColor && onUpdateColor(sub.courseId, e.target.value)}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Administrative Umbrella Section */}
            {hierarchicalGrouping.administrativeUmbrella &&
              hierarchicalGrouping.administrativeUmbrella.subCourses.length > 0 && (
                <div className="semester-group-section" style={{ marginBottom: '2rem' }}>
                  <h4
                    className="semester-group-title"
                    style={{
                      borderBottom: '1px solid rgba(255,255,255,0.1)',
                      paddingBottom: '0.4rem',
                      marginBottom: '0.8rem',
                      color: 'var(--text-primary)',
                      textAlign: lang === 'he' ? 'right' : 'left',
                    }}
                  >
                    🛡️ {lang === 'he' ? 'הדרכות בטיחות ומנהלה' : 'Safety & Administrative Tutorials'}
                  </h4>
                  <div className={`courses-settings-table${showPanoptoCol ? ' with-panopto-col' : ''}`}>
                    <div className="table-header">
                      <div>{t('track')}</div>
                      <div>{t('course_code_name')}</div>
                      <div>{t('display_nickname')}</div>
                      {showPanoptoCol && <div>{t('panopto_folder_column')}</div>}
                      <div>{t('theme_color_label')}</div>
                    </div>

                    {hierarchicalGrouping.administrativeUmbrella.subCourses.map((sub) => (
                      <div
                        key={sub.courseId}
                        className="table-row"
                        style={{ paddingInlineStart: '1rem' }}
                      >
                        <div>
                          <input
                            type="checkbox"
                            checked={activeTrackedIds.includes(sub.courseId)}
                            onChange={() => handleToggle(sub.courseId)}
                          />
                        </div>
                        <div>
                          <span
                            className="badge-secondary"
                            style={{
                              fontSize: '0.68rem',
                              padding: '1px 5px',
                              borderRadius: '4px',
                              marginInlineEnd: '6px',
                            }}
                          >
                            {lang === 'he' ? 'הדרכה' : 'Tutorial'}
                          </span>
                          <p className="course-full-p" style={{ display: 'inline' }}>
                            {sub.fullname}
                          </p>
                        </div>
                        <div>
                          <input
                            type="text"
                            className="nickname-input"
                            defaultValue={getCourseDisplayName(sub.courseId, '')}
                            placeholder={t('nickname_placeholder')}
                            onBlur={(e) => onUpdateCustomName && onUpdateCustomName(sub.courseId, e.target.value)}
                          />
                        </div>
                        {showPanoptoCol && <div />}
                        <div>
                          <input
                            type="color"
                            className="color-picker"
                            value={getCourseColor(sub.courseId)}
                            onChange={(e) => onUpdateColor && onUpdateColor(sub.courseId, e.target.value)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
          </>
        ) : (
          /* Flat fallback view */
          groupAndSortCourses(flatCoursesList, lang).map((group) => (
            <div key={group.semesterKey} className="semester-group-section" style={{ marginBottom: '2rem' }}>
              <h4
                className="semester-group-title"
                style={{
                  borderBottom: '1px solid rgba(255,255,255,0.1)',
                  paddingBottom: '0.4rem',
                  marginBottom: '0.8rem',
                  color: 'var(--text-primary)',
                  textAlign: lang === 'he' ? 'right' : 'left',
                }}
              >
                {group.label}
              </h4>
              <div className={tableClassName}>
                <div className="table-header">
                  <div>{t('track')}</div>
                  <div>{t('course_code_name')}</div>
                  <div>{t('display_nickname')}</div>
                  {showStaffCols && <div>{t('panopto_col_lecturer')}</div>}
                  {showStaffCols && <div>{t('panopto_col_ta')}</div>}
                  <div>{t('theme_color_label')}</div>
                </div>
                {[...group.courses].map((c) => {
                  const staffEntries = getCourseStaffEntries(c.id);
                  const isExpanded = expandedStaffCourseId === c.id;
                  const detectedHosts = getDetectedHostsForIds(new Set([c.id]));
                  const moodleStaff = getMergedMoodleStaffForIds([c.id]);
                  const isLoadingMoodle = Boolean(loadingStaffCourseIds?.has(c.id));
                  return (
                    <Fragment key={c.id}>
                      <div className="table-row">
                        <div>
                          <input
                            type="checkbox"
                            checked={activeTrackedIds.includes(c.id)}
                            onChange={() => handleToggle(c.id)}
                          />
                        </div>
                        <div>
                          <span className="course-code-span">{c.name.split('-')[0]}</span>
                          <p className="course-full-p">{c.name}</p>
                        </div>
                        <div>
                          <input
                            type="text"
                            className="nickname-input"
                            defaultValue={getCourseDisplayName(c.id, '')}
                            placeholder={t('nickname_placeholder')}
                            onBlur={(e) => onUpdateCustomName && onUpdateCustomName(c.id, e.target.value)}
                          />
                        </div>
                        {showStaffCols && onUpdatePanoptoStaff && (
                          <>
                            <CourseStaffHostColumnCell
                              courseId={c.id}
                              role="Lecture"
                              entries={staffEntries}
                              moodleStaff={moodleStaff}
                              detectedHosts={detectedHosts}
                              isLoadingMoodle={isLoadingMoodle}
                              onSaveEntries={onUpdatePanoptoStaff}
                              onRefreshFromMoodle={onImportCourseStaff ? (id) => onImportCourseStaff(id, true) : undefined}
                              t={t}
                              lang={lang}
                            />
                            <CourseStaffHostColumnCell
                              courseId={c.id}
                              role="Recitation"
                              entries={staffEntries}
                              moodleStaff={moodleStaff}
                              detectedHosts={detectedHosts}
                              isLoadingMoodle={isLoadingMoodle}
                              onSaveEntries={onUpdatePanoptoStaff}
                              onRefreshFromMoodle={onImportCourseStaff ? (id) => onImportCourseStaff(id, true) : undefined}
                              t={t}
                              lang={lang}
                            />
                          </>
                        )}
                        {showPanoptoCol && (
                          <div>
                            <input
                              type="text"
                              className="nickname-input panopto-folder-input"
                              value={localPanoptoMap[c.id] ?? ''}
                              placeholder={t('panopto_folder_placeholder')}
                              dir="ltr"
                              onChange={(e) => {
                                const val = e.target.value;
                                setLocalPanoptoMap((prev) => ({ ...prev, [c.id]: val }));
                              }}
                              onBlur={(e) => onUpdatePanopto && onUpdatePanopto(c.id, e.target.value)}
                            />
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <input
                            type="color"
                            className="color-picker"
                            value={getCourseColor(c.id)}
                            onChange={(e) => onUpdateColor && onUpdateColor(c.id, e.target.value)}
                          />
                          {panoptoEnabled && onUpdatePanoptoStaff && onImportCourseStaff && (
                            <button
                              type="button"
                              className={`secondary-btn btn-xs panopto-staff-toggle-btn ${isExpanded ? 'active' : ''}`}
                              onClick={() => setExpandedStaffCourseId(isExpanded ? null : c.id)}
                              title={t('panopto_staff_title')}
                            >
                              {t('panopto_staff_short_btn')} ({staffEntries.length})
                            </button>
                          )}
                        </div>
                      </div>
                      {panoptoEnabled && onUpdatePanoptoStaff && onImportCourseStaff && isExpanded && (
                        <div className="panopto-staff-table-drawer">
                          <PanoptoStaffEditor
                            courseId={c.id}
                            entries={staffEntries}
                            moodleStaff={moodleStaff}
                            detectedHosts={detectedHosts}
                            onSaveEntries={onUpdatePanoptoStaff}
                            onImportFromMoodle={(id) => onImportCourseStaff(id, true)}
                            t={t}
                            lang={lang}
                          />
                        </div>
                      )}
                    </Fragment>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="action-row" style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
        <button className="primary-btn" onClick={() => onSaveTrackedCourses && onSaveTrackedCourses(activeTrackedIds, localPanoptoMap)}>
          {t('save_tracking_options')}
        </button>
      </div>
    </>
  );
}

// 1. DASHBOARD TAB
function DashboardTab({
  assignments,
  meetings,
  token,
  getCourseColor,
  getCourseDisplayName,
  settings,
  t,
  lang,
  tourStep,
  onToggleMeetingInterest: _onToggleMeetingInterest,
  onSetCourseMeetingsVisibility: _onSetCourseMeetingsVisibility,
  showHiddenZoomCourseIds: _showHiddenZoomCourseIds,
  onToggleShowHiddenZoom: _onToggleShowHiddenZoom,
  trackedCourseIds,
  enrolledCourses: _enrolledCourses,
  onUpdateColor: _onUpdateColor,
  onUpdateCustomName: _onUpdateCustomName,
  onUpdatePanopto: _onUpdatePanopto,
  onSaveTrackedCourses: _onSaveTrackedCourses,
  onOpenManageCourses,
  onGoToCourse,
  onViewCourseAssignments,
  syncResult,
  onToggleCompleted,
  onToggleHidden,
  onLabDetected: _onLabDetected,
  hasGoogleTasksToken,
  googleTasksAuthError,
  onSyncGoogle,
  googleSyncLoading,
  onToggleRecordingWatched,
  groupedCoursesResult,
  hasPanoptoPermission = true,
  onRequestPanoptoPermission,
  localFsConfig,
  localFsStatus,
  onReconnectLocalFs,
}: {
  assignments: EnhancedAssignment[];
  meetings: ZoomMeeting[];
  token: string | null;
  settings: ExtensionSettings | null;
  tourStep?: number;
  onToggleMeetingInterest: (meetingNumber: string, allMeetingIds: string[]) => void;
  onSetCourseMeetingsVisibility?: (courseMeetings: ZoomMeeting[], makeVisible: boolean) => void;
  showHiddenZoomCourseIds?: Set<number>;
  onToggleShowHiddenZoom?: (courseId: number) => void;
  trackedCourseIds: number[];
  enrolledCourses?: any[];
  onUpdateColor?: (id: number, color: string) => void;
  onUpdateCustomName?: (id: number, name: string) => void;
  onUpdatePanopto?: (id: number, panoptoVal: string) => void;
  onSaveTrackedCourses?: (newIds: number[], panoptoOverrides?: Record<number, string>) => void;
  onOpenManageCourses?: () => void;
  onGoToCourse: (courseId: number) => void;
  onViewCourseAssignments: (courseId: number) => void;
  syncResult: SyncResult | null;
  onToggleCompleted?: (assignmentId: number | string) => void;
  onToggleHidden?: (assignmentId: number | string) => void;
  onLabDetected?: (id: number, name: string) => void;
  hasGoogleTasksToken?: boolean;
  googleTasksAuthError?: string | null;
  onSyncGoogle?: () => void;
  googleSyncLoading?: boolean;
  onToggleRecordingWatched?: (recordingId: string) => void;
  groupedCoursesResult?: GroupedCoursesResult;
  hasPanoptoPermission?: boolean;
  onRequestPanoptoPermission?: () => void;
  localFsConfig?: LocalFsConfig;
  localFsStatus?: LocalFsStatus;
  onReconnectLocalFs?: () => void;
} & TabProps) {
  const [expandedUpcomingId, setExpandedUpcomingId] = useState<number | null>(null);
  const [coursesViewMode, setCoursesViewMode] = useState<'list' | 'cards'>(() => {
    try {
      const saved = localStorage.getItem('noodle_courses_view_mode');
      return saved === 'list' ? 'list' : 'cards';
    } catch {
      return 'cards';
    }
  });

  const displayCourseIds = useMemo(() => {
    const multiPortalGroups = (groupedCoursesResult?.academicCourses || []).filter((u: any) => u.subCourses.length > 1);
    const absorbedChildIds = new Set<number>();
    for (const u of multiPortalGroups) {
      if (trackedCourseIds.includes(u.id)) {
        for (const s of u.subCourses) {
          if (s.courseId !== u.id && trackedCourseIds.includes(s.courseId)) {
            absorbedChildIds.add(s.courseId);
          }
        }
      }
    }
    return trackedCourseIds.filter((id) => !absorbedChildIds.has(id));
  }, [trackedCourseIds, groupedCoursesResult]);

  const handleSetCoursesViewMode = (mode: 'list' | 'cards') => {
    setCoursesViewMode(mode);
    try {
      localStorage.setItem('noodle_courses_view_mode', mode);
    } catch {
      // Ignore
    }
  };



  const visibleAssignments = assignments.filter((a) => !isActivityHidden(a, settings?.hiddenAssignments));
  const now = new Date();

  // Partition pending tasks to prioritize future -> no-deadline -> overdue (with deterministic tie-breakers)
  const pendingTasks = assignments
    .filter((a) => !isActivityHidden(a, settings?.hiddenAssignments) && !a.isCompleted)
    .sort((a, b) => {
      const aHasFuture = a.deadline && new Date(a.deadline) > now;
      const bHasFuture = b.deadline && new Date(b.deadline) > now;
      if (aHasFuture && !bHasFuture) return -1;
      if (!aHasFuture && bHasFuture) return 1;

      const aHasNoDl = !a.deadline;
      const bHasNoDl = !b.deadline;
      if (aHasNoDl && bHasNoDl) return a.id - b.id;
      if (aHasNoDl && !bHasNoDl) return -1;
      if (!aHasNoDl && bHasNoDl) return 1;

      const diff = new Date(a.deadline || 0).getTime() - new Date(b.deadline || 0).getTime();
      if (diff !== 0) return diff;
      return a.id - b.id;
    });

  // All actionable upcoming tasks (excluding hero)
  const upcomingTasks = pendingTasks;
  const selectedUpcomingTask = upcomingTasks.find((task) => task.id === expandedUpcomingId) || null;
  const isTaskSplitOpen = Boolean(selectedUpcomingTask);
  const selectedTaskColor = selectedUpcomingTask ? getCourseColor(selectedUpcomingTask.courseId) : 'var(--primary)';
  const selectedTaskCourseName = selectedUpcomingTask
    ? getCourseDisplayName(selectedUpcomingTask.courseId, selectedUpcomingTask.courseName)
    : '';
  const selectedTaskDueInfo = selectedUpcomingTask
    ? getDueTextAndClass(
      selectedUpcomingTask.deadline || null,
      lang,
      settings?.assignmentGreenDaysThreshold,
      settings?.assignmentYellowDaysThreshold,
      false,
      selectedUpcomingTask.status
    )
    : null;
  const selectedTaskSubjectFiles = selectedUpcomingTask
    ? (syncResult?.files || []).filter(
      (f) =>
        f.courseId === selectedUpcomingTask.courseId &&
        f.sectionName &&
        selectedUpcomingTask.sectionName &&
        f.sectionName.trim().toLowerCase() === selectedUpcomingTask.sectionName.trim().toLowerCase()
    )
    : [];
  const isSelectedTaskHidden = selectedUpcomingTask
    ? isActivityHidden(selectedUpcomingTask, settings?.hiddenAssignments)
    : false;
  const isSelectedTaskCompleted = selectedUpcomingTask ? Boolean(selectedUpcomingTask.isCompleted) : false;
  const hasAnySelectedTaskFiles = Boolean(
    (selectedUpcomingTask?.attachments && selectedUpcomingTask.attachments.length > 0) ||
    selectedTaskSubjectFiles.length > 0 ||
    (selectedUpcomingTask?.submittedFiles && selectedUpcomingTask.submittedFiles.length > 0)
  );

  // Active Zoom meetings right now (excluding hidden meetings, default is visible)
  const isMeetingVisible = (m: ZoomMeeting) => {
    return !isZoomMeetingHidden(m, settings?.hiddenZoomMeetings, settings?.interestedMeetings);
  };
  const activeMeetings = collapseRecurringMeetings(meetings, new Date()).filter((m) => (isZoomJoinUrl(m.meetingUrl, m.meetingNumber) || isZoomUrl(m.meetingUrl)) && getMeetingStatus(m.startTime) === 'active' && isMeetingVisible(m));

  // Semester progress calculation
  const totalAssignCount = visibleAssignments.length;
  const completedAssignCount = visibleAssignments.filter((a) => a.isCompleted).length;
  const semProgressPercent = totalAssignCount > 0 ? Math.round((completedAssignCount / totalAssignCount) * 100) : 0;

  // Panopto catch-up recordings (unwatched recordings for tracked courses, oldest first)
  const isPanoptoActive = !!settings?.panoptoEnabled;
  const watchedRecordingsSet = new Set(settings?.watchedRecordings || []);
  const trackedSet = new Set(trackedCourseIds);
  const allTrackedRecordings = (syncResult?.recordings || []).filter((r) => {
    if (!trackedSet.has(r.courseId)) return false;
    const configuredStaff =
      settings?.coursesPanoptoStaff?.[r.courseId] ||
      (settings?.coursesPanoptoStaff as Record<string, CoursePanoptoStaffEntry[]> | undefined)?.[String(r.courseId)];
    if (Array.isArray(configuredStaff) && configuredStaff.length > 0) {
      return doesRecordingMatchStaffEntries(r, configuredStaff);
    }
    return true;
  });
  const unwatchedCatchUpRecordings = allTrackedRecordings
    .filter((r) => !watchedRecordingsSet.has(r.id))
    .sort((a, b) => {
      if (!a.publishedDate && !b.publishedDate) return a.title.localeCompare(b.title);
      if (!a.publishedDate) return 1;
      if (!b.publishedDate) return -1;
      return a.publishedDate.localeCompare(b.publishedDate);
    });

  return (
    <div className="tab-dashboard">
      {settings?.googleTasksEnabled && (!hasGoogleTasksToken || googleTasksAuthError) && (
        <div
          className="google-tasks-auth-banner glass-panel"
          style={{
            marginBottom: '1rem',
            padding: '0.85rem 1.25rem',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            background: 'rgba(239, 68, 68, 0.1)',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.4rem' }}>⚠️</span>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--accent-red, #ef4444)' }}>
                {t('google_tasks_auth_warning_title')}
              </div>
              <div style={{ fontSize: '0.82rem', opacity: 0.85 }}>
                {t('google_tasks_auth_warning_desc')}
              </div>
            </div>
          </div>
          {onSyncGoogle && (
            <button
              className="primary-btn btn-sm"
              onClick={onSyncGoogle}
              disabled={googleSyncLoading}
              style={{ whiteSpace: 'nowrap' }}
            >
              {googleSyncLoading ? t('syncing') : t('connect_now')}
            </button>
          )}
        </div>
      )}

      {/* Panopto missing browser host permissions warning */}
      {isPanoptoActive && !hasPanoptoPermission && (
        <div
          className="panopto-perm-warning-banner glass-panel"
          style={{
            marginBottom: '1rem',
            padding: '0.85rem 1.25rem',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            background: 'rgba(245, 158, 11, 0.1)',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.4rem' }}>🎬</span>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--accent-orange, #f59e0b)' }}>
                {t('panopto_perm_needed_title')}
              </div>
              <div style={{ fontSize: '0.82rem', opacity: 0.85 }}>
                {t('panopto_perm_needed_desc')}
              </div>
            </div>
          </div>
          {onRequestPanoptoPermission && (
            <button
              className="primary-btn btn-sm"
              onClick={onRequestPanoptoPermission}
              style={{ whiteSpace: 'nowrap' }}
            >
              {t('panopto_grant_perm_btn')}
            </button>
          )}
        </div>
      )}

      {/* Local Filesystem Sync missing folder permission warning */}
      {localFsConfig?.enabled && localFsStatus?.state === 'needs_permission' && (
        <div
          className="local-fs-perm-warning-banner glass-panel"
          style={{
            marginBottom: '1rem',
            padding: '0.85rem 1.25rem',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            background: 'rgba(245, 158, 11, 0.1)',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.4rem' }}>📁</span>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--accent-orange, #f59e0b)' }}>
                {t('local_fs_perm_banner_title')}
              </div>
              <div style={{ fontSize: '0.82rem', opacity: 0.85 }}>
                {t('local_fs_perm_banner_desc')}
              </div>
            </div>
          </div>
          {onReconnectLocalFs && (
            <button
              type="button"
              className="primary-btn btn-sm"
              onClick={onReconnectLocalFs}
              style={{ whiteSpace: 'nowrap' }}
            >
              {t('local_fs_reconnect_btn')}
            </button>
          )}
        </div>
      )}

      {/* 1. Hero Action Strip: Upcoming To-Do Queue + Catch-Up Queue */}
      <div className={`hero-action-strip ${isPanoptoActive ? 'with-catchup' : ''} ${isTaskSplitOpen ? 'has-expanded-task' : ''} ${tourStep === 2 ? 'tour-highlight' : ''}`}>
        {/* Upcoming To-Do Queue (Splits horizontally into Master List + Course-Bordered Detail Pane when a task is selected) */}
        <div className={`queue-card glass-panel ${isTaskSplitOpen ? 'is-split' : ''}`}>
          <div className="queue-split-layout">
            <div className="queue-master-pane">
              <div className="queue-header">
                <div className="queue-title">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
                  <span>{t('upcoming_tasks')}</span>
                </div>
                <span className="queue-count">{upcomingTasks.length} {t('tasks_count')}</span>
              </div>

              <div className="queue-list">
                {upcomingTasks.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '1.5rem 0' }}>
                    {t('all_caught_up')}
                  </div>
                ) : (
                  upcomingTasks.map((task) => {
                    const color = getCourseColor(task.courseId);
                    const courseName = getCourseDisplayName(task.courseId, task.courseName);
                    const isExpanded = expandedUpcomingId === task.id;
                    const isClosestTask = pendingTasks.length > 0 && task.id === pendingTasks[0].id;
                    const { badgeClass, deadlineText } = getDueTextAndClass(
                      task.deadline || null,
                      lang,
                      settings?.assignmentGreenDaysThreshold,
                      settings?.assignmentYellowDaysThreshold,
                      false,
                      task.status
                    );

                    return (
                      <div
                        key={task.id}
                        className={`queue-item ${isClosestTask ? 'closest-task-glow closest-metallic-wave' : ''} ${isExpanded ? 'is-expanded' : ''}`}
                        style={isExpanded ? { borderColor: color, boxShadow: `inset 0 0 0 1px ${color}40` } : undefined}
                        onClick={() => setExpandedUpcomingId(isExpanded ? null : task.id)}
                      >
                        <div className="queue-item-main-row">
                          <div className="queue-item-left">
                            <span className="course-color-dot" style={{ backgroundColor: color }} />
                            <div className="queue-item-texts">
                              <div className="queue-item-course" style={{ color }}>{courseName}</div>
                              <div className="queue-item-name" title={task.name}>{task.name}</div>
                            </div>
                          </div>

                          <div className="queue-item-meta">
                            <span className={`badge ${badgeClass}`} style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>
                              {deadlineText}
                            </span>
                            {task.cutoffDate && hasGracePeriod(task) && (
                              <span
                                className="grace-period-clock-icon"
                                title={formatGracePeriodTooltip(task.cutoffDate, lang)}
                                aria-label={formatGracePeriodTooltip(task.cutoffDate, lang)}
                              >
                                <ClockIcon size={12} />
                              </span>
                            )}
                            {/* TODO(hide-task-button): Wire up click handler to hide/dismiss irrelevant or bonus tasks (e.g. via onToggleHidden / hiddenAssignments). */}
                            <button
                              type="button"
                              className="queue-delete-btn"
                              title={t('queue_delete_task_tooltip')}
                              aria-label={t('queue_delete_task_tooltip')}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                // TODO(hide-task-button): Dismiss/hide task on click instead of no-op once irrelevant-task hiding behavior is implemented.
                              }}
                            >
                              <TrashIcon size={13} />
                            </button>
                            <span
                              className="queue-item-chevron"
                              style={{
                                fontSize: '0.75rem',
                                color: isExpanded ? color : 'var(--text-muted)',
                                transform: isExpanded ? (lang === 'he' ? 'rotate(90deg)' : 'rotate(-90deg)') : 'none',
                                transition: 'transform 0.2s, color 0.2s',
                                display: 'inline-block',
                              }}
                            >
                              ▼
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {selectedUpcomingTask && (
              <div
                className="queue-detail-pane queue-item-expanded open"
                style={{
                  borderColor: selectedTaskColor,
                  borderInlineStartColor: selectedTaskColor,
                  '--detail-course-color': selectedTaskColor,
                } as React.CSSProperties}
                onClick={(ev) => ev.stopPropagation()}
              >
                {/* 1. Pinned Detail Header */}
                <div className="queue-detail-header">
                  <div className="queue-detail-top-bar">
                    <div className="queue-detail-course-group">
                      <span className="course-color-dot" style={{ backgroundColor: selectedTaskColor }} />
                      <span className="queue-detail-course-name" style={{ color: selectedTaskColor }} title={selectedTaskCourseName}>
                        {selectedTaskCourseName}
                      </span>
                      <span className="subject-pill">
                        <FolderIcon size={11} />
                        <span style={{ fontSize: '0.72rem' }}>
                          {selectedUpcomingTask.sectionName || (lang === 'he' ? 'כללי' : 'General')}
                        </span>
                      </span>
                    </div>

                    <div className="queue-detail-meta-right">
                      {selectedTaskDueInfo && (
                        <span className={`badge ${selectedTaskDueInfo.badgeClass}`} style={{ fontSize: '0.72rem', padding: '0.18rem 0.45rem' }}>
                          {selectedTaskDueInfo.deadlineText}
                        </span>
                      )}
                      {selectedUpcomingTask.cutoffDate && hasGracePeriod(selectedUpcomingTask) && (
                        <span
                          className="grace-period-clock-icon"
                          title={formatGracePeriodTooltip(selectedUpcomingTask.cutoffDate, lang)}
                          aria-label={formatGracePeriodTooltip(selectedUpcomingTask.cutoffDate, lang)}
                        >
                          <ClockIcon size={12} />
                        </span>
                      )}
                      <button
                        type="button"
                        className="queue-detail-close-btn"
                        onClick={() => setExpandedUpcomingId(null)}
                        title={lang === 'he' ? 'סגור' : 'Close'}
                        aria-label={lang === 'he' ? 'סגור' : 'Close'}
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  <div className="queue-detail-title" title={selectedUpcomingTask.name}>
                    {selectedUpcomingTask.name}
                  </div>
                </div>

                {/* 2. Scrollable Middle Body (Files) */}
                <div className="queue-detail-body">
                  {/* Attachments */}
                  {selectedUpcomingTask.attachments && selectedUpcomingTask.attachments.length > 0 && (
                    <div className="files-column-group" style={{ marginBottom: '0.5rem' }}>
                      <span className="files-column-label">
                        {t('attachments')}:
                      </span>
                      <div className="files-column-list">
                        {selectedUpcomingTask.attachments.map((att, attIdx) => {
                          const downloadUrl = buildFileDownloadUrl(att.url, token);
                          const openUrl = buildFileOpenUrl(att.url, token);
                          return (
                            <div key={attIdx} className="submitted-file-chip file-column-item" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'var(--border)' }}>
                              <span style={{ fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><FileIcon size={12} />{att.name}</span>
                              <div className="file-actions-group" style={{ display: 'flex', gap: '0.3rem', marginInlineStart: 'auto' }}>
                                <FileOpenAction
                                  rawUrl={att.url}
                                  openUrl={openUrl}
                                  fileName={att.name}
                                  token={token}
                                  t={t}
                                  lang={lang}
                                />
                                <a
                                  href={downloadUrl}
                                  download={att.name}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="file-action-btn file-download-btn"
                                  title={t('download_file')}
                                  aria-label={t('download_file')}
                                >
                                  <DownloadIcon size={12} />
                                </a>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Subject Files */}
                  {selectedTaskSubjectFiles.length > 0 && (
                    <div className="files-column-group" style={{ marginBottom: '0.5rem' }}>
                      <span className="files-column-label">
                        {t('subject_files')}:
                      </span>
                      <div className="files-column-list">
                        {selectedTaskSubjectFiles.map((sf, sfIdx) => {
                          const downloadUrl = buildFileDownloadUrl(sf.fileUrl, token);
                          const openUrl = buildFileOpenUrl(sf.fileUrl, token);
                          return (
                            <div key={sfIdx} className="submitted-file-chip file-column-item" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'var(--border)' }}>
                              <span style={{ fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}><FolderIcon size={13} style={{ opacity: 0.7, flexShrink: 0 }} /><span>{sf.fileName}</span></span>
                              <div className="file-actions-group" style={{ display: 'flex', gap: '0.3rem', marginInlineStart: 'auto' }}>
                                <FileOpenAction
                                  rawUrl={sf.fileUrl}
                                  openUrl={openUrl}
                                  fileName={sf.fileName}
                                  token={token}
                                  t={t}
                                  lang={lang}
                                />
                                <a
                                  href={downloadUrl}
                                  download={sf.fileName}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="file-action-btn file-download-btn"
                                  title={t('download_file')}
                                  aria-label={t('download_file')}
                                >
                                  <DownloadIcon size={12} />
                                </a>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Submitted Files */}
                  {selectedUpcomingTask.submittedFiles && selectedUpcomingTask.submittedFiles.length > 0 && (
                    <div className="files-column-group" style={{ marginBottom: '0.5rem' }}>
                      <span className="files-column-label">
                        {lang === 'he' ? 'קבצים שהוגשו:' : 'Submitted files:'}
                      </span>
                      <div className="files-column-list">
                        {selectedUpcomingTask.submittedFiles.map((att, attIdx) => {
                          const downloadUrl = buildFileDownloadUrl(att.url, token);
                          const openUrl = buildFileOpenUrl(att.url, token);
                          return (
                            <div key={`sub-${attIdx}`} className="submitted-file-chip file-column-item" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'var(--border)' }}>
                              <CheckIcon size={11} />
                              <span style={{ fontSize: '0.75rem' }}>{att.name}</span>
                              <div className="file-actions-group" style={{ display: 'flex', gap: '0.3rem', marginInlineStart: 'auto' }}>
                                <FileOpenAction
                                  rawUrl={att.url}
                                  openUrl={openUrl}
                                  fileName={att.name}
                                  token={token}
                                  t={t}
                                  lang={lang}
                                />
                                <a
                                  href={downloadUrl}
                                  download={att.name}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="file-action-btn file-download-btn"
                                  title={t('download_file')}
                                  aria-label={t('download_file')}
                                >
                                  <DownloadIcon size={12} />
                                </a>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {!hasAnySelectedTaskFiles && (
                    <div className="queue-detail-empty-files">
                      <FileIcon size={13} />
                      <span>{lang === 'he' ? 'אין קבצים מצורפים למטלה זו' : 'No attached files for this assignment'}</span>
                    </div>
                  )}
                </div>

                {/* 3. Pinned Action Footer */}
                <div className="card-expanded-toolbar queue-detail-footer">
                  <div className="toolbar-buttons-group" style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', width: '100%', justifyContent: 'flex-end' }}>
                    <button
                      className="btn-go-to-course btn-xs"
                      onClick={() => onGoToCourse(selectedUpcomingTask.courseId)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      <BookOpenIcon size={11} />
                      <span>{t('go_to_course')}</span>
                    </button>
                    <button
                      className="secondary-btn btn-xs"
                      onClick={() => onToggleCompleted && onToggleCompleted(selectedUpcomingTask.uid || getActivityUid(selectedUpcomingTask))}
                      title={
                        lang === 'he'
                          ? 'סימון ידני כבוצע (הגשות במודל מתעדכנות אוטומטית בסנכרון)'
                          : 'Mark done manually (Moodle submissions update automatically on sync)'
                      }
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                    >
                      <span>{isSelectedTaskCompleted ? t('mark_incomplete') : t('mark_done')}</span>
                    </button>
                    <button
                      className="secondary-btn btn-xs"
                      onClick={() => onToggleHidden && onToggleHidden(selectedUpcomingTask.uid || getActivityUid(selectedUpcomingTask))}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                    >
                      {isSelectedTaskHidden ? <EyeIcon size={11} /> : <EyeOffIcon size={11} />}
                      <span>{isSelectedTaskHidden ? t('unhide_assignment') : t('hide_assignment')}</span>
                    </button>
                    {selectedUpcomingTask.link && (
                      <a
                        href={selectedUpcomingTask.link}
                        target="_blank"
                        rel="noreferrer"
                        className="primary-btn btn-xs action-submit-btn"
                        data-moodle-link="true"
                      >
                        <span>{t('submit_assignment')}</span>
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 3rd Panel: Catch-Up Recordings Queue (Only when Panopto is enabled) */}
        {isPanoptoActive && (
          <div className="queue-card catchup-queue-card glass-panel">
            <div className="queue-header">
              <div className="queue-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                <span>{t('catch_up_title')}</span>
              </div>
              <span className="queue-count">{unwatchedCatchUpRecordings.length} {t('tasks_count')}</span>
            </div>

            <div className="queue-list">
              {unwatchedCatchUpRecordings.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '1.5rem 0' }}>
                  🎉 {t('all_recordings_watched')}
                </div>
              ) : (
                unwatchedCatchUpRecordings.map((rec) => {
                  const color = getCourseColor(rec.courseId);
                  const courseName = getCourseDisplayName(rec.courseId, rec.courseName || `Course ${rec.courseId}`);
                  const isRecitation = rec.type === 'Recitation';
                  const typeClass = isRecitation ? 'recitation' : 'lecture';
                  const typeLabel = isRecitation ? t('recitations') : t('lectures');

                  return (
                    <div key={rec.id} className="queue-item catchup-item">
                      <div className="queue-item-main-row">
                        <div className="queue-item-left">
                          {onToggleRecordingWatched && (
                            <button
                              className="quick-check-btn"
                              title={t('mark_done')}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                onToggleRecordingWatched(rec.id);
                              }}
                            >
                              <CheckIcon size={12} />
                            </button>
                          )}
                          <span className="course-color-dot" style={{ backgroundColor: color }} />
                          <div className="queue-item-texts">
                            <div className="queue-item-course" style={{ color }}>{courseName}</div>
                            <div className="queue-item-name" title={rec.title}>
                              <span className={`catchup-type-pill ${typeClass}`}>{typeLabel}</span>
                              {rec.title}
                            </div>
                          </div>
                        </div>

                        <div className="queue-item-meta" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          {rec.publishedDate && (
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              {rec.publishedDate}
                            </span>
                          )}
                          {rec.recordingUrl && (
                            <a
                              href={rec.recordingUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="file-action-btn"
                              style={{ color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.4)', padding: '0.15rem 0.4rem', fontSize: '0.72rem' }}
                              onClick={(ev) => ev.stopPropagation()}
                            >
                              {t('Watch now')}
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* 2. Multi-Active Zoom Sessions Strip */}
      {activeMeetings.length > 0 && (
        <div className={`multi-zoom-strip ${tourStep === 3 ? 'tour-highlight' : ''}`}>
          {activeMeetings.map((m, idx) => {
            const courseColor = getCourseColor(m.courseId);
            const courseDisplayName = getCourseDisplayName(m.courseId, m.courseName);
            return (
              <div key={idx} className="live-session-banner">
                <div className="live-session-left">
                  <div className="live-pulse-dot" />
                  <div>
                    <div className="live-session-title">
                      <span style={{ color: courseColor }}>{courseDisplayName}</span> — {m.title}
                    </div>
                    <div className="live-session-time">
                      {m.startTime ? `${t('starts_at')} ${new Date(m.startTime).toLocaleTimeString(lang === 'he' ? 'he-IL' : 'en-US', { hour: '2-digit', minute: '2-digit' })} · ` : ''}
                      <span style={{ color: '#10b981', fontWeight: 700 }}>● {t('active_now')}</span>
                    </div>
                  </div>
                </div>
                <a href={m.meetingUrl} target="_blank" rel="noreferrer" className="primary-btn btn-sm" style={{ background: '#10b981', border: 'none' }}>
                  <span>{t('join_zoom')}</span>
                </a>
              </div>
            );
          })}
        </div>
      )}

      {/* 3. Semester Cumulative Progress Bar */}
      {totalAssignCount > 0 && (
        <div className="progress-container glass-panel" style={{ marginBottom: '2rem', padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 600 }}>
            <span>{t('semester_progress')}</span>
            <span style={{ color: 'var(--primary)' }}>{completedAssignCount}/{totalAssignCount} ({semProgressPercent}%)</span>
          </div>
          <div className="progress-bar-bg" style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden' }}>
            <div
              className="progress-bar-fill"
              style={{
                width: `${semProgressPercent}%`,
                height: '100%',
                background: 'linear-gradient(90deg, var(--primary), var(--secondary))',
                transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)'
              }}
            />
          </div>
        </div>
      )}

      {/* 4. My Tracked Courses List Pane */}
      <div className="dashboard-section glass-panel" style={{ marginBottom: '2rem' }}>
        <div className={`courses-list-header ${tourStep === 4 ? 'tour-highlight' : ''}`}>
          <h3 style={{ margin: 0 }}>{t('my_courses')}</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
            <div className="view-mode-toggle-group" role="group" aria-label={lang === 'he' ? 'אופן תצוגה' : 'View mode'}>
              <button
                type="button"
                className={`view-mode-btn ${coursesViewMode === 'cards' ? 'active' : ''}`}
                onClick={() => handleSetCoursesViewMode('cards')}
                title={t('view_mode_cards')}
                aria-label={t('view_mode_cards')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7"></rect>
                  <rect x="14" y="3" width="7" height="7"></rect>
                  <rect x="14" y="14" width="7" height="7"></rect>
                  <rect x="3" y="14" width="7" height="7"></rect>
                </svg>
                <span>{t('view_mode_cards')}</span>
              </button>
              <button
                type="button"
                className={`view-mode-btn ${coursesViewMode === 'list' ? 'active' : ''}`}
                onClick={() => handleSetCoursesViewMode('list')}
                title={t('view_mode_list')}
                aria-label={t('view_mode_list')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6"></line>
                  <line x1="8" y1="12" x2="21" y2="12"></line>
                  <line x1="8" y1="18" x2="21" y2="18"></line>
                  <line x1="3" y1="6" x2="3.01" y2="6"></line>
                  <line x1="3" y1="12" x2="3.01" y2="12"></line>
                  <line x1="3" y1="18" x2="3.01" y2="18"></line>
                </svg>
                <span>{t('view_mode_list')}</span>
              </button>
            </div>

            <button
              type="button"
              className={`primary-btn btn-sm manage-courses-trigger-btn ${tourStep === 4 ? 'pulse-btn' : ''}`}
              onClick={() => onOpenManageCourses?.()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <BookOpenIcon size={13} />
              <span>{t('manage_courses')}</span>
            </button>
          </div>
        </div>

        <div className={`courses-rows-container ${coursesViewMode === 'cards' ? 'courses-cards-grid' : ''} ${(tourStep === 3 && activeMeetings.length === 0) || tourStep === 5 ? 'tour-highlight' : ''}`}>
          {displayCourseIds.length === 0 ? (
            <div className="empty-state">{t('empty_state_pending')}</div>
          ) : (
            displayCourseIds.map((cid, idx) => {
              const color = getCourseColor(cid);
              const courseAssigns = assignments.filter((a) => a.courseId === cid);
              const courseMeetings = meetings.filter((m) => m.courseId === cid && (isZoomJoinUrl(m.meetingUrl, m.meetingNumber) || isZoomUrl(m.meetingUrl)));

              // Breakdown: Assignments (exclude hidden tasks from active tracking & gaps count)
              const visibleCourseAssigns = courseAssigns.filter((a) => !isActivityHidden(a, settings?.hiddenAssignments));
              const totalAssigns = visibleCourseAssigns.length;
              const doneAssigns = visibleCourseAssigns.filter((a) => a.isCompleted).length;
              const gapAssigns = Math.max(0, totalAssigns - doneAssigns);

              // Breakdown: Panopto (Lectures and Recitations) — exclude hidden-host recordings from gaps & progress
              const rawCourseRecordings = isPanoptoActive ? (syncResult?.recordings || []).filter((r) => r.courseId === cid) : [];
              const courseStaffEntries =
                settings?.coursesPanoptoStaff?.[cid] ||
                (settings?.coursesPanoptoStaff as Record<string, CoursePanoptoStaffEntry[]> | undefined)?.[String(cid)] ||
                EMPTY_STAFF_ENTRIES;
              const courseRecordings = partitionPanoptoRecordingsByTrackedHosts(
                rawCourseRecordings,
                courseStaffEntries
              ).visible;
              const courseLectures = courseRecordings.filter((r) => r.type === 'Lecture');
              const totalLectures = courseLectures.length;
              const doneLectures = courseLectures.filter((r) => watchedRecordingsSet.has(r.id)).length;
              const gapLectures = Math.max(0, totalLectures - doneLectures);

              const courseRecitations = courseRecordings.filter((r) => r.type === 'Recitation');
              const totalRecitations = courseRecitations.length;
              const doneRecitations = courseRecitations.filter((r) => watchedRecordingsSet.has(r.id)).length;
              const gapRecitations = Math.max(0, totalRecitations - doneRecitations);

              // Overall Progress
              const totalItems = totalAssigns + (isPanoptoActive ? totalLectures + totalRecitations : 0);
              const doneItems = doneAssigns + (isPanoptoActive ? doneLectures + doneRecitations : 0);
              const overallPercent = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;

              const nowTs = now.getTime();
              const pendingCourseAssigns = courseAssigns
                .filter((a) => !a.isCompleted && !isActivityHidden(a, settings?.hiddenAssignments))
                .sort((a, b) => {
                  const aDue = a.deadline ? new Date(a.deadline).getTime() : null;
                  const bDue = b.deadline ? new Date(b.deadline).getTime() : null;
                  const aIsFuture = aDue !== null && aDue >= nowTs;
                  const bIsFuture = bDue !== null && bDue >= nowTs;

                  // 1. Future upcoming assignments come first (earliest deadline first)
                  if (aIsFuture && !bIsFuture) return -1;
                  if (!aIsFuture && bIsFuture) return 1;
                  if (aIsFuture && bIsFuture) return aDue! - bDue!;

                  // 2. Tasks without deadline come next
                  if (aDue === null && bDue !== null) return -1;
                  if (aDue !== null && bDue === null) return 1;
                  if (aDue === null && bDue === null) return a.id - b.id;

                  // 3. Past due assignments come last (most recent past-due first)
                  return bDue! - aDue!;
                });

              const nextTask = pendingCourseAssigns[0];
              const nextTaskName = nextTask ? nextTask.name : t('all_caught_up');
              const nextTaskDueInfo = nextTask?.deadline
                ? getDueTextAndClass(nextTask.deadline, lang, settings?.assignmentGreenDaysThreshold, settings?.assignmentYellowDaysThreshold, false, nextTask.status)
                : null;
              const nextTaskDue = nextTaskDueInfo ? nextTaskDueInfo.deadlineText : '';
              const nextTaskColorClass = nextTaskDueInfo?.timeColorClass || '';

              const rawCourseName = courseAssigns[0]?.courseName || courseMeetings[0]?.courseName || `Course ${cid}`;
              const courseDisplayName = getCourseDisplayName(cid, rawCourseName);

              return (
                <div
                  key={cid}
                  className={`course-row-card glass-panel ${coursesViewMode === 'cards' ? 'course-grid-card' : ''} ${tourStep === 3 && (trackedCourseIds?.[0] === cid || idx === 0) ? 'tour-highlight' : ''}`}
                  style={{ borderInlineStartColor: color, cursor: 'pointer' }}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('a, button, input')) return;
                    onGoToCourse(cid);
                  }}
                >
                  {coursesViewMode === 'cards' ? (
                    <div className="course-card-content">
                      {/* 1st row - title (+ real title) */}
                      <div className="course-card-row-top">
                        <div className="course-card-title-group">
                          <span className="course-color-dot" style={{ backgroundColor: color }} />
                          <div className="course-card-titles">
                            <h4 className="course-row-title" style={{ color }} title={courseDisplayName}>
                              {courseDisplayName}
                            </h4>
                            <span className="course-row-code" title={rawCourseName}>
                              {rawCourseName}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* 2nd row - Next Task + Assignments button */}
                      <div className="course-card-row-middle">
                        <div className="course-card-next-task" title={nextTask ? `${nextTaskName}${nextTaskDue ? ` (${nextTaskDue})` : ''}` : t('all_caught_up')}>
                          <span className="next-task-label">{t('next_assignment')}:</span>
                          <span className="next-task-name">{nextTaskName}</span>
                          {nextTaskDue && <span className="next-task-due">{nextTaskDue}</span>}
                        </div>

                        <button
                          type="button"
                          className="secondary-btn btn-sm course-card-assignments-btn"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onViewCourseAssignments(cid);
                          }}
                        >
                          <span>{t('view_assignments')}</span>
                        </button>
                      </div>

                      {/* 3rd row - Breakdown badges + overall progress bar */}
                      <div className="course-card-row-bottom">
                        <div className="course-card-gaps-container">
                          <div className="course-card-gaps">
                            <span
                              className={`course-stat-gap ${gapAssigns > 0 ? 'gap-pending' : 'gap-clear'}`}
                              title={`${t('assignments')}: ${doneAssigns}/${totalAssigns} (${gapAssigns})`}
                            >
                              {t('assignments')}: {gapAssigns}
                            </span>
                            {isPanoptoActive && (
                              <>
                                <span
                                  className={`course-stat-gap ${gapLectures > 0 ? 'gap-pending' : 'gap-clear'}`}
                                  title={`${t('lectures')}: ${doneLectures}/${totalLectures} (${gapLectures})`}
                                >
                                  {t('lectures')}: {gapLectures}
                                </span>
                                <span
                                  className={`course-stat-gap ${gapRecitations > 0 ? 'gap-pending' : 'gap-clear'}`}
                                  title={`${t('recitations')}: ${doneRecitations}/${totalRecitations} (${gapRecitations})`}
                                >
                                  {t('recitations')}: {gapRecitations}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="course-card-progress-box" title={`${t('overall_progress')}: ${doneItems}/${totalItems} (${overallPercent}%)`}>
                          <div className="course-prog-meta">
                            <span className="course-prog-percent">{doneItems}/{totalItems} ({overallPercent}%)</span>
                          </div>
                          <div className="course-prog-bar-bg">
                            <div className="course-prog-bar-fill" style={{ width: `${overallPercent}%`, backgroundColor: color }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="course-row-main">
                      {/* Course Title & Code */}
                      <div className="course-row-info">
                        <span className="course-color-dot" style={{ backgroundColor: color }} />
                        <div>
                          <h4 className="course-row-title" style={{ color }}>{courseDisplayName}</h4>
                          <span className="course-row-code">{rawCourseName}</span>
                        </div>
                      </div>

                      {/* Breakdown: Assignments (x/y) [z], Lectures (x/y) [z], Recitations (x/y) [z] */}
                      <div className="course-breakdown-row">
                        <div className="course-breakdown-stat" title={`${t('assignments')}: ${doneAssigns}/${totalAssigns} (${gapAssigns})`}>
                          <span className="stat-name">{t('assignments')}</span>
                          <span className="stat-count">({doneAssigns}/{totalAssigns})</span>
                          <span className={`course-stat-gap ${gapAssigns > 0 ? 'gap-pending' : 'gap-clear'}`}>
                            [{gapAssigns}]
                          </span>
                        </div>

                        {isPanoptoActive && (
                          <>
                            <div className="course-breakdown-stat" title={`${t('lectures')}: ${doneLectures}/${totalLectures} (${gapLectures})`}>
                              <span className="stat-name">{t('lectures')}</span>
                              <span className="stat-count">({doneLectures}/{totalLectures})</span>
                              <span className={`course-stat-gap ${gapLectures > 0 ? 'gap-pending' : 'gap-clear'}`}>
                                [{gapLectures}]
                              </span>
                            </div>

                            <div className="course-breakdown-stat" title={`${t('recitations')}: ${doneRecitations}/${totalRecitations} (${gapRecitations})`}>
                              <span className="stat-name">{t('recitations')}</span>
                              <span className="stat-count">({doneRecitations}/{totalRecitations})</span>
                              <span className={`course-stat-gap ${gapRecitations > 0 ? 'gap-pending' : 'gap-clear'}`}>
                                [{gapRecitations}]
                              </span>
                            </div>
                          </>
                        )}
                      </div>

                      {/* Overall Course Progress Bar */}
                      <div className="course-row-progress-box">
                        <div className="course-prog-meta">
                          <span>{t('overall_progress')}</span>
                          <span className="course-prog-percent">{doneItems}/{totalItems} ({overallPercent}%)</span>
                        </div>
                        <div className="course-prog-bar-bg">
                          <div className="course-prog-bar-fill" style={{ width: `${overallPercent}%`, backgroundColor: color }} />
                        </div>
                      </div>

                      {/* Next Assignment */}
                      <div className="course-row-next-assign">
                        <div className="label">{t('next_assignment')}</div>
                        <div className="name">{nextTaskName}</div>
                        {nextTaskDue && <div className={`due ${nextTaskColorClass}`}>{nextTaskDue}</div>}
                      </div>

                      {/* Course Actions */}
                      <div className="course-row-actions">
                        <button
                          className="secondary-btn btn-sm"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onViewCourseAssignments(cid);
                          }}
                        >
                          <span>{t('view_assignments')}</span>
                        </button>

                        <button
                          className="btn-go-to-course btn-sm"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onGoToCourse(cid);
                          }}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          <BookOpenIcon size={12} />
                          <span>{t('go_to_course')}</span>
                        </button>
                      </div>
                    </div>
                  )}

                </div>
              );
            })
          )}
        </div>
      </div>


    </div>
  );
}

function formatLocalDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseRecordingDateToKey(dateStr?: string): { date: Date; key: string } | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  const isoDateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateMatch) {
    const y = Number(isoDateMatch[1]);
    const m = Number(isoDateMatch[2]) - 1;
    const day = Number(isoDateMatch[3]);
    const d = new Date(y, m, day);
    if (!isNaN(d.getTime())) {
      return { date: d, key: formatLocalDateKey(d) };
    }
  }

  const dmyMatch = trimmed.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[\s,T]+(\d{1,2}):(\d{2}))?$/);
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const m = Number(dmyMatch[2]) - 1;
    const y = Number(dmyMatch[3]);
    const hh = dmyMatch[4] ? Number(dmyMatch[4]) : 0;
    const mm = dmyMatch[5] ? Number(dmyMatch[5]) : 0;
    const d = new Date(y, m, day, hh, mm);
    if (!isNaN(d.getTime()) && d.getDate() === day && d.getMonth() === m) {
      return { date: d, key: formatLocalDateKey(d) };
    }
  }

  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return null;
  return { date: parsed, key: formatLocalDateKey(parsed) };
}

interface CalendarScheduleItem {
  key: string;
  kind: 'assignment' | 'recording';
  courseId: number;
  courseName: string;
  title: string;
  dateKey: string;
  timeLabel?: string;
  subLabel?: string;
  typeBadge?: string;
  isDone?: boolean;
  isSelected?: boolean;
  graceTooltip?: string | null;
  onClick: () => void;
}

function ScheduleCalendarPane({
  items,
  overlayItems,
  overlayToggleLabel,
  showOverlay = false,
  onToggleOverlay,
  hintText,
  getCourseColor,
  t,
  lang,
}: {
  items: CalendarScheduleItem[];
  overlayItems?: CalendarScheduleItem[];
  overlayToggleLabel?: string;
  showOverlay?: boolean;
  onToggleOverlay?: (next: boolean) => void;
  hintText: string;
  getCourseColor: (courseId: number) => string;
  t: (key: any) => string;
  lang: 'he' | 'en';
}) {
  const [calendarViewMode, setCalendarViewMode] = useState<'month' | 'week'>(() => {
    try {
      return localStorage.getItem('noodle_calendar_view_mode') === 'week' ? 'week' : 'month';
    } catch {
      return 'month';
    }
  });
  const [calendarDate, setCalendarDate] = useState<Date>(() => new Date());

  const handleSetCalendarViewMode = (mode: 'month' | 'week') => {
    setCalendarViewMode(mode);
    try {
      localStorage.setItem('noodle_calendar_view_mode', mode);
    } catch {
      // ignore storage failures
    }
  };

  const now = new Date();
  const todayKey = formatLocalDateKey(now);
  const locale = lang === 'he' ? 'he-IL' : 'en-US';
  const weekdayLabels = lang === 'he'
    ? ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"]
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const combinedItems = useMemo(() => {
    if (showOverlay && overlayItems && overlayItems.length > 0) {
      return [...items, ...overlayItems];
    }
    return items;
  }, [items, overlayItems, showOverlay]);

  const itemsByDateKey = useMemo(() => {
    const map = new Map<string, CalendarScheduleItem[]>();
    for (const item of combinedItems) {
      if (!map.has(item.dateKey)) {
        map.set(item.dateKey, []);
      }
      map.get(item.dateKey)!.push(item);
    }
    return map;
  }, [combinedItems]);

  const calYear = calendarDate.getFullYear();
  const calMonthIdx = calendarDate.getMonth();

  // Monthly grid cells
  const firstDayOfWeek = new Date(calYear, calMonthIdx, 1).getDay();
  const daysInMonth = new Date(calYear, calMonthIdx + 1, 0).getDate();
  const daysInPrevMonth = new Date(calYear, calMonthIdx, 0).getDate();

  const monthCells: Array<{ date: Date; dayNumber: number; isCurrentMonth: boolean; isToday: boolean; items: CalendarScheduleItem[] }> = [];
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const dayNum = daysInPrevMonth - i;
    const cellDate = new Date(calYear, calMonthIdx - 1, dayNum);
    const key = formatLocalDateKey(cellDate);
    monthCells.push({
      date: cellDate,
      dayNumber: dayNum,
      isCurrentMonth: false,
      isToday: key === todayKey,
      items: itemsByDateKey.get(key) || [],
    });
  }
  for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
    const cellDate = new Date(calYear, calMonthIdx, dayNum);
    const key = formatLocalDateKey(cellDate);
    monthCells.push({
      date: cellDate,
      dayNumber: dayNum,
      isCurrentMonth: true,
      isToday: key === todayKey,
      items: itemsByDateKey.get(key) || [],
    });
  }
  const totalNeeded = monthCells.length > 35 ? 42 : 35;
  const remaining = totalNeeded - monthCells.length;
  for (let dayNum = 1; dayNum <= remaining; dayNum++) {
    const cellDate = new Date(calYear, calMonthIdx + 1, dayNum);
    const key = formatLocalDateKey(cellDate);
    monthCells.push({
      date: cellDate,
      dayNumber: dayNum,
      isCurrentMonth: false,
      isToday: key === todayKey,
      items: itemsByDateKey.get(key) || [],
    });
  }

  // Weekly grid cells (Sunday - Saturday of anchor date)
  const anchorMidnight = new Date(calYear, calMonthIdx, calendarDate.getDate());
  const weekStart = new Date(anchorMidnight);
  weekStart.setDate(anchorMidnight.getDate() - anchorMidnight.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const weekCells: Array<{ date: Date; weekdayLabel: string; isToday: boolean; items: CalendarScheduleItem[] }> = [];
  for (let offset = 0; offset < 7; offset++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + offset);
    const key = formatLocalDateKey(d);
    weekCells.push({
      date: d,
      weekdayLabel: weekdayLabels[offset],
      isToday: key === todayKey,
      items: itemsByDateKey.get(key) || [],
    });
  }

  const headerTitle = calendarViewMode === 'week'
    ? `${weekStart.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} – ${weekEnd.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : calendarDate.toLocaleDateString(locale, { month: 'long', year: 'numeric' });

  const handlePrev = () => {
    if (calendarViewMode === 'week') {
      setCalendarDate(new Date(calYear, calMonthIdx, calendarDate.getDate() - 7));
    } else {
      setCalendarDate(new Date(calYear, calMonthIdx - 1, 1));
    }
  };

  const handleNext = () => {
    if (calendarViewMode === 'week') {
      setCalendarDate(new Date(calYear, calMonthIdx, calendarDate.getDate() + 7));
    } else {
      setCalendarDate(new Date(calYear, calMonthIdx + 1, 1));
    }
  };

  const handleToday = () => {
    setCalendarDate(new Date());
  };

  return (
    <aside className="assignments-calendar-pane glass-panel">
      <div className="calendar-pane-header">
        <div className="calendar-month-title">{headerTitle}</div>
        <div className="calendar-pane-controls-group">
          <div className="calendar-mode-switcher" role="group">
            <button
              type="button"
              className={`calendar-mode-btn ${calendarViewMode === 'month' ? 'active' : ''}`}
              onClick={() => handleSetCalendarViewMode('month')}
            >
              {t('calendar_mode_month')}
            </button>
            <button
              type="button"
              className={`calendar-mode-btn ${calendarViewMode === 'week' ? 'active' : ''}`}
              onClick={() => handleSetCalendarViewMode('week')}
            >
              {t('calendar_mode_week')}
            </button>
          </div>
          <div className="calendar-nav-controls">
            <button
              type="button"
              className="calendar-nav-btn"
              onClick={handlePrev}
              title={calendarViewMode === 'week' ? t('prev_week') : t('prev_month')}
            >
              {lang === 'he' ? '▶' : '◀'}
            </button>
            <button
              type="button"
              className="calendar-today-btn"
              onClick={handleToday}
            >
              {t('today_btn')}
            </button>
            <button
              type="button"
              className="calendar-nav-btn"
              onClick={handleNext}
              title={calendarViewMode === 'week' ? t('next_week') : t('next_month')}
            >
              {lang === 'he' ? '◀' : '▶'}
            </button>
          </div>
        </div>
      </div>

      <div className="calendar-subtoolbar">
        <div className="calendar-hint-subtext">{hintText}</div>
        {overlayToggleLabel && onToggleOverlay && (
          <label className="calendar-overlay-toggle">
            <input
              type="checkbox"
              checked={showOverlay}
              onChange={(e) => onToggleOverlay(e.target.checked)}
            />
            <span>{overlayToggleLabel}</span>
          </label>
        )}
      </div>

      {calendarViewMode === 'month' ? (
        <>
          <div className="calendar-weekdays-row">
            {weekdayLabels.map((lbl, idx) => (
              <div key={idx} className="calendar-weekday-cell">
                {lbl}
              </div>
            ))}
          </div>

          <div className="calendar-days-grid">
            {monthCells.map((cell, idx) => (
              <div
                key={idx}
                className={`calendar-day-cell ${cell.isCurrentMonth ? '' : 'outside-month'} ${cell.isToday ? 'today is-today' : ''} ${cell.items.length > 0 ? 'has-items' : ''}`}
              >
                <div className="calendar-day-number">{cell.dayNumber}</div>
                <div className="calendar-day-items">
                  {cell.items.map((item) => {
                    const color = getCourseColor(item.courseId);
                    const metaBits = [item.timeLabel, item.subLabel, item.graceTooltip].filter(Boolean).join(' • ');
                    return (
                      <button
                        type="button"
                        key={item.key}
                        className={`calendar-assign-pill ${item.isSelected ? 'selected' : ''} ${item.isDone ? 'completed done' : ''} ${item.kind === 'recording' ? 'is-recording-pill' : ''}`}
                        style={{
                          borderInlineStartColor: color,
                          backgroundColor: item.isSelected ? `${color}33` : `${color}1a`,
                        }}
                        onClick={item.onClick}
                        title={`${item.courseName} — ${item.title}${metaBits ? ` (${metaBits})` : ''}`}
                      >
                        <span className="calendar-pill-dot" style={{ backgroundColor: color }} />
                        <span className="calendar-pill-text">{item.title}</span>
                        {item.graceTooltip && (
                          <span className="calendar-pill-clock" title={item.graceTooltip}>
                            <ClockIcon size={10} style={{ marginInlineStart: '3px', verticalAlign: '-1px', opacity: 0.85 }} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="calendar-week-scroll">
          <div className="calendar-week-grid">
            {weekCells.map((cell, idx) => (
              <div
                key={idx}
                className={`calendar-week-day-card ${cell.isToday ? 'today is-today' : ''} ${cell.items.length > 0 ? 'has-items' : ''}`}
              >
                <div className="calendar-week-day-header">
                  <span className="calendar-week-day-name">{cell.weekdayLabel}</span>
                  <span className="calendar-week-day-date">
                    {cell.date.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}
                  </span>
                </div>
                <div className="calendar-week-day-items">
                  {cell.items.map((item) => {
                    const color = getCourseColor(item.courseId);
                    return (
                      <button
                        type="button"
                        key={item.key}
                        className={`calendar-week-item-card ${item.isSelected ? 'selected' : ''} ${item.isDone ? 'completed done' : ''}`}
                        style={{
                          borderInlineStartColor: color,
                          backgroundColor: item.isSelected ? `${color}28` : `${color}12`,
                        }}
                        onClick={item.onClick}
                      >
                        <div className="calendar-week-item-top">
                          <span className="calendar-week-item-course" style={{ color }}>
                            {item.courseName}
                          </span>
                          {item.typeBadge && (
                            <span className="calendar-week-item-badge">{item.typeBadge}</span>
                          )}
                        </div>
                        <div className="calendar-week-item-title">{item.title}</div>
                        {(item.timeLabel || item.subLabel || item.graceTooltip) && (
                          <div className="calendar-week-item-meta">
                            {[item.timeLabel, item.subLabel].filter(Boolean).join(' • ')}
                            {item.graceTooltip && (
                              <span className="calendar-pill-clock" title={item.graceTooltip}>
                                <ClockIcon size={10} style={{ marginInlineStart: '3px', verticalAlign: '-1px', opacity: 0.85 }} />
                              </span>
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

// 2. ASSIGNMENTS TAB (Dedicated v4 Redesign Page)
function AssignmentsTab({
  assignments,
  recordings = [],
  files,
  token,
  getCourseColor,
  getCourseDisplayName,
  filterCourseId,
  onClearFilter,
  onGoToCourse,
  settings,
  t,
  lang,
  tourStep,
  onToggleCompleted,
  onToggleHidden,
  focusedAssignId,
  onClearFocusedAssign,
  onFocusRecording,
}: {
  assignments: EnhancedAssignment[];
  recordings?: PanoptoRecording[];
  files?: CourseFile[];
  token: string | null;
  filterCourseId: number | null;
  onClearFilter: () => void;
  onGoToCourse: (courseId: number) => void;
  settings: ExtensionSettings | null;
  tourStep?: number;
  onToggleCompleted?: (assignmentId: number | string) => void;
  onToggleHidden?: (assignmentId: number | string) => void;
  focusedAssignId?: number | null;
  onClearFocusedAssign?: () => void;
  onFocusRecording?: (recordingId: string) => void;
} & TabProps) {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterPending, setFilterPending] = useState<boolean>(true);
  const [filterPast, setFilterPast] = useState<boolean>(false);
  const [filterCompleted, setFilterCompleted] = useState<boolean>(false);
  const [filterHidden, setFilterHidden] = useState<boolean>(false);
  const [expandedAssignId, setExpandedAssignId] = useState<number | null>(null);
  const [alsoShowRecordings, setAlsoShowRecordings] = useState<boolean>(false);
  const [showCalendarView, setShowCalendarView] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('noodle_show_calendar_view');
      return saved === 'false' ? false : true;
    } catch {
      return true;
    }
  });

  const now = new Date();

  useEffect(() => {
    if (!focusedAssignId) return;
    const target = assignments.find((a) => a.id === focusedAssignId);
    if (target) {
      const refNow = new Date();
      const isHidden = isActivityHidden(target, settings?.hiddenAssignments);
      const isCompleted = Boolean(target.isCompleted);
      const hasDeadlinePassed = target.deadline ? new Date(target.deadline) < refNow : false;
      if (isHidden) setFilterHidden(true);
      if (!isHidden && isCompleted) setFilterCompleted(true);
      if (!isHidden && !isCompleted) {
        if (hasDeadlinePassed) setFilterPast(true);
        else setFilterPending(true);
      }
      setExpandedAssignId(target.id);
      setTimeout(() => {
        const el = document.getElementById(`assign-card-${target.id}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 60);
    }
    onClearFocusedAssign?.();
  }, [focusedAssignId, assignments, settings?.hiddenAssignments, onClearFocusedAssign]);

  const handleToggleHiddenWithFilter = (targetAssign: EnhancedAssignment) => {
    const isCurrentlyHidden = isActivityHidden(targetAssign, settings?.hiddenAssignments);
    if (isCurrentlyHidden) {
      const isCompleted = Boolean(targetAssign.isCompleted);
      const hasDeadlinePassed = targetAssign.deadline ? new Date(targetAssign.deadline) < now : false;
      if (isCompleted && !filterCompleted) {
        setFilterCompleted(true);
      } else if (!isCompleted) {
        if (hasDeadlinePassed && !filterPast) {
          setFilterPast(true);
        } else if (!hasDeadlinePassed && !filterPending) {
          setFilterPending(true);
        }
      }
    }
    onToggleHidden?.(targetAssign.id);
  };

  // Sort assignments by due date ascending
  const sortedAssigns = [...assignments].sort((a, b) => {
    if (!a.deadline && !b.deadline) return a.id - b.id;
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    const diff = new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    if (diff !== 0) return diff;
    return a.id - b.id;
  });

  const filteredAssigns = sortedAssigns.filter((a) => {
    if (filterCourseId && a.courseId !== filterCourseId) return false;

    const courseDisplayName = getCourseDisplayName(a.courseId, a.courseName).toLowerCase();
    const taskName = a.name.toLowerCase();
    const q = searchQuery.toLowerCase().trim();
    if (q && !taskName.includes(q) && !courseDisplayName.includes(q) && !a.courseName.toLowerCase().includes(q)) {
      return false;
    }

    const isHidden = isActivityHidden(a, settings?.hiddenAssignments);
    const isCompleted = Boolean(a.isCompleted);
    const hasDeadlinePassed = a.deadline ? new Date(a.deadline) < now : false;

    if (isHidden && filterHidden) return true;
    if (!isHidden && isCompleted && filterCompleted) return true;

    if (!isHidden && !isCompleted) {
      if (hasDeadlinePassed && filterPast) return true;
      if (!hasDeadlinePassed && filterPending) return true;
    }

    return false;
  });

  // Select an assignment from the Calendar View -> ensure its filter is enabled, expand it, and scroll to it
  const handleSelectCalendarAssignment = (a: EnhancedAssignment) => {
    const isHidden = isActivityHidden(a, settings?.hiddenAssignments);
    const isCompleted = Boolean(a.isCompleted);
    const hasDeadlinePassed = a.deadline ? new Date(a.deadline) < now : false;

    if (isHidden && !filterHidden) setFilterHidden(true);
    if (!isHidden && isCompleted && !filterCompleted) setFilterCompleted(true);
    if (!isHidden && !isCompleted) {
      if (hasDeadlinePassed && !filterPast) setFilterPast(true);
      if (!hasDeadlinePassed && !filterPending) setFilterPending(true);
    }

    setExpandedAssignId(a.id);
    setTimeout(() => {
      const el = document.getElementById(`assign-card-${a.id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 60);
  };

  // Build unified calendar items for Assignments & optional Recordings overlay
  const assignmentCalendarItems: CalendarScheduleItem[] = [];
  for (const item of filteredAssigns) {
    if (!item.deadline) continue;
    const d = new Date(item.deadline);
    if (isNaN(d.getTime())) continue;
    const dateKey = formatLocalDateKey(d);
    const courseName = getCourseDisplayName(item.courseId, item.courseName);
    const dueTimeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const graceTooltip = item.cutoffDate && hasGracePeriod(item)
      ? formatGracePeriodTooltip(item.cutoffDate, lang)
      : null;
    assignmentCalendarItems.push({
      key: `assign-${item.id}`,
      kind: 'assignment',
      courseId: item.courseId,
      courseName,
      title: item.name,
      dateKey,
      timeLabel: dueTimeStr,
      isDone: Boolean(item.isCompleted),
      isSelected: expandedAssignId === item.id,
      graceTooltip,
      onClick: () => handleSelectCalendarAssignment(item),
    });
  }

  const overlayRecordingItems: CalendarScheduleItem[] = [];
  if (alsoShowRecordings && settings?.panoptoEnabled) {
    const watchedSet = new Set(settings?.watchedRecordings || []);
    const hiddenRecSet = new Set(settings?.hiddenRecordings || []);
    for (const rec of recordings) {
      if (filterCourseId && rec.courseId !== filterCourseId) continue;
      if (hiddenRecSet.has(rec.id)) continue;
      const parsedDate = parseRecordingDateToKey(rec.publishedDate);
      if (!parsedDate) continue;
      const courseName = getCourseDisplayName(rec.courseId, rec.courseName);
      overlayRecordingItems.push({
        key: `rec-overlay-${rec.id}`,
        kind: 'recording',
        courseId: rec.courseId,
        courseName,
        title: rec.title,
        dateKey: parsedDate.key,
        subLabel: rec.host,
        typeBadge: rec.type === 'Recitation' ? t('panopto_recitation_badge') : t('panopto_lecture_badge'),
        isDone: watchedSet.has(rec.id),
        onClick: () => onFocusRecording?.(rec.id),
      });
    }
  }

  return (
    <div className="tab-assignments">
      {/* Filter Bar */}
      <div className={`filter-bar glass-panel ${tourStep === 6 ? 'tour-highlight' : ''}`} style={{ padding: '0.85rem 1.25rem' }}>
        <div className="search-input-box">
          <input
            type="text"
            className="search-input"
            placeholder={t('search_assignments_feed')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
          {/* 4 Filter Checkboxes */}
          <div className="filter-checkboxes">
            <label>
              <input
                type="checkbox"
                checked={filterPending}
                onChange={(e) => setFilterPending(e.target.checked)}
              />
              <span>{t('filter_todo')}</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={filterPast}
                onChange={(e) => setFilterPast(e.target.checked)}
              />
              <span>{t('filter_past')}</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={filterCompleted}
                onChange={(e) => setFilterCompleted(e.target.checked)}
              />
              <span>{t('filter_completed')}</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={filterHidden}
                onChange={(e) => setFilterHidden(e.target.checked)}
              />
              <span>{t('filter_hidden')}</span>
            </label>
          </div>

          {/* Toggle Calendar View Button */}
          <button
            type="button"
            className={`calendar-toggle-btn ${showCalendarView ? 'active' : ''}`}
            onClick={() => {
              setShowCalendarView((prev) => {
                const next = !prev;
                try {
                  localStorage.setItem('noodle_show_calendar_view', String(next));
                } catch {
                  // ignore
                }
                return next;
              });
            }}
            title={showCalendarView ? t('hide_calendar_view') : t('calendar_view')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span>{showCalendarView ? t('hide_calendar_view') : t('calendar_view')}</span>
          </button>
        </div>
      </div>

      {/* Course Filter Banner (When navigating from specific course) */}
      {filterCourseId && (
        <div
          className="glass-panel course-filter-banner"
          style={{ borderInlineStartColor: getCourseColor(filterCourseId) }}
        >
          <span>
            {t('filter_by_course')}{' '}
            <strong style={{ color: getCourseColor(filterCourseId) }}>
              {getCourseDisplayName(
                filterCourseId,
                assignments.find((a) => a.courseId === filterCourseId)?.courseName || `Course ${filterCourseId}`
              )}
            </strong>
          </span>
          <button className="file-action-btn" onClick={onClearFilter}>
            {t('clear_filter')}
          </button>
        </div>
      )}

      {/* Split Workspace: Assignments Feed (shrinks width when calendar open) + Calendar View Pane */}
      <div className={`assignments-workspace ${showCalendarView ? 'calendar-open' : ''}`}>
        {/* Assignments Feed */}
        <div className="assignments-feed assignments-list">
          {filteredAssigns.length === 0 ? (
            <div className="glass-panel empty-state" style={{ padding: '2.5rem', textAlign: 'center' }}>
              {t('no_assignments_match')}
            </div>
          ) : (
            filteredAssigns.map((a) => {
              const color = getCourseColor(a.courseId);
              const { badgeClass, deadlineText } = getDueTextAndClass(
                a.deadline || null,
                lang,
                settings?.assignmentGreenDaysThreshold,
                settings?.assignmentYellowDaysThreshold,
                false,
                a.status
              );
              const isCompleted = Boolean(a.isCompleted);
              const isHidden = isActivityHidden(a, settings?.hiddenAssignments);
              const isExpanded = expandedAssignId === a.id;
              const courseDisplayName = getCourseDisplayName(a.courseId, a.courseName);

              const subjectFiles = (files || []).filter(
                (f) =>
                  f.courseId === a.courseId &&
                  f.sectionName &&
                  a.sectionName &&
                  f.sectionName.trim().toLowerCase() === a.sectionName.trim().toLowerCase()
              );

              return (
                <div
                  key={a.id}
                  id={`assign-card-${a.id}`}
                  className={`assignment-card glass-panel clickable-card ${isExpanded ? 'expanded is-expanded' : ''} ${isHidden ? 'is-hidden' : ''}`}
                  style={{ borderInlineStartColor: color }}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('a, button, input')) return;
                    setExpandedAssignId(isExpanded ? null : a.id);
                  }}
                >
                  {/* Minimized compact row */}
                  <div className="assignment-card-compact-row">
                    <div className="assign-left-info">
                      <span className="course-color-dot" style={{ backgroundColor: color }} />
                      <span style={{ fontWeight: 700, color, fontSize: '0.85rem' }}>
                        {courseDisplayName}
                      </span>
                      <span className="assign-title-span" title={a.name}>
                        {a.name}
                      </span>
                      {isHidden && <span className="badge-hidden-tag">{t('hidden_tag')}</span>}
                      {!a.isCompleted && a.isMoodleSubmitted && (
                        <span className="assignment-tag tag-submitted" title={lang === 'he' ? 'הוגש במודל - סומן לביצוע' : 'Submitted in Moodle - marked as To Do'}>
                          {t('submitted_tag')}
                        </span>
                      )}
                    </div>

                    <div className="assign-right-meta">
                      {a.status === 'Submitted' ? (
                        <span className="badge badge-success">{lang === 'he' ? 'הוגש!' : 'Submitted!'}</span>
                      ) : a.isCompleted ? (
                        <span
                          className="badge badge-success"
                          style={{
                            background: 'rgba(16, 185, 129, 0.15)',
                            color: '#10b981',
                            borderColor: 'rgba(16, 185, 129, 0.3)',
                          }}
                        >
                          {t('marked_as_done')}
                        </span>
                      ) : (
                        <span className={`badge ${badgeClass}`}>{deadlineText}</span>
                      )}
                      {a.cutoffDate && hasGracePeriod(a) && (
                        <span
                          className="grace-period-clock-icon"
                          title={formatGracePeriodTooltip(a.cutoffDate, lang)}
                          aria-label={formatGracePeriodTooltip(a.cutoffDate, lang)}
                        >
                          <ClockIcon size={13} />
                        </span>
                      )}
                      {!a.isMoodleSubmitted && a.link && (
                        <a
                          href={a.link}
                          target="_blank"
                          rel="noreferrer"
                          className="primary-btn btn-xs action-submit-btn"
                          onClick={(ev) => ev.stopPropagation()}
                          data-moodle-link="true"
                        >
                          <span>{t('submit_in_moodle')}</span>
                        </a>
                      )}
                      {isCompleted && (
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#10b981' }}>✓</span>
                      )}
                      <button
                        className="card-chevron-btn btn-ghost"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setExpandedAssignId(isExpanded ? null : a.id);
                        }}
                        title={isExpanded ? (lang === 'he' ? 'צמצם' : 'Collapse') : (lang === 'he' ? 'הרחב' : 'Expand')}
                      >
                        <ChevronDownIcon size={14} expanded={isExpanded} />
                      </button>
                    </div>
                  </div>

                  {/* Expanded body (smoothly animated) */}
                  <div
                    className={`assignment-card-expanded-body expanded-subject-container ${isExpanded ? 'open' : ''}`}
                    style={{
                      maxHeight: isExpanded ? '600px' : '0px',
                      opacity: isExpanded ? 1 : 0,
                      overflow: 'hidden',
                      transition: 'max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease, margin 0.2s ease, padding 0.2s ease',
                      marginTop: isExpanded ? '0.75rem' : '0px',
                      paddingTop: isExpanded ? '0.75rem' : '0px',
                      borderTop: isExpanded ? '1px solid rgba(255, 255, 255, 0.08)' : 'none'
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Attachments */}
                    {a.attachments && a.attachments.length > 0 && (
                      <div className="files-column-group">
                        <span className="files-column-label">
                          {t('attachments')}:
                        </span>
                        <div className="files-column-list">
                          {a.attachments.map((att, attIdx) => {
                            const downloadUrl = buildFileDownloadUrl(att.url, token);
                            const openUrl = buildFileOpenUrl(att.url, token);
                            return (
                              <div key={attIdx} className="submitted-file-chip file-column-item" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'var(--border)' }}>
                                <span className="file-name" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}><FileIcon size={13} style={{ opacity: 0.7, flexShrink: 0 }} /><span>{att.name}</span></span>
                                <div className="file-actions-group" style={{ display: 'flex', gap: '0.35rem', marginInlineStart: 'auto' }}>
                                  <FileOpenAction
                                    rawUrl={att.url}
                                    openUrl={openUrl}
                                    fileName={att.name}
                                    token={token}
                                    t={t}
                                    lang={lang}
                                  />
                                  <a
                                    href={downloadUrl}
                                    download={att.name}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="file-action-btn file-download-btn"
                                    title={t('download_file')}
                                    aria-label={t('download_file')}
                                  >
                                    <DownloadIcon size={12} />
                                  </a>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Subject Files */}
                    {subjectFiles.length > 0 && (
                      <div className="files-column-group" style={{ marginTop: '0.4rem' }}>
                        <span className="files-column-label">
                          {t('subject_files')}:
                        </span>
                        <div className="files-column-list">
                          {subjectFiles.map((sf, sfIdx) => {
                            const downloadUrl = buildFileDownloadUrl(sf.fileUrl, token);
                            const openUrl = buildFileOpenUrl(sf.fileUrl, token);
                            return (
                              <div key={sfIdx} className="submitted-file-chip file-column-item" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'var(--border)' }}>
                                <span className="file-name" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}><FolderIcon size={13} style={{ opacity: 0.7, flexShrink: 0 }} /><span>{sf.fileName}</span></span>
                                <div className="file-actions-group" style={{ display: 'flex', gap: '0.35rem', marginInlineStart: 'auto' }}>
                                  <FileOpenAction
                                    rawUrl={sf.fileUrl}
                                    openUrl={openUrl}
                                    fileName={sf.fileName}
                                    token={token}
                                    t={t}
                                    lang={lang}
                                  />
                                  <a
                                    href={downloadUrl}
                                    download={sf.fileName}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="file-action-btn file-download-btn"
                                    title={t('download_file')}
                                    aria-label={t('download_file')}
                                  >
                                    <DownloadIcon size={12} />
                                  </a>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Submitted Files */}
                    {a.submittedFiles && a.submittedFiles.length > 0 && (
                      <div className="files-column-group" style={{ marginTop: '0.4rem' }}>
                        <span className="files-column-label">
                          {t('submitted_files')}:
                        </span>
                        <div className="files-column-list">
                          {a.submittedFiles.map((sub, sIdx) => {
                            const downloadUrl = buildFileDownloadUrl(sub.url, token);
                            const openUrl = buildFileOpenUrl(sub.url, token);
                            return (
                              <div key={`sub-${sIdx}`} className="submitted-file-chip file-column-item">
                                <span className="file-check-badge">
                                  <CheckIcon size={12} />
                                </span>
                                <span className="file-name">{sub.name}</span>
                                <div className="file-actions-group" style={{ display: 'flex', gap: '0.35rem', marginInlineStart: 'auto' }}>
                                  <FileOpenAction
                                    rawUrl={sub.url}
                                    openUrl={openUrl}
                                    fileName={sub.name}
                                    token={token}
                                    t={t}
                                    lang={lang}
                                  />
                                  <a
                                    href={downloadUrl}
                                    download={sub.name}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="file-action-btn file-download-btn"
                                    title={t('download_file')}
                                    aria-label={t('download_file')}
                                  >
                                    <DownloadIcon size={12} />
                                  </a>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Toolbar */}
                    <div className="card-expanded-toolbar">
                      <span className="subject-pill">
                        <FolderIcon size={13} />
                        <span className="subject-label">{t('subject_label')}:</span>
                        <span className="subject-val">{a.sectionName || (lang === 'he' ? 'כללי' : 'General')}</span>
                      </span>

                      <div className="toolbar-buttons-group">
                        <button
                          className="btn-go-to-course btn-xs"
                          onClick={() => onGoToCourse(a.courseId)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          <BookOpenIcon size={12} />
                          <span>{t('go_to_course')}</span>
                        </button>

                        <button
                          className="secondary-btn btn-xs"
                          onClick={() => onToggleCompleted && onToggleCompleted(a.uid || getActivityUid(a))}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          <CheckIcon size={12} />
                          <span>{isCompleted ? t('mark_incomplete') : t('mark_done')}</span>
                        </button>

                        <button
                          className="secondary-btn btn-xs"
                          onClick={() => handleToggleHiddenWithFilter(a)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          {isHidden ? <EyeIcon /> : <EyeOffIcon />}
                          <span>{isHidden ? t('unhide_assignment') : t('hide_assignment')}</span>
                        </button>

                        {a.link && (
                          <a
                            href={a.link}
                            target="_blank"
                            rel="noreferrer"
                            className="secondary-btn btn-xs"
                            data-moodle-link="true"
                          >
                            <span>{t('open_in_moodle')}</span>
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Interactive Calendar Side Pane */}
        {showCalendarView && (
          <ScheduleCalendarPane
            items={assignmentCalendarItems}
            overlayItems={overlayRecordingItems}
            overlayToggleLabel={settings?.panoptoEnabled ? t('calendar_also_show_recordings') : undefined}
            showOverlay={alsoShowRecordings}
            onToggleOverlay={setAlsoShowRecordings}
            hintText={t('calendar_click_hint')}
            getCourseColor={getCourseColor}
            t={t}
            lang={lang}
          />
        )}
      </div>
    </div>
  );
}

// 2B. RECORDINGS TAB
function RecordingsTab({
  recordings,
  assignments = [],
  trackedCourseIds = [],
  enrolledCourses = [],
  getCourseColor,
  getCourseDisplayName,
  onGoToCourse,
  settings,
  t,
  lang,
  onToggleRecordingWatched,
  onToggleRecordingHidden,
  onToggleTrackHost,
  hasPanoptoPermission = true,
  onRequestPanoptoPermission,
  onOpenSettings,
  focusedRecordingId,
  onClearFocusedRecording,
  onFocusAssignment,
}: {
  recordings: PanoptoRecording[];
  assignments?: EnhancedAssignment[];
  trackedCourseIds?: number[];
  enrolledCourses?: { id: number; fullname: string }[];
  onGoToCourse: (courseId: number) => void;
  settings: ExtensionSettings | null;
  onToggleRecordingWatched?: (recordingId: string) => void;
  onToggleRecordingHidden?: (recordingId: string) => void;
  onToggleTrackHost?: (courseId: number, hostName: string, recordingType: PanoptoRecordingType) => void;
  hasPanoptoPermission?: boolean;
  onRequestPanoptoPermission?: () => void;
  onOpenSettings?: () => void;
  focusedRecordingId?: string | null;
  onClearFocusedRecording?: () => void;
  onFocusAssignment?: (assignmentId: number) => void;
} & TabProps) {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCourseFilter, setSelectedCourseFilter] = useState<'all' | number>('all');
  const [filterUnwatched, setFilterUnwatched] = useState<boolean>(true);
  const [filterWatched, setFilterWatched] = useState<boolean>(false);
  const [filterLectures, setFilterLectures] = useState<boolean>(true);
  const [filterRecitations, setFilterRecitations] = useState<boolean>(true);
  const [filterHidden, setFilterHidden] = useState<boolean>(false);
  const [showHiddenDrawer, setShowHiddenDrawer] = useState<boolean>(false);
  const [activeFocusedRecId, setActiveFocusedRecId] = useState<string | null>(null);
  const [alsoShowAssignments, setAlsoShowAssignments] = useState<boolean>(false);
  const [showCalendarView, setShowCalendarView] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('noodle_show_recordings_calendar_view');
      return saved === 'false' ? false : true;
    } catch {
      return true;
    }
  });

  const watchedSet = useMemo(() => new Set(settings?.watchedRecordings || []), [settings?.watchedRecordings]);
  const manualHiddenSet = useMemo(() => new Set(settings?.hiddenRecordings || []), [settings?.hiddenRecordings]);

  const trackedRecordings = useMemo(() => {
    if (!trackedCourseIds || trackedCourseIds.length === 0) return recordings;
    const trackedSet = new Set(trackedCourseIds);
    return recordings.filter((r) => trackedSet.has(r.courseId));
  }, [recordings, trackedCourseIds]);

  // Partition tracked recordings by course host filters + manual hidden list
  const recordingPartition = useMemo(() => {
    const byCourse = new Map<number, PanoptoRecording[]>();
    for (const r of trackedRecordings) {
      if (!byCourse.has(r.courseId)) byCourse.set(r.courseId, []);
      byCourse.get(r.courseId)!.push(r);
    }
    const hiddenByHostSet = new Set<string>();
    for (const [cid, list] of byCourse.entries()) {
      const staffEntries =
        settings?.coursesPanoptoStaff?.[cid] ||
        (settings?.coursesPanoptoStaff as Record<string, CoursePanoptoStaffEntry[]> | undefined)?.[String(cid)];
      const partitioned = partitionPanoptoRecordingsByTrackedHosts(list, staffEntries);
      for (const h of partitioned.hidden) {
        hiddenByHostSet.add(h.id);
      }
    }
    return { hiddenByHostSet };
  }, [trackedRecordings, settings?.coursesPanoptoStaff]);

  const focusAndScrollToRecording = (recId: string) => {
    const target = trackedRecordings.find((r) => r.id === recId) || recordings.find((r) => r.id === recId);
    if (target) {
      const isRecHidden = manualHiddenSet.has(target.id) || recordingPartition.hiddenByHostSet.has(target.id);
      const isRecWatched = watchedSet.has(target.id);
      if (isRecHidden) setFilterHidden(true);
      if (!isRecHidden && isRecWatched) setFilterWatched(true);
      if (!isRecHidden && !isRecWatched) setFilterUnwatched(true);
      if (target.type === 'Recitation') setFilterRecitations(true);
      else setFilterLectures(true);
      if (selectedCourseFilter !== 'all' && selectedCourseFilter !== target.courseId) {
        setSelectedCourseFilter('all');
      }
    }
    setActiveFocusedRecId(recId);
    setTimeout(() => {
      const el = document.getElementById(`recording-card-${recId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 60);
    setTimeout(() => {
      setActiveFocusedRecId((curr) => (curr === recId ? null : curr));
    }, 2400);
  };

  useEffect(() => {
    if (!focusedRecordingId) return;
    focusAndScrollToRecording(focusedRecordingId);
    onClearFocusedRecording?.();
  }, [focusedRecordingId]);

  const sortedRecordings = useMemo(() => {
    return [...trackedRecordings].sort((a, b) => {
      const pa = parseRecordingDateToKey(a.publishedDate);
      const pb = parseRecordingDateToKey(b.publishedDate);
      const ta = pa ? pa.date.getTime() : 0;
      const tb = pb ? pb.date.getTime() : 0;
      if (tb !== ta) return tb - ta;
      return b.id.localeCompare(a.id);
    });
  }, [trackedRecordings]);

  const courseFilterOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of trackedRecordings) {
      if (!map.has(r.courseId)) {
        map.set(r.courseId, getCourseDisplayName(r.courseId, r.courseName));
      }
    }
    for (const c of enrolledCourses) {
      if (trackedCourseIds.length === 0 || trackedCourseIds.includes(c.id)) {
        if (!map.has(c.id)) {
          map.set(c.id, getCourseDisplayName(c.id, c.fullname));
        }
      }
    }
    return Array.from(map.entries())
      .map(([courseId, displayName]) => ({ courseId, displayName }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [trackedRecordings, enrolledCourses, trackedCourseIds, getCourseDisplayName]);

  const matchesBaseFilters = (r: PanoptoRecording): boolean => {
    if (selectedCourseFilter !== 'all' && r.courseId !== selectedCourseFilter) return false;
    const isRecitation = r.type === 'Recitation';
    if (isRecitation && !filterRecitations) return false;
    if (!isRecitation && !filterLectures) return false;

    const q = searchQuery.toLowerCase().trim();
    if (q) {
      const courseDisplayName = getCourseDisplayName(r.courseId, r.courseName).toLowerCase();
      const haystacks = [
        r.title.toLowerCase(),
        (r.host || '').toLowerCase(),
        (r.sectionName || '').toLowerCase(),
        courseDisplayName,
        r.courseName.toLowerCase(),
      ];
      if (!haystacks.some((h) => h.includes(q))) return false;
    }
    return true;
  };

  const filteredFeedRecordings = sortedRecordings.filter((r) => {
    if (!matchesBaseFilters(r)) return false;
    const isManuallyHidden = manualHiddenSet.has(r.id);
    const isHiddenByHost = recordingPartition.hiddenByHostSet.has(r.id);
    const isHidden = isManuallyHidden || isHiddenByHost;
    const isWatched = watchedSet.has(r.id);

    if (isHidden) {
      return filterHidden;
    }
    if (isWatched && filterWatched) return true;
    if (!isWatched && filterUnwatched) return true;
    return false;
  });

  const drawerHiddenRecordings = sortedRecordings.filter((r) => {
    if (!matchesBaseFilters(r)) return false;
    return manualHiddenSet.has(r.id) || recordingPartition.hiddenByHostSet.has(r.id);
  });

  const recordingCalendarItems: CalendarScheduleItem[] = [];
  for (const rec of sortedRecordings) {
    if (!matchesBaseFilters(rec)) continue;
    const isHidden = manualHiddenSet.has(rec.id) || recordingPartition.hiddenByHostSet.has(rec.id);
    if (isHidden && !filterHidden) continue;
    const isWatched = watchedSet.has(rec.id);
    if (!isHidden) {
      if (isWatched && !filterWatched) continue;
      if (!isWatched && !filterUnwatched) continue;
    }
    const parsedDate = parseRecordingDateToKey(rec.publishedDate);
    if (!parsedDate) continue;
    const courseName = getCourseDisplayName(rec.courseId, rec.courseName);
    recordingCalendarItems.push({
      key: `rec-${rec.id}`,
      kind: 'recording',
      courseId: rec.courseId,
      courseName,
      title: rec.title,
      dateKey: parsedDate.key,
      subLabel: rec.host,
      typeBadge: rec.type === 'Recitation' ? t('panopto_recitation_badge') : t('panopto_lecture_badge'),
      isDone: isWatched,
      isSelected: activeFocusedRecId === rec.id,
      onClick: () => focusAndScrollToRecording(rec.id),
    });
  }

  const overlayAssignmentItems: CalendarScheduleItem[] = [];
  if (alsoShowAssignments) {
    for (const a of assignments) {
      if (selectedCourseFilter !== 'all' && a.courseId !== selectedCourseFilter) continue;
      if (isActivityHidden(a, settings?.hiddenAssignments)) continue;
      if (!a.deadline) continue;
      const d = new Date(a.deadline);
      if (isNaN(d.getTime())) continue;
      const dateKey = formatLocalDateKey(d);
      const courseName = getCourseDisplayName(a.courseId, a.courseName);
      const dueTimeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const graceTooltip = a.cutoffDate && hasGracePeriod(a)
        ? formatGracePeriodTooltip(a.cutoffDate, lang)
        : null;
      overlayAssignmentItems.push({
        key: `assign-overlay-${a.id}`,
        kind: 'assignment',
        courseId: a.courseId,
        courseName,
        title: a.name,
        dateKey,
        timeLabel: dueTimeStr,
        typeBadge: t('assignments'),
        isDone: Boolean(a.isCompleted),
        graceTooltip,
        onClick: () => onFocusAssignment?.(a.id),
      });
    }
  }

  if (!settings?.panoptoEnabled) {
    return (
      <div className="tab-recordings">
        <div className="glass-panel empty-state panopto-disabled-empty-card" style={{ padding: '3rem 2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.85rem' }}>
          <div style={{ opacity: 0.75, color: 'var(--primary)' }}>
            <VideoIcon size={38} />
          </div>
          <h3 style={{ margin: 0 }}>{t('panopto_disabled_tab_title')}</h3>
          <p style={{ margin: 0, maxWidth: '460px', color: 'var(--text-secondary)' }}>
            {t('panopto_disabled_tab_desc')}
          </p>
          {onOpenSettings && (
            <button type="button" className="primary-btn" onClick={onOpenSettings}>
              {t('open_settings_btn')}
            </button>
          )}
        </div>
      </div>
    );
  }

  const renderRecordingCard = (rec: PanoptoRecording) => {
    const color = getCourseColor(rec.courseId);
    const courseDisplayName = getCourseDisplayName(rec.courseId, rec.courseName);
    const isWatched = watchedSet.has(rec.id);
    const isManuallyHidden = manualHiddenSet.has(rec.id);
    const isHiddenByHost = recordingPartition.hiddenByHostSet.has(rec.id);
    const isHidden = isManuallyHidden || isHiddenByHost;
    const isRecitation = rec.type === 'Recitation';
    const isFocused = activeFocusedRecId === rec.id;

    const coursePanoptoStaffEntries =
      settings?.coursesPanoptoStaff?.[rec.courseId] ||
      (settings?.coursesPanoptoStaff as Record<string, CoursePanoptoStaffEntry[]> | undefined)?.[String(rec.courseId)] ||
      [];
    const isHostTracked =
      Boolean(rec.host) &&
      doesRecordingMatchStaffEntries({ host: rec.host }, coursePanoptoStaffEntries);

    return (
      <div
        key={rec.id}
        id={`recording-card-${rec.id}`}
        className={`assignment-card glass-panel recording-feed-card ${isWatched ? 'is-watched' : ''} ${isHidden ? 'is-hidden' : ''} ${isFocused ? 'focused-pulse' : ''}`}
        style={{ borderInlineStartColor: color }}
      >
        <div className="assignment-card-compact-row">
          <div className="assign-left-info" style={{ flexWrap: 'wrap' }}>
            <button
              type="button"
              className="course-chip-btn"
              onClick={() => onGoToCourse(rec.courseId)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                borderColor: `${color}55`,
                color,
                background: `${color}12`,
                padding: '0.18rem 0.5rem',
                borderRadius: '6px',
                borderWidth: '1px',
                borderStyle: 'solid',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <BookOpenIcon size={12} />
              <span>{courseDisplayName}</span>
            </button>

            <span className={`recording-type-tag ${isRecitation ? 'type-recitation' : 'type-lecture'}`}>
              {isRecitation ? t('panopto_recitation_badge') : t('panopto_lecture_badge')}
            </span>

            {isHidden && <span className="badge-hidden-tag">{t('panopto_hidden_tag')}</span>}

            <span className="assign-title-span" title={rec.title} style={{ fontWeight: 600 }}>
              {rec.title}
            </span>
          </div>

          <div className="assign-right-meta" style={{ flexWrap: 'wrap' }}>
            {rec.host && (
              <span className="recording-host-badge">{rec.host}</span>
            )}
            {rec.publishedDate && (
              <span className="recording-date-badge">{rec.publishedDate}</span>
            )}
            {rec.sectionName && (
              <span className="recording-section-meta" style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                <FolderIcon size={11} />
                <span>{rec.sectionName}</span>
              </span>
            )}
          </div>
        </div>

        <div className="recording-feed-card-footer">
          <div className="recording-actions" style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
            {rec.host && onToggleTrackHost && (
              <button
                type="button"
                className={`file-action-btn recording-track-host-btn ${isHostTracked ? 'tracking' : ''}`}
                onClick={() => onToggleTrackHost(rec.courseId, rec.host!, rec.type)}
                title={isHostTracked ? t('panopto_tracking_host') : t('panopto_track_host')}
              >
                {isHostTracked ? <EyeIcon size={12} /> : <EyeOffIcon size={12} />}
                <span>{isHostTracked ? t('panopto_tracking_host') : t('panopto_track_host')}</span>
              </button>
            )}

            {onToggleRecordingWatched && (
              <button
                type="button"
                className={`file-action-btn recording-watched-btn ${isWatched ? 'watched' : ''}`}
                onClick={() => onToggleRecordingWatched(rec.id)}
                title={isWatched ? t('watched_done') : t('mark_watched')}
              >
                <CheckIcon size={12} />
                <span>{isWatched ? t('watched_done') : t('mark_watched')}</span>
              </button>
            )}

            {rec.recordingUrl && (
              <a
                href={rec.recordingUrl}
                target="_blank"
                rel="noreferrer"
                className="primary-btn btn-xs"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', textDecoration: 'none' }}
              >
                <VideoIcon size={12} />
                <span>{t('watch_recording')}</span>
              </a>
            )}

            {onToggleRecordingHidden && (
              <button
                type="button"
                className={`queue-delete-btn ${isManuallyHidden ? 'is-restore' : ''}`}
                onClick={() => onToggleRecordingHidden(rec.id)}
                title={isManuallyHidden ? t('unhide_recording') : t('hide_recording')}
                aria-label={isManuallyHidden ? t('unhide_recording') : t('hide_recording')}
              >
                {isManuallyHidden ? <EyeIcon size={14} /> : <TrashIcon size={14} />}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="tab-recordings tab-assignments">
      {!hasPanoptoPermission && (
        <div className="glass-panel panopto-permission-banner" style={{ marginBottom: '0.9rem', padding: '0.85rem 1.15rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <strong>{t('panopto_perm_needed_title')}</strong>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
              {t('panopto_perm_needed_desc')}
            </div>
          </div>
          {onRequestPanoptoPermission && (
            <button type="button" className="primary-btn btn-sm" onClick={onRequestPanoptoPermission}>
              {t('panopto_grant_perm_btn')}
            </button>
          )}
        </div>
      )}

      {/* Filter Bar */}
      <div className="filter-bar glass-panel" style={{ padding: '0.85rem 1.25rem' }}>
        <div className="search-input-box" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
          <input
            type="text"
            className="search-input"
            placeholder={t('search_recordings_feed')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ flex: '1 1 220px' }}
          />
          <select
            className="recordings-course-select"
            value={selectedCourseFilter === 'all' ? 'all' : String(selectedCourseFilter)}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedCourseFilter(val === 'all' ? 'all' : Number(val));
            }}
            aria-label={t('all_courses_filter')}
          >
            <option value="all">{t('all_courses_filter')}</option>
            {courseFilterOptions.map((opt) => (
              <option key={opt.courseId} value={String(opt.courseId)}>
                {opt.displayName}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1.15rem', flexWrap: 'wrap' }}>
          <div className="filter-checkboxes">
            <label>
              <input
                type="checkbox"
                checked={filterUnwatched}
                onChange={(e) => setFilterUnwatched(e.target.checked)}
              />
              <span>{t('filter_unwatched')}</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={filterWatched}
                onChange={(e) => setFilterWatched(e.target.checked)}
              />
              <span>{t('filter_watched')}</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={filterLectures}
                onChange={(e) => setFilterLectures(e.target.checked)}
              />
              <span>{t('lectures')}</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={filterRecitations}
                onChange={(e) => setFilterRecitations(e.target.checked)}
              />
              <span>{t('recitations')}</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={filterHidden}
                onChange={(e) => setFilterHidden(e.target.checked)}
              />
              <span>{t('filter_hidden')}</span>
            </label>
          </div>

          <button
            type="button"
            className={`calendar-toggle-btn ${showCalendarView ? 'active' : ''}`}
            onClick={() => {
              setShowCalendarView((prev) => {
                const next = !prev;
                try {
                  localStorage.setItem('noodle_show_recordings_calendar_view', String(next));
                } catch {
                  // ignore
                }
                return next;
              });
            }}
            title={showCalendarView ? t('hide_calendar_view') : t('calendar_view')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span>{showCalendarView ? t('hide_calendar_view') : t('calendar_view')}</span>
          </button>
        </div>
      </div>

      {/* Split Workspace: Recordings Feed + Weekly/Monthly Calendar */}
      <div className={`assignments-workspace ${showCalendarView ? 'calendar-open' : ''}`}>
        <div className="assignments-feed assignments-list">
          {filteredFeedRecordings.length === 0 ? (
            <div className="glass-panel empty-state" style={{ padding: '2.5rem', textAlign: 'center' }}>
              {drawerHiddenRecordings.length > 0 && !filterHidden
                ? t('panopto_all_recordings_hidden')
                : t('no_recordings_match')}
            </div>
          ) : (
            filteredFeedRecordings.map(renderRecordingCard)
          )}

          {!filterHidden && drawerHiddenRecordings.length > 0 && (
            <div className="panopto-hidden-recordings-wrapper" style={{ marginTop: '0.75rem' }}>
              <button
                type="button"
                className="panopto-hidden-toggle-btn"
                onClick={() => setShowHiddenDrawer((prev) => !prev)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '0.45rem 0.85rem',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                }}
              >
                <ChevronDownIcon size={14} expanded={showHiddenDrawer} />
                <span>
                  {showHiddenDrawer ? t('panopto_hide_hidden_recordings') : t('panopto_show_hidden_recordings')} ({drawerHiddenRecordings.length})
                </span>
              </button>
              {showHiddenDrawer && (
                <div className="panopto-hidden-recordings-drawer" style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  {drawerHiddenRecordings.map(renderRecordingCard)}
                </div>
              )}
            </div>
          )}
        </div>

        {showCalendarView && (
          <ScheduleCalendarPane
            items={recordingCalendarItems}
            overlayItems={overlayAssignmentItems}
            overlayToggleLabel={t('calendar_also_show_assignments')}
            showOverlay={alsoShowAssignments}
            onToggleOverlay={setAlsoShowAssignments}
            hintText={t('calendar_recording_click_hint')}
            getCourseColor={getCourseColor}
            t={t}
            lang={lang}
          />
        )}
      </div>
    </div>
  );
}





// 4. GRADES TAB
function GradesTab({
  assignments,
  excludedCourseIds,
  settings,
  getCourseColor,
  getCourseDisplayName,
  t,
  lang,
  tourStep,
}: {
  assignments: Assignment[];
  excludedCourseIds?: Set<number>;
  settings?: ExtensionSettings | null;
  tourStep?: number;
} & TabProps) {
  const { overallGpa, courseGroups, totalCalculatedItems } = useMemo(() => {
    return calculateGradesSummary({
      assignments,
      hiddenIdentifiers: settings?.hiddenAssignments,
      completedIdentifiers: settings?.completedAssignments,
      uncompletedIdentifiers: settings?.uncompletedAssignments,
      excludedCourseIds,
    });
  }, [assignments, settings?.hiddenAssignments, settings?.completedAssignments, settings?.uncompletedAssignments, excludedCourseIds]);

  return (
    <div className="tab-grades">
      <div className="grades-calc-notice glass-panel">
        <svg
          className="grades-calc-notice-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span className="grades-calc-notice-text">
          {t('grades_policy_note')}
        </span>
      </div>

      <div className="gpa-card-container">
        <div className={`stat-card glass-panel border-left-secondary ${tourStep === 7 ? 'tour-highlight' : ''}`} style={{ maxWidth: '300px' }}>
          <span className="stat-title">{t('gpa_title')}</span>
          <span className="stat-val">{overallGpa}</span>
          <p className="subtitle">{t('unweighted_average')}</p>
        </div>
      </div>

      {totalCalculatedItems === 0 ? (
        <div className="empty-state glass-panel">{t('empty_state_grades')}</div>
      ) : (
        <div className="grades-grouped-list">
          {Object.entries(courseGroups).map(([courseIdStr, group]) => {
            const courseId = Number(courseIdStr);
            const color = getCourseColor(courseId);
            return (
              <div key={courseId} className="course-grades-group glass-panel" style={{ borderLeft: `4px solid ${color}` }}>
                <div className="group-header">
                  <h4 style={{ color }}>{getCourseDisplayName(courseId, group.courseName)}</h4>
                  <span className="course-avg-badge">{t('course_average_label')}: {group.average}</span>
                </div>

                <div className="grades-table">
                  {group.list.map((a) => (
                    <div key={a.id} className="grade-row" style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="grade-assign-name">
                          {a.name}
                          {a.isBonus && (
                            <span className="badge" style={{ marginInlineStart: '0.4rem', background: 'rgba(234, 179, 8, 0.15)', color: '#eab308', borderColor: 'rgba(234, 179, 8, 0.3)', fontSize: '0.72rem', padding: '0.1rem 0.4rem' }}>
                              {t('grades_bonus_label') || (lang === 'he' ? 'בונוס' : 'Bonus')}
                            </span>
                          )}
                        </span>
                        <span className="grade-value-span">
                          {a.effectiveGrade} / {a.effectiveGradeMax}
                        </span>
                      </div>
                      {a.feedback && (
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', paddingInlineStart: '0.5rem', borderInlineStart: '2px solid #10b981' }}>
                          {a.feedback}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 5. SETTINGS TAB
function SettingsTab({
  settings,
  onToggleGoogle,
  onUpdateListName,
  onSyncGoogle,
  onExportConfig,
  onImportConfig,
  googleSyncLoading,
  googleSyncStatus,
  hasGoogleTasksToken,
  googleTasksAuthError,
  syncResult,
  onDisconnectClick,
  onToggleSyncWithoutDeadline,
  onUpdateGoogleClientId,
  t,
  lang,
  onUpdateLanguage,
  onUpdateTheme,
  onUpdateTimeThemeHours,
  onOpenManageCourses,
  onUpdateThresholds,
  onTogglePanopto,
  onTogglePanoptoFolderOverride,
  onToggleNotifications,
  onAddMockCourse,
  tourStep,
  dashboardMaxWidth,
  onUpdateDashboardWidth,
  onResetDashboardWidth,
  onUpdateSyncInterval,
  hasPanoptoPermission = true,
  onRequestPanoptoPermission,
  localFsConfig,
  localFsStatus,
  onLocalFsConfigChanged,
  onShowToast,
}: {
  settings: ExtensionSettings | null;
  onToggleGoogle: (e: boolean) => void;
  onUpdateListName: (name: string) => void;
  onSyncGoogle: () => void;
  onExportConfig: () => void;
  onImportConfig: (file: File) => void;
  googleSyncLoading: boolean;
  googleSyncStatus: string | null;
  hasGoogleTasksToken?: boolean;
  googleTasksAuthError?: string | null;
  syncResult?: SyncResult | null;
  onDisconnectClick?: () => void;
  onToggleSyncWithoutDeadline?: (enabled: boolean) => void;
  onUpdateGoogleClientId?: (id: string) => void;
  onUpdateLanguage: (l: 'he' | 'en') => void;
  onUpdateTheme: (theme: 'dark' | 'noodle' | 'coffee' | 'time') => void;
  onUpdateTimeThemeHours?: (start: number, end: number) => void;
  onOpenManageCourses?: () => void;
  onUpdateThresholds: (green: number, yellow: number) => void;
  onTogglePanopto?: (enabled: boolean) => void;
  onTogglePanoptoFolderOverride?: (enabled: boolean) => void;
  onToggleNotifications?: (enabled: boolean) => void;
  onAddMockCourse?: () => void;
  t: (key: any) => string;
  lang: 'he' | 'en';
  tourStep?: number;
  dashboardMaxWidth?: number;
  onUpdateDashboardWidth?: (width: number) => void;
  onResetDashboardWidth?: () => void;
  onUpdateSyncInterval?: (val: number) => void;
  hasPanoptoPermission?: boolean;
  onRequestPanoptoPermission?: () => void;
  localFsConfig?: LocalFsConfig;
  localFsStatus?: LocalFsStatus;
  onLocalFsConfigChanged?: (cfg: LocalFsConfig) => void;
  onShowToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  if (!settings) return null;

  const [localWidth, setLocalWidth] = useState<number>(dashboardMaxWidth || 1200);

  useEffect(() => {
    setLocalWidth(dashboardMaxWidth || 1200);
  }, [dashboardMaxWidth]);

  const [showAdvancedGoogle, setShowAdvancedGoogle] = useState<boolean>(false);
  const [manualToken, setManualToken] = useState<string>('');
  const [tokenSavedToast, setTokenSavedToast] = useState<boolean>(false);
  const [copiedRedirect, setCopiedRedirect] = useState<boolean>(false);
  const redirectUri = getGoogleOAuthRedirectUrl();

  return (
    <div className="tab-settings glass-panel">
      <h3>{t('integration_settings')}</h3>
      <p className="subtitle" style={{ marginBottom: '2rem' }}>
        {lang === 'he'
          ? 'הגדר אינטגרציות חיצוניות, תדירות סנכרון והעדפות התראה.'
          : 'Configure external integrations, sync intervals, and notification preferences.'}
      </p>

      {/* Language Selection Section */}
      <div className="settings-section">
        <h4>{t('language_label')}</h4>
        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
          <select
            className="settings-text-input"
            value={lang}
            onChange={(e) => onUpdateLanguage(e.target.value as 'he' | 'en')}
            style={{ maxWidth: '200px', cursor: 'pointer' }}
          >
            <option value="he">עברית (Hebrew)</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      {/* Theme Selection Section */}
      <div className="settings-section" style={{ marginTop: '1.5rem' }}>
        <h4>{lang === 'he' ? 'ערכת נושא' : 'Theme'}</h4>
        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
          <select
            className="settings-text-input"
            value={settings.theme || 'noodle'}
            onChange={(e) => onUpdateTheme(e.target.value as 'dark' | 'noodle' | 'coffee' | 'time')}
            style={{ maxWidth: '280px', cursor: 'pointer' }}
          >
            <option value="noodle">{lang === 'he' ? 'נודל (Noodle)' : 'Noodle'}</option>
            <option value="coffee">{lang === 'he' ? 'קפה (Coffee)' : 'Coffee'}</option>
            <option value="dark">{lang === 'he' ? 'כהה (Dark)' : 'Dark'}</option>
            <option value="time">{t('theme_time')}</option>
          </select>
        </div>
        {settings.theme === 'time' && (
          <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'rgba(255, 255, 255, 0.03)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
            <p className="subtitle" style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem' }}>
              {t('theme_time_desc')}
            </p>
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
              <div>
                <label htmlFor="theme-time-start" style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.82rem' }}>
                  {t('theme_time_noodle_start')}
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <input
                    type="number"
                    id="theme-time-start"
                    min={0}
                    max={23}
                    className="settings-text-input"
                    style={{ width: '70px' }}
                    value={settings.themeTimeDayStart ?? 7}
                    onChange={(e) => {
                      const val = Math.max(0, Math.min(23, parseInt(e.target.value) || 0));
                      onUpdateTimeThemeHours?.(val, settings.themeTimeDayEnd ?? 17);
                    }}
                  />
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>:00</span>
                </div>
              </div>
              <div>
                <label htmlFor="theme-time-end" style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.82rem' }}>
                  {t('theme_time_coffee_start')}
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <input
                    type="number"
                    id="theme-time-end"
                    min={0}
                    max={23}
                    className="settings-text-input"
                    style={{ width: '70px' }}
                    value={settings.themeTimeDayEnd ?? 17}
                    onChange={(e) => {
                      const val = Math.max(0, Math.min(23, parseInt(e.target.value) || 0));
                      onUpdateTimeThemeHours?.(settings.themeTimeDayStart ?? 7, val);
                    }}
                  />
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>:00</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Dashboard Width Section */}
      <div className="settings-section" style={{ marginTop: '1.5rem' }}>
        <h4>{t('dashboard_width_title')}</h4>
        <p className="subtitle" style={{ margin: '0.3rem 0 0.75rem 0' }}>
          {t('dashboard_width_desc')}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <input
            type="range"
            className="settings-range-slider"
            min={760}
            max={2560}
            step={20}
            value={localWidth}
            onChange={(e) => setLocalWidth(parseInt(e.target.value, 10))}
            onPointerUp={() => onUpdateDashboardWidth && onUpdateDashboardWidth(localWidth)}
            onMouseUp={() => onUpdateDashboardWidth && onUpdateDashboardWidth(localWidth)}
            onTouchEnd={() => onUpdateDashboardWidth && onUpdateDashboardWidth(localWidth)}
            onKeyUp={(e) => {
              if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) {
                onUpdateDashboardWidth && onUpdateDashboardWidth(localWidth);
              }
            }}
            style={{
              width: '220px',
              cursor: 'pointer',
              ['--slider-pct' as string]: `${Math.max(0, Math.min(100, ((localWidth - 760) / (2560 - 760)) * 100))}%`,
            }}
          />
          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.9rem', minWidth: '65px' }}>
            {localWidth}px
          </span>
          {onResetDashboardWidth && (
            <button
              type="button"
              className="secondary-btn btn-sm"
              onClick={() => {
                onResetDashboardWidth();
                setLocalWidth(1200);
              }}
              title={t('reset_to_default_width')}
            >
              {t('reset_to_default_width')}
            </button>
          )}
        </div>
      </div>

      <hr className="settings-divider" />

      {/* Due Date Colors Thresholds Section */}
      <div className="settings-section">
        <h4>{t('due_dates_colors_title')}</h4>
        <p className="subtitle" style={{ marginBottom: '1rem' }}>
          {t('due_dates_colors_desc')}
        </p>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <div>
            <label htmlFor="green-threshold" style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem' }}>
              {t('green_threshold_label')}
            </label>
            <input
              type="number"
              id="green-threshold"
              className="settings-text-input"
              style={{ width: '80px' }}
              value={settings.assignmentGreenDaysThreshold ?? 7}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 0;
                onUpdateThresholds(val, settings.assignmentYellowDaysThreshold ?? 3);
              }}
            />
          </div>
          <div>
            <label htmlFor="yellow-threshold" style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem' }}>
              {t('yellow_threshold_label')}
            </label>
            <input
              type="number"
              id="yellow-threshold"
              className="settings-text-input"
              style={{ width: '80px' }}
              value={settings.assignmentYellowDaysThreshold ?? 3}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 0;
                onUpdateThresholds(settings.assignmentGreenDaysThreshold ?? 7, val);
              }}
            />
          </div>
        </div>
      </div>

      <hr className="settings-divider" />

      {/* Manage Tracked Courses Section */}
      <div className="settings-section">
        <h4>{t('manage_courses')}</h4>
        <p className="subtitle" style={{ marginBottom: '1rem' }}>
          {t('manage_courses_desc')}
        </p>
        <div>
          <button
            type="button"
            className="secondary-btn btn-sm"
            onClick={onOpenManageCourses}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <BookOpenIcon size={13} />
            <span>{t('manage_courses')}</span>
          </button>
        </div>
      </div>

      <hr className="settings-divider" />

      {/* Configuration Backup Section */}
      <div className="settings-section">
        <h4>{t('config_backup_title')}</h4>
        <p className="subtitle" style={{ marginBottom: '1rem' }}>
          {t('config_backup_desc')}
        </p>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button className="primary-btn btn-sm" onClick={onExportConfig} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <DownloadIcon size={13} />
            <span>{t('export_config_btn')}</span>
          </button>
          <label className="secondary-btn btn-sm" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', margin: 0 }}>
            <UploadIcon size={13} />
            <span>{t('import_config_btn')}</span>
            <input
              type="file"
              accept=".json"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  onImportConfig(e.target.files[0]);
                }
              }}
              style={{ display: 'none' }}
            />
          </label>
        </div>
      </div>

      <hr className="settings-divider" />

      {/* Google Tasks Section */}
      <div className={`settings-section google-tasks-section ${tourStep === 8 ? 'tour-highlight' : ''}`}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <h4 style={{ margin: 0 }}>{t('google_tasks_sync_title')}</h4>
          {settings.googleTasksEnabled && (
            <span
              style={{
                fontSize: '0.8rem',
                padding: '0.2rem 0.6rem',
                borderRadius: 'var(--radius-full, 9999px)',
                fontWeight: 600,
                background: hasGoogleTasksToken && !googleTasksAuthError ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                color: hasGoogleTasksToken && !googleTasksAuthError ? 'var(--accent-green, #22c55e)' : 'var(--accent-red, #ef4444)',
                border: `1px solid ${hasGoogleTasksToken && !googleTasksAuthError ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              }}
            >
              {hasGoogleTasksToken && !googleTasksAuthError ? t('google_tasks_status_connected') : t('google_tasks_status_not_connected')}
            </span>
          )}
        </div>
        <div className="toggle-row">
          <div>
            <span className="toggle-label">{t('google_tasks_sync_title')}</span>
            <p className="subtitle">{t('google_tasks_sync_desc')}</p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.googleTasksEnabled}
              onChange={(e) => onToggleGoogle(e.target.checked)}
            />
            <span className="slider round"></span>
          </label>
        </div>

        {settings.googleTasksEnabled && (
          <div className="google-subsettings" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
            {(!hasGoogleTasksToken || googleTasksAuthError) && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.75rem 1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--accent-red, #ef4444)' }}>
                    {t('google_tasks_auth_warning_title')}
                  </div>
                  <div style={{ fontSize: '0.82rem', opacity: 0.85 }}>
                    {t('google_tasks_auth_warning_desc')}
                  </div>
                </div>
                <button className="primary-btn btn-sm" onClick={onSyncGoogle} disabled={googleSyncLoading}>
                  {googleSyncLoading ? t('syncing') : t('connect_now')}
                </button>
              </div>
            )}

            <div>
              <label htmlFor="tasks-list-name" style={{ display: 'block', marginBottom: '0.3rem' }}>{t('google_tasks_list_name_label')}</label>
              <input
                type="text"
                id="tasks-list-name"
                className="settings-text-input"
                value={settings.googleTasksListName}
                onChange={(e) => onUpdateListName(e.target.value)}
              />
            </div>

            {/* Sync assignments without deadline toggle */}
            <div className="toggle-row" style={{ marginTop: '0.25rem', padding: '0.25rem 0' }}>
              <div>
                <span className="toggle-label" style={{ fontSize: '0.92rem' }}>{t('sync_without_deadline_title')}</span>
                <p className="subtitle" style={{ fontSize: '0.82rem', marginTop: '0.2rem' }}>{t('sync_without_deadline_desc')}</p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  id="sync-without-deadline-toggle"
                  checked={settings.syncWithoutDeadline ?? false}
                  onChange={(e) => onToggleSyncWithoutDeadline && onToggleSyncWithoutDeadline(e.target.checked)}
                />
                <span className="slider round"></span>
              </label>
            </div>

            {/* Advanced Google Settings Section */}
            <div style={{ marginTop: '0.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
              <button
                type="button"
                className="btn-ghost"
                style={{
                  fontSize: '0.85rem',
                  color: 'var(--text-muted)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.3rem 0',
                  cursor: 'pointer',
                  background: 'none',
                  border: 'none',
                }}
                onClick={() => setShowAdvancedGoogle(!showAdvancedGoogle)}
              >
                <ChevronDownIcon size={14} expanded={showAdvancedGoogle} />
                <span>{t('advanced_google_settings')}</span>
              </button>

              {showAdvancedGoogle && (
                <div
                  style={{
                    marginTop: '0.75rem',
                    padding: '1rem',
                    borderRadius: 'var(--radius-md)',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.85rem',
                  }}
                >
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.3rem' }}>
                      {t('authorized_redirect_uri')}
                    </label>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <input
                        type="text"
                        readOnly
                        value={redirectUri}
                        className="settings-text-input"
                        style={{ fontSize: '0.8rem', fontFamily: 'monospace', flex: 1, background: 'rgba(0, 0, 0, 0.2)' }}
                      />
                      <button
                        type="button"
                        className="secondary-btn btn-sm"
                        onClick={() => {
                          navigator.clipboard.writeText(redirectUri);
                          setCopiedRedirect(true);
                          setTimeout(() => setCopiedRedirect(false), 2000);
                        }}
                        style={{ whiteSpace: 'nowrap' }}
                      >
                        {copiedRedirect ? t('copied_btn') : t('copy_btn')}
                      </button>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem', lineHeight: '1.4' }}>
                      {t('redirect_uri_help')}
                    </p>
                  </div>

                  <div>
                    <label htmlFor="custom-google-client-id" style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.3rem' }}>
                      {t('custom_client_id_label')}
                    </label>
                    <input
                      type="text"
                      id="custom-google-client-id"
                      className="settings-text-input"
                      placeholder="your-client-id.apps.googleusercontent.com"
                      value={settings.googleClientId || ''}
                      onChange={(e) => onUpdateGoogleClientId && onUpdateGoogleClientId(e.target.value)}
                      style={{ fontSize: '0.82rem' }}
                    />
                  </div>

                  <div>
                    <label htmlFor="manual-google-token" style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.3rem' }}>
                      {t('manual_token_label')}
                    </label>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <input
                        type="password"
                        id="manual-google-token"
                        className="settings-text-input"
                        placeholder={t('manual_token_placeholder')}
                        value={manualToken}
                        onChange={(e) => setManualToken(e.target.value)}
                        style={{ fontSize: '0.82rem', flex: 1 }}
                      />
                      <button
                        type="button"
                        className="secondary-btn btn-sm"
                        disabled={!manualToken.trim()}
                        onClick={async () => {
                          if (!manualToken.trim()) return;
                          await browser.storage.local.set({
                            googleAccessToken: manualToken.trim(),
                            googleTokenExpiry: Date.now() + 3600 * 1000,
                          });
                          setTokenSavedToast(true);
                          setTimeout(() => setTokenSavedToast(false), 2500);
                          onSyncGoogle();
                        }}
                        style={{ whiteSpace: 'nowrap' }}
                      >
                        {tokenSavedToast ? t('token_saved') : t('save_and_sync_btn')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="tasks-action-row">
              <button className="primary-btn btn-sm" onClick={onSyncGoogle} disabled={googleSyncLoading}>
                {googleSyncLoading
                  ? t('syncing')
                  : hasGoogleTasksToken && !googleTasksAuthError
                    ? t('sync_tasks_now')
                    : t('auth_sync_google')}
              </button>
            </div>

            {googleSyncStatus && <div className="status-message">{googleSyncStatus}</div>}
          </div>
        )}
      </div>

      <hr className="settings-divider" />

      {/* Automatic Sync Interval Section */}
      <div className="settings-section">
        <h4>{t('sync_interval_title')}</h4>
        <p className="subtitle" style={{ margin: '0.3rem 0 0.75rem 0' }}>
          {t('sync_interval_desc')}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' }}>
          <select
            className="settings-text-input"
            value={settings.syncIntervalMinutes ?? 60}
            onChange={(e) => onUpdateSyncInterval && onUpdateSyncInterval(parseInt(e.target.value, 10))}
            style={{ maxWidth: '240px', cursor: 'pointer' }}
          >
            <option value={1}>{t('sync_interval_1m')}</option>
            <option value={5}>{t('sync_interval_5m')}</option>
            <option value={10}>{t('sync_interval_10m')}</option>
            <option value={15}>{t('sync_interval_15m')}</option>
            <option value={30}>{t('sync_interval_30m')}</option>
            <option value={60}>{t('sync_interval_60m')}</option>
            <option value={120}>{t('sync_interval_120m')}</option>
          </select>
        </div>
      </div>

      <hr className="settings-divider" />

      <div className="settings-section">
        <h4>{t('desktop_notifications_title')}</h4>
        <div className="toggle-row">
          <div>
            <span className="toggle-label">{t('desktop_notifications_title')}</span>
            <p className="subtitle">{t('desktop_notifications_desc')}</p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.notificationsEnabled}
              onChange={async (e) => {
                if (onToggleNotifications) {
                  onToggleNotifications(e.target.checked);
                } else {
                  await setSettings({ notificationsEnabled: e.target.checked });
                }
              }}
            />
            <span className="slider round"></span>
          </label>
        </div>
      </div>

      <hr className="settings-divider" />

      <div className="settings-section">
        <h4>
          {t('panopto_enabled_title')}
        </h4>
        <div className="toggle-row">
          <div>
            <span className="toggle-label">
              {t('panopto_enabled_title')}
            </span>
            <p className="subtitle">{t('panopto_enabled_desc')}</p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              id="panopto-enabled-toggle"
              checked={settings.panoptoEnabled ?? false}
              onChange={async (e) => {
                if (onTogglePanopto) {
                  onTogglePanopto(e.target.checked);
                } else {
                  await setSettings({ panoptoEnabled: e.target.checked });
                }
              }}
            />
            <span className="slider round"></span>
          </label>
        </div>

        {settings.panoptoEnabled && (
          <div className="toggle-row" style={{ marginTop: '0.5rem', padding: '0.25rem 0' }}>
            <div>
              <span className="toggle-label" style={{ fontSize: '0.92rem' }}>
                {t('panopto_manual_override_setting_title')}
              </span>
              <p className="subtitle" style={{ fontSize: '0.82rem', marginTop: '0.2rem' }}>
                {t('panopto_manual_override_setting_desc')}
              </p>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                id="panopto-folder-override-toggle"
                checked={settings.showPanoptoFolderOverride ?? false}
                onChange={async (e) => {
                  if (onTogglePanoptoFolderOverride) {
                    onTogglePanoptoFolderOverride(e.target.checked);
                  } else {
                    await setSettings({ showPanoptoFolderOverride: e.target.checked });
                  }
                }}
              />
              <span className="slider round"></span>
            </label>
          </div>
        )}
        {settings.panoptoEnabled && !hasPanoptoPermission && (
          <div
            style={{
              marginTop: '0.75rem',
              background: 'rgba(245, 158, 11, 0.12)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              borderRadius: 'var(--radius-md)',
              padding: '0.75rem 1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
            }}
          >
            <div>
              <div style={{ fontWeight: 600, color: 'var(--accent-orange, #f59e0b)', fontSize: '0.88rem' }}>
                ⚠️ {t('panopto_perm_needed_title')}
              </div>
              <div style={{ fontSize: '0.8rem', opacity: 0.85, marginTop: '0.2rem' }}>
                {t('panopto_perm_needed_desc')}
              </div>
            </div>
            {onRequestPanoptoPermission && (
              <button
                type="button"
                className="primary-btn btn-sm"
                onClick={onRequestPanoptoPermission}
                style={{ whiteSpace: 'nowrap' }}
              >
                {t('panopto_grant_perm_btn')}
              </button>
            )}
          </div>
        )}
      </div>

      <hr className="settings-divider" />

      {/* Local Filesystem Sync Section */}
      {localFsConfig && localFsStatus && onLocalFsConfigChanged && (
        <>
          <LocalFsSettingsSection
            config={localFsConfig}
            status={localFsStatus}
            onConfigChanged={onLocalFsConfigChanged}
            onShowToast={onShowToast}
            t={t}
            lang={lang}
            highlightForTour={tourStep === 8}
          />
          <hr className="settings-divider" />
        </>
      )}



      {/* Account & Development Section */}
      <div className="settings-section">
        <h4>{t('account_section_title')}</h4>
        <p className="subtitle" style={{ marginBottom: '1rem' }}>
          {t('account_section_desc')}
        </p>

        <div className="account-card-box">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.2rem' }}>🎓</span>
                <strong>{lang === 'he' ? 'חשבון מודל מחובר' : 'Connected Moodle Account'}</strong>
                <span style={{ fontSize: '0.75rem', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '0.1rem 0.45rem', borderRadius: '4px' }}>
                  ● {lang === 'he' ? 'פעיל' : 'Active'}
                </span>
              </div>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {t('last_synced')}: {syncResult ? new Date(syncResult.syncedAt).toLocaleString() : t('never')}
              </p>
            </div>
            {onDisconnectClick && (
              <button className="text-btn danger-text" onClick={onDisconnectClick} style={{ padding: '0.45rem 0.9rem', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius-sm)' }}>
                {t('disconnect_account')}
              </button>
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
            <p style={{ fontSize: '0.92rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
              <strong>{t('developed_by')}</strong> {t('credits_authors')}
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <a
                href="https://github.com/duck-5/Noodle"
                target="_blank"
                rel="noreferrer"
                className="secondary-btn btn-xs"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
              >
                <span>🐙</span>
                <span>{t('github_repo_link')}</span>
              </a>
              <a
                href="https://github.com/duck-5/Noodle/issues"
                target="_blank"
                rel="noreferrer"
                className="secondary-btn btn-xs"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
              >
                <span>🐛</span>
                <span>{t('github_issues_link')}</span>
              </a>
              <a
                href="mailto:noodle.d3v@gmail.com"
                className="secondary-btn btn-xs"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
              >
                <span>✉️</span>
                <span>noodle.d3v@gmail.com</span>
              </a>
              <a
                href="https://chromewebstore.google.com/detail/noodle/nelflkccefbdpnaphjabcgkpakhdoope"
                target="_blank"
                rel="noreferrer"
                className="primary-btn btn-xs"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
              >
                <span>⭐</span>
                <span>{t('review_extension_label')}</span>
              </a>
            </div>
          </div>
        </div>

      </div>

      <hr className="settings-divider" />

      {/* Mock Course Section */}
      <div className="settings-section">
        <h4>{lang === 'he' ? 'קורס לדוגמה (לבדיקות ותצוגה)' : 'Mock Course (Testing & Showcase)'}</h4>
        <p className="subtitle" style={{ marginBottom: '1rem' }}>
          {lang === 'he'
            ? 'הוסף קורס עשיר עם מפגשי זום פעילים, מטלות עם קבצים מצורפים, קבצים שהוגשו ונושאים לצורך בדיקת ממשק המשתמש.'
            : 'Add a rich sample course with active Zoom meetings, assignments with attachments, submissions, and sections to test the UI.'}
        </p>
        <button
          className="primary-btn btn-sm"
          onClick={onAddMockCourse}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <span>➕</span>
          <span>{t('add_mock_course')}</span>
        </button>
      </div>
    </div>
  );
}

// 6. COURSE DETAIL VIEW
function CourseDetailView({
  courseId,
  assignments,
  files,
  meetings,
  recordings,
  courseStaff,
  courseSections,
  courseFolders,
  courseLinks,
  courseAnnouncements,
  syncErrors,
  token,
  getCourseColor,
  getCourseDisplayName,
  onBack,
  t,
  lang,
  settings,
  onToggleMeetingInterest,
  onSetCourseMeetingsVisibility,
  showHiddenZoomCourseIds,
  onToggleShowHiddenZoom,
  showHiddenPanoptoCourseIds,
  onToggleShowHiddenPanopto,
  onToggleCompleted,
  onToggleHidden,
  onToggleHideAllCourse,
  onToggleRecordingWatched,
  onToggleTrackHost,
  onUpdatePanopto,
  onUpdatePanoptoStaff,
  onImportCourseStaff,
  isSyncing,
  hasPanoptoPermission = true,
  onRequestPanoptoPermission,
  tourStep,
}: {
  courseId: number;
  assignments: Assignment[];
  files: CourseFile[];
  meetings: ZoomMeeting[];
  recordings?: PanoptoRecording[];
  courseStaff?: CourseStaffMember[];
  courseSections?: CourseSection[];
  courseFolders?: CourseFolder[];
  courseLinks?: CourseLink[];
  courseAnnouncements?: CourseAnnouncement[];
  syncErrors?: SyncError[];
  token: string | null;
  onBack: () => void;
  t: (key: any) => string;
  lang: 'he' | 'en';
  settings: ExtensionSettings | null;
  onToggleMeetingInterest: (meetingNumber: string, allMeetingNumbers: string[]) => void;
  onSetCourseMeetingsVisibility?: (courseMeetings: ZoomMeeting[], makeVisible: boolean) => void;
  showHiddenZoomCourseIds?: Set<number>;
  onToggleShowHiddenZoom?: (courseId: number) => void;
  showHiddenPanoptoCourseIds?: Set<number>;
  onToggleShowHiddenPanopto?: (courseId: number) => void;
  onToggleCompleted?: (assignmentId: number | string) => void;
  onToggleHidden?: (assignmentId: number | string) => void;
  onToggleHideAllCourse?: (courseAssignIds: number[], shouldHideAll: boolean) => void;
  onToggleRecordingWatched?: (recordingId: string) => void;
  onToggleTrackHost?: (courseId: number, hostName: string, recordingType: PanoptoRecordingType) => void;
  onUpdatePanopto?: (courseId: number, panoptoVal: string, triggerSync?: boolean) => void;
  onUpdatePanoptoStaff?: (courseId: number, entries: CoursePanoptoStaffEntry[]) => void;
  onImportCourseStaff?: (courseId: number, forceRefresh?: boolean) => Promise<CourseStaffMember[]>;
  isSyncing?: boolean;
  hasPanoptoPermission?: boolean;
  onRequestPanoptoPermission?: () => void;
  tourStep?: number;
} & TabProps) {
  const [expandedZoom, setExpandedZoom] = useState<boolean>(false);
  const [expandedPanopto, setExpandedPanopto] = useState<boolean>(true);
  const [expandedPanoptoStaff, setExpandedPanoptoStaff] = useState<boolean>(false);
  const [panoptoInputVal, setPanoptoInputVal] = useState<string>(
    settings?.coursesPanoptoMap?.[courseId] ||
    (settings?.coursesPanoptoMap as Record<string, string> | undefined)?.[String(courseId)] ||
    ''
  );
  const [expandedDetailAssignId, setExpandedDetailAssignId] = useState<number | null>(null);
  const [activeSectionName, setActiveSectionName] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string> | null>(null);
  const [activeTopSectionId, setActiveTopSectionId] = useState<number | null>(null);
  const [activeSubSectionId, setActiveSubSectionId] = useState<number | null>(null);
  const [downloadingFolderId, setDownloadingFolderId] = useState<number | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ current: number; total: number } | null>(null);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<number>>(new Set());

  const toggleFolderCollapsed = (folderId: number) => {
    setCollapsedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };
  const [showEmptySections, setShowEmptySections] = useState<boolean>(() => {
    try {
      return localStorage.getItem('noodle_show_empty_sections') === 'true';
    } catch {
      return false;
    }
  });

  const handleToggleShowEmptySections = () => {
    setShowEmptySections((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('noodle_show_empty_sections', String(next));
      } catch { }
      if (!next && activeSectionName) {
        const activeContent = sectionsMap.get(activeSectionName);
        if (activeContent && isSectionContentEmpty(activeContent)) {
          setActiveSectionName(null);
          setActiveTopSectionId(null);
          setActiveSubSectionId(null);
          setExpandedSections(null);
        }
      }
      return next;
    });
  };

  const handleDownloadFolderZip = async (folder: CourseFolder) => {
    if (!token) return;
    setDownloadingFolderId(folder.id);
    setDownloadProgress({ current: 0, total: folder.files.length });
    try {
      const zipBytes = await downloadFolderAsZip(folder, token, (completed: number, total: number) => {
        setDownloadProgress({ current: completed, total });
      });
      const blob = new Blob([zipBytes.buffer as ArrayBuffer], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(folder.name || 'folder').replace(/[\\/:*?"<>|]/g, '_')}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('ZIP download error:', err);
      alert(lang === 'he' ? `שגיאה בהורדת התיקייה: ${err.message}` : `Folder download failed: ${err.message}`);
    } finally {
      setDownloadingFolderId(null);
      setDownloadProgress(null);
    }
  };

  useEffect(() => {
    setPanoptoInputVal(
      settings?.coursesPanoptoMap?.[courseId] ||
      (settings?.coursesPanoptoMap as Record<string, string> | undefined)?.[String(courseId)] ||
      ''
    );
  }, [courseId, settings?.coursesPanoptoMap]);

  const handleSectionSelect = (secName: string | null) => {
    setActiveSectionName(secName);
    if (secName) {
      setExpandedSections(new Set([secName]));
      setTimeout(() => {
        const elementId = `section-node-${encodeURIComponent(secName)}`;
        const el = document.getElementById(elementId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    } else {
      setExpandedSections(null);
    }
  };

  const courseColor = getCourseColor(courseId);
  const rawCourseName = assignments.find(a => a.courseId === courseId)?.courseName ||
    files.find(f => f.courseId === courseId)?.courseName ||
    (recordings || []).find(r => r.courseId === courseId)?.courseName ||
    `Course ${courseId}`;
  const courseDisplayName = getCourseDisplayName(courseId, rawCourseName);

  // Filter items for this course
  const allCourseAssignments = assignments.filter((a) => a.courseId === courseId);
  const courseAssignments = allCourseAssignments.filter((a) => !isActivityHidden(a, settings?.hiddenAssignments));
  const courseGradeSummary = useMemo(() => {
    return calculateGradesSummary({
      assignments: courseAssignments,
      hiddenIdentifiers: settings?.hiddenAssignments,
      completedIdentifiers: settings?.completedAssignments,
      uncompletedIdentifiers: settings?.uncompletedAssignments,
    });
  }, [courseAssignments, settings?.hiddenAssignments, settings?.completedAssignments, settings?.uncompletedAssignments]);
  const thisCourseGroup = courseGradeSummary.courseGroups[courseId];
  const courseFiles = files.filter((f) => f.courseId === courseId);
  const courseRecordings = (settings?.panoptoEnabled ? (recordings || []) : []).filter((r) => r.courseId === courseId);
  const coursePanoptoStaffEntries =
    settings?.coursesPanoptoStaff?.[courseId] ||
    (settings?.coursesPanoptoStaff as Record<string, CoursePanoptoStaffEntry[]> | undefined)?.[String(courseId)] ||
    EMPTY_STAFF_ENTRIES;
  const partitionedCourseRecordings = partitionPanoptoRecordingsByTrackedHosts(
    courseRecordings,
    coursePanoptoStaffEntries
  );
  const isHiddenPanoptoOpen = showHiddenPanoptoCourseIds?.has(courseId) ?? false;
  const watchedSet = new Set(settings?.watchedRecordings || []);

  const renderRecordingRow = (rec: PanoptoRecording, rIdx: number, isHiddenRow = false) => {
    const isWatched = watchedSet.has(rec.id);
    const isRecitation = rec.type === 'Recitation';
    const isHostTracked =
      Boolean(rec.host) &&
      doesRecordingMatchStaffEntries({ host: rec.host }, coursePanoptoStaffEntries);

    return (
      <div
        key={rec.id || rIdx}
        className={`section-recording-item ${isWatched ? 'is-watched' : ''} ${isHiddenRow ? 'is-hidden-recording' : ''}`}
      >
        <div className="recording-left-info">
          <span
            className={`item-type-tag recording-type-tag ${isRecitation ? 'recitation-tag' : 'lecture-tag'}`}
          >
            {isRecitation ? `📐 ${t('panopto_recitation_badge')}` : `🎬 ${t('panopto_lecture_badge')}`}
          </span>
          <span className="item-name recording-title-span">{rec.title}</span>
          {rec.host && (
            <span className="recording-host-badge" dir="ltr">{rec.host}</span>
          )}
          {isHiddenRow && (
            <span className="recording-hidden-tag">({t('panopto_hidden_tag')})</span>
          )}
          {rec.publishedDate && (
            <span className="recording-date-badge">{rec.publishedDate}</span>
          )}
        </div>
        <div className="recording-actions">
          {rec.host && onToggleTrackHost && (
            <button
              type="button"
              className={`file-action-btn recording-track-host-btn ${isHostTracked ? 'tracking' : ''}`}
              onClick={() => onToggleTrackHost(courseId, rec.host!, rec.type)}
              title={isHostTracked ? t('panopto_tracking_host') : t('panopto_track_host')}
            >
              {isHostTracked ? (
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <line x1="19" y1="8" x2="19" y2="14" />
                  <line x1="22" y1="11" x2="16" y2="11" />
                </svg>
              )}
              <span>{isHostTracked ? t('panopto_tracking_host') : t('panopto_track_host')}</span>
            </button>
          )}
          {onToggleRecordingWatched && (
            <button
              type="button"
              className={`file-action-btn recording-watched-btn ${isWatched ? 'watched' : ''}`}
              onClick={() => onToggleRecordingWatched(rec.id)}
              title={isWatched ? t('watched_done') : t('mark_watched')}
            >
              <CheckIcon size={11} />
              <span>{isWatched ? t('watched_done') : t('mark_watched')}</span>
            </button>
          )}
          <a
            href={rec.recordingUrl}
            target="_blank"
            rel="noreferrer"
            className="file-action-btn recording-watch-link"
          >
            {t('watch_recording')}
          </a>
        </div>
      </div>
    );
  };

  const renderPanoptoRecordingsBlock = (
    listRecordings: PanoptoRecording[],
    maxHeight?: string
  ) => {
    const { visible: visibleRecs, hidden: hiddenRecs } = partitionPanoptoRecordingsByTrackedHosts(
      listRecordings,
      coursePanoptoStaffEntries
    );

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {visibleRecs.length === 0 && hiddenRecs.length > 0 ? (
          <div className="panopto-all-hidden-notice">
            {t('panopto_all_recordings_hidden_by_host')}
          </div>
        ) : (
          <div
            className="section-recordings-list"
            style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}
          >
            {visibleRecs.map((rec, rIdx) => renderRecordingRow(rec, rIdx, false))}
          </div>
        )}

        {hiddenRecs.length > 0 && (
          <div className="panopto-hidden-recordings-wrapper">
            <button
              type="button"
              className="secondary-btn btn-xs panopto-toggle-hidden-btn"
              onClick={(e) => {
                e.stopPropagation();
                onToggleShowHiddenPanopto?.(courseId);
              }}
              style={{ alignSelf: 'flex-start' }}
            >
              {isHiddenPanoptoOpen ? <EyeIcon size={12} /> : <EyeOffIcon size={12} />}
              <span>
                {isHiddenPanoptoOpen
                  ? `${t('panopto_hide_hidden_recordings')} (${hiddenRecs.length})`
                  : `${t('panopto_show_hidden_recordings')} (${hiddenRecs.length})`}
              </span>
            </button>

            {isHiddenPanoptoOpen && (
              <div className="panopto-hidden-recordings-drawer">
                {hiddenRecs.map((rec, hIdx) => renderRecordingRow(rec, hIdx, true))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // Resolve the direct Panopto course folder URL (from manual override or auto-discovered recording metadata)
  const resolvedCoursePanoptoFolderId =
    extractPanoptoFolderId(panoptoInputVal) ||
    courseRecordings.find((r) => r.folderId)?.folderId ||
    extractPanoptoFolderId(courseRecordings.find((r) => r.folderUrl)?.folderUrl || '');
  const panoptoCourseUrl = resolvedCoursePanoptoFolderId
    ? buildPanoptoFolderUrl(resolvedCoursePanoptoFolderId)
    : courseRecordings.find((r) => r.folderUrl)?.folderUrl ||
    'https://tau.cloud.panopto.eu/Panopto/Pages/Sessions/List.aspx';

  const thisCourseFolders = (courseFolders || []).filter((f) => f.courseId === courseId);
  const thisCourseLinks = (courseLinks || []).filter((l) => l.courseId === courseId);

  // Collect section IDs and names that contain actual student items (files, assignments, folders, links)
  // so we never hide sections that have actual contents even if Moodle's database flag was visible=0.
  const sectionIdsWithContent = new Set<number>();
  const sectionNamesWithContent = new Set<string>();
  courseFiles.forEach((f) => {
    if (f.sectionId) sectionIdsWithContent.add(f.sectionId);
    if (f.sectionName) sectionNamesWithContent.add(f.sectionName);
  });
  courseAssignments.forEach((a) => {
    if (a.sectionId) sectionIdsWithContent.add(a.sectionId);
    if (a.sectionName) sectionNamesWithContent.add(a.sectionName);
  });
  thisCourseFolders.forEach((fld) => {
    if (fld.sectionId) sectionIdsWithContent.add(fld.sectionId);
    if (fld.sectionName) sectionNamesWithContent.add(fld.sectionName);
  });
  thisCourseLinks.forEach((lnk) => {
    if (lnk.sectionId) sectionIdsWithContent.add(lnk.sectionId);
    if (lnk.sectionName) sectionNamesWithContent.add(lnk.sectionName);
  });

  const thisCourseSections = (courseSections || []).filter(
    (s) => s.courseId === courseId && (s.visible !== false || sectionIdsWithContent.has(s.id) || sectionNamesWithContent.has(s.name))
  );

  const sectionIdSet = new Set(thisCourseSections.map((s) => s.id));
  const rawTopSections = thisCourseSections.filter((s) => {
    if (!s.parentSectionId || s.parentSectionId <= 0) return true;
    if (!sectionIdSet.has(s.parentSectionId)) return true;
    return s.level === 0;
  });
  const topSections = (rawTopSections.length <= 1 && thisCourseSections.length > 1)
    ? thisCourseSections
    : rawTopSections;
  const currentSubSections = activeTopSectionId !== null
    ? thisCourseSections.filter((s) => s.parentSectionId === activeTopSectionId)
    : [];

  // Group files, assignments, folders, links, and Panopto recordings by sectionId (with fallback to sectionName)
  const sectionsMap = new Map<
    string,
    {
      displayTitle: string;
      isPanopto?: boolean;
      sectionId?: number;
      parentSectionId?: number | null;
      summaryHtml?: string;
      files: CourseFile[];
      assignments: Assignment[];
      recordings: PanoptoRecording[];
      folders: CourseFolder[];
      links: CourseLink[];
    }
  >();
  const sectionKeyById = new Map<number, string>();
  const sectionKeyByName = new Map<string, string>();

  // Initialize section helper
  const getSection = (
    key: string,
    displayTitle?: string,
    isPanopto = false,
    sectionId?: number,
    parentSectionId?: number | null
  ) => {
    const title = displayTitle || key || 'General';
    let sKey = key || 'General';
    if (sectionId !== undefined && sectionKeyById.has(sectionId)) {
      sKey = sectionKeyById.get(sectionId)!;
    } else if (sectionId === undefined && sectionKeyByName.has(sKey)) {
      sKey = sectionKeyByName.get(sKey)!;
    } else if (sectionId !== undefined && sectionsMap.has(sKey) && sectionsMap.get(sKey)!.sectionId !== sectionId) {
      // Disambiguate identically named subsections (e.g., two "שבוע 1" under different parent tabs)
      sKey = `${sKey}__${sectionId}`;
    }

    if (!sectionsMap.has(sKey)) {
      sectionsMap.set(sKey, {
        displayTitle: title,
        isPanopto,
        sectionId,
        parentSectionId,
        files: [],
        assignments: [],
        recordings: [],
        folders: [],
        links: [],
      });
    }
    if (sectionId !== undefined) sectionKeyById.set(sectionId, sKey);
    if (!sectionKeyByName.has(title)) sectionKeyByName.set(title, sKey);
    return sectionsMap.get(sKey)!;
  };

  thisCourseSections.forEach((sec) => {
    const s = getSection(sec.name, sec.name, false, sec.id, sec.parentSectionId);
    if (sec.summaryHtml) s.summaryHtml = sec.summaryHtml;
  });

  courseFiles.forEach((f) => {
    if (!f.folderId) {
      getSection(f.sectionName, f.sectionName, false, f.sectionId).files.push(f);
    }
  });

  courseAssignments.forEach((a) => {
    getSection(a.sectionName || 'General', a.sectionName || 'General', false, a.sectionId).assignments.push(a);
  });

  thisCourseFolders.forEach((fld) => {
    getSection(fld.sectionName || 'General', fld.sectionName || 'General', false, fld.sectionId).folders.push(fld);
  });

  thisCourseLinks.forEach((lnk) => {
    getSection(lnk.sectionName || 'General', lnk.sectionName || 'General', false, lnk.sectionId).links.push(lnk);
  });

  // Group Panopto recordings into hardcoded localized "Lectures" and "Recitations" sections
  courseRecordings.forEach((r) => {
    if (r.type === 'Recitation') {
      getSection('__panopto_recitations__', t('panopto_recitations_section'), true).recordings.push(r);
    } else {
      getSection('__panopto_lectures__', t('panopto_lectures_section'), true).recordings.push(r);
    }
  });

  const sectionsList = Array.from(sectionsMap.entries());

  // Sections in sectionsList that aren't mapped to any section in thisCourseSections
  const coveredSectionKeys = new Set<string>();
  thisCourseSections.forEach((s) => {
    const key = sectionKeyById.get(s.id);
    if (key) coveredSectionKeys.add(key);
    coveredSectionKeys.add(s.name);
  });
  const orphanContentSections = sectionsList.filter(
    ([k]) => !k.startsWith('__panopto_') && !coveredSectionKeys.has(k)
  );

  const isSectionContentEmpty = (content: {
    files: CourseFile[];
    assignments: Assignment[];
    recordings: PanoptoRecording[];
    folders: CourseFolder[];
    links: CourseLink[];
    summaryHtml?: string;
  }) => {
    if (content.files.length > 0) return false;
    if (content.assignments.length > 0) return false;
    if (content.recordings.length > 0) return false;
    if (content.folders.length > 0) return false;
    if (content.links.length > 0) return false;
    if (content.summaryHtml) {
      const cleanText = content.summaryHtml.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
      if (cleanText.length > 0) return false;
    }
    return true;
  };

  const sectionHasContent = (sec: CourseSection): boolean => {
    const key = sectionKeyById.get(sec.id) || sec.name;
    const content = sectionsMap.get(key);
    if (content && !isSectionContentEmpty(content)) return true;
    return thisCourseSections.some((child) => child.parentSectionId === sec.id && sectionHasContent(child));
  };

  const visibleTopSections = showEmptySections
    ? topSections
    : topSections.filter(sectionHasContent);

  const visibleSubSections = showEmptySections
    ? currentSubSections
    : currentSubSections.filter(sectionHasContent);

  const visibleOrphanContentSections = showEmptySections
    ? orphanContentSections
    : orphanContentSections.filter(([, content]) => !isSectionContentEmpty(content));

  const visibleSectionsList = showEmptySections
    ? sectionsList
    : sectionsList.filter(([, content]) => !isSectionContentEmpty(content));

  // Order assignments for this course by due date (with deterministic tie-breaker)
  const sortedCourseAssigns = [...allCourseAssignments].sort((a, b) => {
    if (!a.deadline && !b.deadline) return a.id - b.id;
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    const diff = new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    if (diff !== 0) return diff;
    return a.id - b.id;
  });

  return (
    <div className={`course-detail-view glass-panel ${tourStep === 5 ? 'tour-highlight' : ''}`} style={{ borderTop: `6px solid ${courseColor}` }}>
      <div className="detail-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button className="back-btn" onClick={onBack}>
            {t('back_to_courses')}
          </button>
          <a
            href={getCourseMoodleUrl(courseId, courseAssignments[0]?.link || courseFiles[0]?.fileUrl)}
            target="_blank"
            rel="noreferrer"
            className="secondary-btn btn-sm"
            data-moodle-link="true"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', textDecoration: 'none' }}
          >
            <span>{t('open_in_moodle')}</span>
          </a>
        </div>
        <div className="detail-title-section">
          <h3 style={{ color: courseColor }}>{courseDisplayName}</h3>
          <span className="course-id-badge">{rawCourseName}</span>
          {thisCourseGroup && thisCourseGroup.count > 0 && (
            <span className="badge" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.3)', fontWeight: 'bold' }}>
              {t('course_average_label')}: {thisCourseGroup.average}
            </span>
          )}
        </div>
      </div>

      <div className="detail-grid">
        {/* Left column: Section Tree */}
        <div className="detail-main-tree">
          {(() => {
            const courseAnns = (courseAnnouncements || []).filter(a => a.courseId === courseId);
            if (courseAnns.length === 0) return null;
            return (
              <div className="course-announcements-card glass-panel" style={{
                padding: '0.75rem 1rem',
                marginBottom: '1.25rem',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                background: 'rgba(59, 130, 246, 0.08)',
                border: '1px solid rgba(59, 130, 246, 0.25)',
              }}>
                <span style={{ fontSize: '1.2rem' }}>📢</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 'bold', fontSize: '0.9rem', color: '#60a5fa' }}>
                    {lang === 'he' ? 'לוח מודעות והודעות' : 'Announcements & News'}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                    {courseAnns.map((ann) => (
                      <a
                        key={ann.id}
                        href={ann.moodleUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="action-link-btn"
                        style={{ fontSize: '0.8rem', padding: '0.2rem 0.55rem' }}
                      >
                        {ann.name} ↗
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}
          {(() => {
            const rawCourseMeetings = meetings.filter(m => m.courseId === courseId && (isZoomJoinUrl(m.meetingUrl, m.meetingNumber) || isZoomUrl(m.meetingUrl)));
            const courseMeetings = collapseRecurringMeetings(rawCourseMeetings, new Date());
            const moodleZoomLink = (courseLinks || []).find((l: CourseLink) => l.courseId === courseId && l.linkKind === 'zoom');

            const isMarked = (m: ZoomMeeting) => {
              return !isZoomMeetingHidden(m, settings?.hiddenZoomMeetings, settings?.interestedMeetings);
            };
            const markedMeetings = courseMeetings.filter(isMarked);
            const hiddenMeetings = courseMeetings.filter(m => !isMarked(m));
            const isHiddenOpen = showHiddenZoomCourseIds?.has(courseId) ?? false;

            return (
              <div className="zoom-section-card glass-panel" style={{ borderLeft: lang === 'he' ? 'none' : `4px solid ${courseColor}`, borderRight: lang === 'he' ? `4px solid ${courseColor}` : 'none', padding: '1rem', marginBottom: '1.5rem' }}>
                <div
                  className="zoom-course-header"
                  onClick={() => setExpandedZoom(!expandedZoom)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, textAlign: lang === 'he' ? 'right' : 'left' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <h4 style={{ margin: 0, fontSize: '1rem', color: courseColor, fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <VideoIcon size={16} />
                        <span>{t('zoom_links_found')} ({markedMeetings.length}/{courseMeetings.length})</span>
                      </h4>
                      {courseMeetings.length > 0 && onSetCourseMeetingsVisibility && (
                        <div
                          className="zoom-actions-row"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="secondary-btn btn-xs"
                            onClick={() => onSetCourseMeetingsVisibility(courseMeetings, true)}
                            title={t('show_all_course_zoom')}
                          >
                            <EyeIcon size={12} />
                            <span>{t('show_all_course_zoom')}</span>
                          </button>
                          <button
                            type="button"
                            className="secondary-btn btn-xs"
                            onClick={() => onSetCourseMeetingsVisibility(courseMeetings, false)}
                            title={t('hide_all_course_zoom')}
                          >
                            <EyeOffIcon size={12} />
                            <span>{t('hide_all_course_zoom')}</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {(() => {
                      const activeMeeting = courseMeetings.find(m => getMeetingStatus(m.startTime) === 'active');
                      if (!activeMeeting) return null;
                      return (
                        <div style={{ fontSize: '13px', fontWeight: 'bold', marginTop: '4px' }}>
                          <span style={{ color: 'var(--text-muted)' }}>{t('current_zoom')} </span>
                          <a
                            href={activeMeeting.meetingUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              color: courseColor,
                              textDecoration: 'underline'
                            }}
                          >
                            {activeMeeting.title}
                          </a>
                        </div>
                      );
                    })()}

                    {/* Configured Quick buttons */}
                    {markedMeetings.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px', alignItems: lang === 'he' ? 'flex-end' : 'flex-start' }}>
                        {markedMeetings.map((m, idx) => (
                          <a
                            key={idx}
                            href={m.meetingUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(ev) => ev.stopPropagation()}
                            style={{
                              fontSize: '13px',
                              fontWeight: 500,
                              color: 'var(--text-primary)',
                              textDecoration: 'underline',
                              textDecorationColor: courseColor,
                              transition: 'opacity 0.2s',
                              lineHeight: '1.4'
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                          >
                            {m.title}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>

                  <span style={{ fontSize: '1rem', color: 'var(--text-secondary)', marginLeft: 8 }}>
                    {expandedZoom ? '▲' : '▼'}
                  </span>
                </div>

                <div
                  className="zoom-course-meetings-dropdown"
                  style={{
                    maxHeight: expandedZoom ? '400px' : '0px',
                    opacity: expandedZoom ? 1 : 0,
                    overflowY: expandedZoom ? 'auto' : 'hidden',
                    transition: 'max-height 0.2s ease-out, opacity 0.15s ease-out',
                    marginTop: expandedZoom ? '1rem' : '0px',
                    borderTop: expandedZoom ? '1px solid rgba(255,255,255,0.08)' : '1px solid transparent',
                    paddingTop: expandedZoom ? '1rem' : '0px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem'
                  }}
                >
                  {(() => {
                    if (courseMeetings.length === 0) {
                      return (
                        <div style={{ color: 'var(--text-secondary)', textAlign: 'center', fontSize: '13px', padding: '10px 0' }}>
                          <div>{lang === 'he' ? 'לא נמצאו פגישות זום עבור קורס זה.' : 'No Zoom meetings found for this course.'}</div>
                          {moodleZoomLink && (
                            <div style={{ marginTop: '0.65rem' }}>
                              <a
                                href={moodleZoomLink.targetUrl || moodleZoomLink.moodleUrl}
                                target="_blank"
                                rel="noreferrer"
                                data-moodle-link="true"
                                className="btn-ghost"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  padding: '5px 12px',
                                  borderRadius: '6px',
                                  fontSize: '12px',
                                  border: '1px solid rgba(255,255,255,0.15)',
                                  color: 'var(--primary)',
                                  textDecoration: 'none'
                                }}
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
                                <span>{lang === 'he' ? 'פתח עמוד זום במודל ↗' : 'Open Zoom Page in Moodle ↗'}</span>
                              </a>
                            </div>
                          )}
                        </div>
                      );
                    }
                    const allMeetingIds = courseMeetings.map(m => `${m.courseName}:${m.meetingNumber || ''}${m.title}`);

                    const renderMeetingRow = (m: ZoomMeeting, idx: number, isMarkedRow: boolean) => {
                      const status = getMeetingStatus(m.startTime);
                      let statusLabel = '';
                      let statusColor = '';
                      let itemStyle: React.CSSProperties = {
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '0.75rem',
                        background: 'rgba(255,255,255,0.02)',
                        borderRadius: 'var(--radius-sm)',
                        borderLeft: lang === 'he' ? 'none' : `3px solid rgba(255,255,255,0.1)`,
                        borderRight: lang === 'he' ? `3px solid rgba(255,255,255,0.1)` : 'none'
                      };

                      if (status === 'active') {
                        itemStyle.borderLeft = lang === 'he' ? 'none' : `3px solid #28a745`;
                        itemStyle.borderRight = lang === 'he' ? `3px solid #28a745` : 'none';
                        statusLabel = lang === 'he' ? '● פעיל כעת' : '● Active Now';
                        statusColor = '#28a745';
                      } else if (status === 'upcoming') {
                        statusLabel = lang === 'he' ? 'קרוב' : 'Upcoming';
                        statusColor = 'var(--text-muted)';
                      } else if (status === 'inactive') {
                        itemStyle.opacity = isMarkedRow ? 0.75 : 0.6;
                        itemStyle.borderLeft = lang === 'he' ? 'none' : `3px solid #888888`;
                        itemStyle.borderRight = lang === 'he' ? `3px solid #888888` : 'none';
                        statusLabel = m.startTime ? (lang === 'he' ? `הסתיים` : `Finished`) : '';
                        statusColor = '#888888';
                      }

                      return (
                        <div key={idx} className="meeting-row-item" style={itemStyle}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, textAlign: lang === 'he' ? 'right' : 'left' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{m.title}</span>
                              {statusLabel && (
                                <span style={{ fontSize: 11, color: statusColor, fontWeight: 'bold' }}>
                                  {statusLabel}
                                </span>
                              )}
                              {!isMarkedRow && (
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                                  ({t('hidden_tag')})
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.sectionName}</span>
                              {m.startTime && (
                                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                  {new Date(m.startTime).toLocaleString()}
                                </span>
                              )}
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <button
                              onClick={() => {
                                const keyId = `${m.courseName}:${m.meetingNumber || ''}${m.title}`;
                                if (keyId) {
                                  onToggleMeetingInterest(keyId, allMeetingIds);
                                }
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: 4,
                                color: isMarkedRow ? 'var(--primary)' : 'var(--text-muted)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'color 0.2s'
                              }}
                              title={isMarkedRow ? t('hide_from_dashboard') : t('show_on_dashboard')}
                            >
                              {isMarkedRow ? <EyeIcon /> : <EyeOffIcon />}
                            </button>
                            <a href={m.meetingUrl} target="_blank" rel="noreferrer" className="zoom-btn" style={{ textDecoration: 'none', padding: '4px 10px', fontSize: '12px' }}>
                              {t('join_zoom')}
                            </a>
                          </div>
                        </div>
                      );
                    };

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {markedMeetings.length === 0 ? (
                          <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '4px 0' }}>
                            {t('all_zoom_hidden_for_course')}
                          </div>
                        ) : (
                          markedMeetings.map((m, idx) => renderMeetingRow(m, idx, true))
                        )}

                        {hiddenMeetings.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.25rem' }}>
                            <button
                              type="button"
                              className="secondary-btn btn-xs zoom-toggle-hidden-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleShowHiddenZoom && onToggleShowHiddenZoom(courseId);
                              }}
                              style={{
                                alignSelf: 'flex-start',
                              }}
                            >
                              {isHiddenOpen ? <EyeIcon size={12} /> : <EyeOffIcon size={12} />}
                              <span>
                                {isHiddenOpen
                                  ? `${t('hide_hidden_zoom')} (${hiddenMeetings.length})`
                                  : `${t('show_hidden_zoom')} (${hiddenMeetings.length})`}
                              </span>
                            </button>

                            {isHiddenOpen && (
                              <div
                                style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '0.4rem',
                                  padding: '0.5rem',
                                  background: 'rgba(255, 255, 255, 0.02)',
                                  borderRadius: '6px',
                                  border: '1px dashed rgba(255, 255, 255, 0.1)'
                                }}
                              >
                                {hiddenMeetings.map((m, hIdx) => renderMeetingRow(m, hIdx, false))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })()}

          {settings?.panoptoEnabled && (() => {
            const visibleCountTarget = partitionedCourseRecordings.isFilteringActive
              ? partitionedCourseRecordings.visible
              : courseRecordings;
            const watchedCount = visibleCountTarget.filter(r => watchedSet.has(r.id)).length;
            const panoptoExternalUrl = panoptoCourseUrl;
            const coursePanoptoError = (syncErrors || []).find(
              e =>
                e.context.includes('Panopto') &&
                (e.context.includes(String(courseId)) ||
                  e.context.includes(rawCourseName) ||
                  e.context.includes(courseDisplayName))
            );

            return (
              <div
                className="panopto-section-card glass-panel"
                style={{
                  borderLeft: lang === 'he' ? 'none' : `4px solid ${courseColor}`,
                  borderRight: lang === 'he' ? `4px solid ${courseColor}` : 'none',
                  padding: '1rem',
                  marginBottom: '1.5rem',
                }}
              >
                <div
                  className="panopto-course-header"
                  onClick={() => setExpandedPanopto(!expandedPanopto)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1, gap: '0.75rem', flexWrap: 'wrap' }}>
                    <h4 style={{ margin: 0, fontSize: '1rem', color: courseColor, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>{t('panopto_card_title')} ({watchedCount}/{visibleCountTarget.length} {t('panopto_watched_summary')})</span>
                    </h4>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      {onUpdatePanoptoStaff && onImportCourseStaff && (
                        <button
                          type="button"
                          className={`secondary-btn btn-sm panopto-staff-toggle-btn ${expandedPanoptoStaff ? 'active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!expandedPanopto) setExpandedPanopto(true);
                            setExpandedPanoptoStaff((prev) => !prev);
                          }}
                          style={{ fontSize: '0.75rem', padding: '0.2rem 0.55rem' }}
                        >
                          {t('panopto_staff_short_btn')} ({coursePanoptoStaffEntries.length})
                        </button>
                      )}
                      <a
                        href={panoptoExternalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="secondary-btn btn-sm"
                        onClick={(e) => e.stopPropagation()}
                        style={{ fontSize: '0.75rem', padding: '0.2rem 0.55rem', textDecoration: 'none' }}
                      >
                        {t('open_panopto_btn')}
                      </a>
                    </div>
                  </div>
                  <span style={{ fontSize: '1rem', color: 'var(--text-secondary)', marginInlineStart: 8 }}>
                    {expandedPanopto ? '▲' : '▼'}
                  </span>
                </div>

                {expandedPanopto && (
                  <div
                    className="panopto-course-dropdown"
                    style={{
                      marginTop: '0.85rem',
                      borderTop: '1px solid rgba(255,255,255,0.08)',
                      paddingTop: '0.85rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.75rem',
                    }}
                  >
                    {!hasPanoptoPermission && (
                      <div
                        style={{
                          background: 'rgba(245, 158, 11, 0.12)',
                          border: '1px solid rgba(245, 158, 11, 0.3)',
                          borderRadius: 'var(--radius-md)',
                          padding: '0.75rem 1rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '1rem',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--accent-orange, #f59e0b)', fontSize: '0.88rem' }}>
                            ⚠️ {t('panopto_perm_needed_title')}
                          </div>
                          <div style={{ fontSize: '0.8rem', opacity: 0.85, marginTop: '0.2rem' }}>
                            {t('panopto_perm_needed_desc')}
                          </div>
                        </div>
                        {onRequestPanoptoPermission && (
                          <button
                            type="button"
                            className="primary-btn btn-sm"
                            onClick={onRequestPanoptoPermission}
                            style={{ whiteSpace: 'nowrap' }}
                          >
                            {t('panopto_grant_perm_btn')}
                          </button>
                        )}
                      </div>
                    )}

                    {onUpdatePanoptoStaff && onImportCourseStaff && expandedPanoptoStaff && (
                      <PanoptoStaffEditor
                        courseId={courseId}
                        entries={
                          settings?.coursesPanoptoStaff?.[courseId] ||
                          (settings?.coursesPanoptoStaff as Record<string, CoursePanoptoStaffEntry[]> | undefined)?.[String(courseId)] ||
                          EMPTY_STAFF_ENTRIES
                        }
                        moodleStaff={courseStaff}
                        detectedHosts={Array.from(
                          new Set(
                            courseRecordings
                              .map((r) => r.host)
                              .filter((h): h is string => Boolean(h && h.trim()))
                          )
                        )}
                        onSaveEntries={onUpdatePanoptoStaff}
                        onImportFromMoodle={onImportCourseStaff}
                        t={t}
                        lang={lang}
                      />
                    )}

                    {/* Inline Folder URL / UUID Override Bar (defaults to off) */}
                    {onUpdatePanopto && settings?.showPanoptoFolderOverride && (
                      <div
                        className="panopto-inline-override-row"
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.4rem',
                          background: 'rgba(255,255,255,0.02)',
                          padding: '0.65rem 0.75rem',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid rgba(255,255,255,0.07)',
                        }}
                      >
                        <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                          {t('panopto_folder_override_label')}
                        </label>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <input
                            type="text"
                            className="nickname-input panopto-folder-input"
                            style={{ flex: 1, minWidth: '220px' }}
                            value={panoptoInputVal}
                            placeholder={t('panopto_folder_placeholder')}
                            dir="ltr"
                            onChange={(e) => setPanoptoInputVal(e.target.value)}
                          />
                          <button
                            type="button"
                            className="primary-btn btn-sm"
                            disabled={isSyncing}
                            onClick={() => onUpdatePanopto(courseId, panoptoInputVal, true)}
                            style={{ whiteSpace: 'nowrap' }}
                          >
                            {isSyncing ? t('syncing') : t('save_and_sync_btn')}
                          </button>
                        </div>
                      </div>
                    )}

                    {coursePanoptoError && (
                      <div
                        className="panopto-sync-error-banner"
                        style={{
                          fontSize: '0.8rem',
                          color: '#fca5a5',
                          background: 'rgba(239, 68, 68, 0.12)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          borderRadius: '6px',
                          padding: '0.5rem 0.75rem',
                        }}
                      >
                        ⚠️ {coursePanoptoError.message}
                      </div>
                    )}

                    {courseRecordings.length === 0 ? (
                      <div
                        style={{
                          color: 'var(--text-secondary)',
                          fontSize: '0.82rem',
                          padding: '0.4rem 0.25rem',
                          lineHeight: 1.5,
                        }}
                      >
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>
                          {t('panopto_empty_state')}
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                          {t('panopto_empty_hint')}
                        </div>
                      </div>
                    ) : (
                      renderPanoptoRecordingsBlock(courseRecordings, '340px')
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h4 style={{ margin: 0 }}>{t('course_sections')}</h4>
            {sectionsList.length > 0 && (
              <button
                type="button"
                className="secondary-btn btn-xs toggle-empty-sections-btn"
                onClick={handleToggleShowEmptySections}
                title={showEmptySections ? (t('hide_empty_sections') || 'Hide empty sections') : (t('show_empty_sections') || 'Show empty sections')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontSize: '0.75rem',
                  padding: '0.25rem 0.6rem',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  background: showEmptySections ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                  borderColor: showEmptySections ? 'rgba(99, 102, 241, 0.35)' : 'rgba(255, 255, 255, 0.12)',
                  color: showEmptySections ? '#818cf8' : 'var(--text-secondary)'
                }}
              >
                {showEmptySections ? <EyeOffIcon size={12} /> : <EyeIcon size={12} />}
                <span>
                  {showEmptySections
                    ? (t('hide_empty_sections') || (lang === 'he' ? 'הסתר נושאים ריקים' : 'Hide empty sections'))
                    : (t('show_empty_sections') || (lang === 'he' ? 'הצג נושאים ריקים' : 'Show empty sections'))}
                </span>
              </button>
            )}
          </div>

          {/* Subjects Navigation Tree (2-Level Hierarchy if available, otherwise flat sectionsList) */}
          {(showEmptySections ? topSections.length : visibleTopSections.length) > 1 || (topSections.length > 1 && visibleTopSections.length > 0) ? (
            <div className="subjects-nav-tree-container" style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div className="subjects-nav-tree glass-panel" style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.5rem',
                padding: '0.75rem',
                background: 'rgba(255, 255, 255, 0.03)',
                borderRadius: '8px',
                alignItems: 'center'
              }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-secondary)', marginRight: '0.5rem' }}>
                  {lang === 'he' ? 'נווּט נושאים:' : 'Navigate Subjects:'}
                </span>
                <button
                  className="secondary-btn btn-sm"
                  onClick={() => {
                    setActiveTopSectionId(null);
                    setActiveSubSectionId(null);
                    handleSectionSelect(null);
                  }}
                  style={{
                    background: activeTopSectionId === null && activeSectionName === null ? courseColor : 'rgba(255, 255, 255, 0.05)',
                    color: activeTopSectionId === null && activeSectionName === null ? '#fff' : 'var(--text-primary)',
                    borderColor: activeTopSectionId === null && activeSectionName === null ? 'transparent' : 'rgba(255, 255, 255, 0.1)',
                    fontWeight: activeTopSectionId === null && activeSectionName === null ? 'bold' : 'normal',
                    padding: '0.3rem 0.75rem',
                    borderRadius: '16px',
                    cursor: 'pointer',
                    fontSize: '0.8rem'
                  }}
                >
                  {lang === 'he' ? 'הכל 🌐' : 'All 🌐'}
                </button>
                {visibleTopSections.map((sec) => {
                  const isActive = activeTopSectionId === sec.id;
                  return (
                    <button
                      key={sec.id}
                      className="secondary-btn btn-sm"
                      onClick={() => {
                        setActiveTopSectionId(sec.id);
                        setActiveSubSectionId(null);
                        const childSubIds = new Set(
                          thisCourseSections
                            .filter((s) => s.parentSectionId === sec.id)
                            .map((s) => s.id)
                        );
                        if (childSubIds.size > 0) {
                          const matchingKeys = visibleSectionsList
                            .filter(([, c]) => c.sectionId === sec.id || (c.sectionId !== undefined && childSubIds.has(c.sectionId)))
                            .map(([k]) => k);
                          setActiveSectionName(matchingKeys[0] || sec.name);
                          setExpandedSections(new Set(matchingKeys));
                        } else {
                          const key = sectionKeyById.get(sec.id) || sec.name;
                          handleSectionSelect(key);
                        }
                      }}
                      style={{
                        background: isActive ? courseColor : 'rgba(255, 255, 255, 0.05)',
                        color: isActive ? '#fff' : 'var(--text-primary)',
                        borderColor: isActive ? 'transparent' : 'rgba(255, 255, 255, 0.1)',
                        fontWeight: isActive ? 'bold' : 'normal',
                        padding: '0.3rem 0.75rem',
                        borderRadius: '16px',
                        cursor: 'pointer',
                        fontSize: '0.8rem'
                      }}
                    >
                      {sec.name}
                    </button>
                  );
                })}
                {visibleOrphanContentSections.map(([secName, secContent]) => {
                  const isActive = activeSectionName === secName;
                  return (
                    <button
                      key={secName}
                      className="secondary-btn btn-sm"
                      onClick={() => {
                        setActiveTopSectionId(null);
                        setActiveSubSectionId(null);
                        handleSectionSelect(secName);
                      }}
                      style={{
                        background: isActive ? courseColor : 'rgba(255, 255, 255, 0.05)',
                        color: isActive ? '#fff' : 'var(--text-primary)',
                        borderColor: isActive ? 'transparent' : 'rgba(255, 255, 255, 0.1)',
                        fontWeight: isActive ? 'bold' : 'normal',
                        padding: '0.3rem 0.75rem',
                        borderRadius: '16px',
                        cursor: 'pointer',
                        fontSize: '0.8rem'
                      }}
                    >
                      {secContent.displayTitle || secName}
                    </button>
                  );
                })}
                {sectionsMap.has('__panopto_lectures__') && (
                  <button
                    className="secondary-btn btn-sm"
                    onClick={() => handleSectionSelect('__panopto_lectures__')}
                    style={{
                      background: activeSectionName === '__panopto_lectures__' ? courseColor : 'rgba(255, 255, 255, 0.05)',
                      color: activeSectionName === '__panopto_lectures__' ? '#fff' : 'var(--text-primary)',
                      borderColor: activeSectionName === '__panopto_lectures__' ? 'transparent' : 'rgba(255, 255, 255, 0.1)',
                      fontWeight: activeSectionName === '__panopto_lectures__' ? 'bold' : 'normal',
                      padding: '0.3rem 0.75rem',
                      borderRadius: '16px',
                      cursor: 'pointer',
                      fontSize: '0.8rem'
                    }}
                  >
                    🎥 {t('panopto_lectures_section')}
                  </button>
                )}
                {sectionsMap.has('__panopto_recitations__') && (
                  <button
                    className="secondary-btn btn-sm"
                    onClick={() => handleSectionSelect('__panopto_recitations__')}
                    style={{
                      background: activeSectionName === '__panopto_recitations__' ? courseColor : 'rgba(255, 255, 255, 0.05)',
                      color: activeSectionName === '__panopto_recitations__' ? '#fff' : 'var(--text-primary)',
                      borderColor: activeSectionName === '__panopto_recitations__' ? 'transparent' : 'rgba(255, 255, 255, 0.1)',
                      fontWeight: activeSectionName === '__panopto_recitations__' ? 'bold' : 'normal',
                      padding: '0.3rem 0.75rem',
                      borderRadius: '16px',
                      cursor: 'pointer',
                      fontSize: '0.8rem'
                    }}
                  >
                    🎥 {t('panopto_recitations_section')}
                  </button>
                )}
                {sectionsList.length > 0 && (
                  <button
                    type="button"
                    className="secondary-btn btn-xs toggle-empty-sections-nav-btn"
                    onClick={handleToggleShowEmptySections}
                    title={showEmptySections ? (t('hide_empty_sections') || 'Hide empty sections') : (t('show_empty_sections') || 'Show empty sections')}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      marginInlineStart: 'auto',
                      fontSize: '0.72rem',
                      padding: '0.2rem 0.55rem',
                      borderRadius: '12px',
                      cursor: 'pointer',
                      background: showEmptySections ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                      borderColor: showEmptySections ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255, 255, 255, 0.1)',
                      color: showEmptySections ? '#818cf8' : 'var(--text-secondary)'
                    }}
                  >
                    {showEmptySections ? <EyeOffIcon size={11} /> : <EyeIcon size={11} />}
                    <span>{showEmptySections ? (lang === 'he' ? 'הסתר ריקים' : 'Hide empty') : (lang === 'he' ? 'הצג ריקים' : 'Show empty')}</span>
                  </button>
                )}
              </div>

              {activeTopSectionId !== null && visibleSubSections.length > 0 && (
                <div className="subsections-nav-row" style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.4rem',
                  padding: '0.5rem 0.75rem',
                  background: 'rgba(255, 255, 255, 0.015)',
                  borderRadius: '6px',
                  alignItems: 'center',
                  marginLeft: lang === 'he' ? 0 : '1rem',
                  marginRight: lang === 'he' ? '1rem' : 0
                }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>↳</span>
                  <button
                    className="secondary-btn btn-sm"
                    onClick={() => {
                      setActiveSubSectionId(null);
                      const topSec = topSections.find((s) => s.id === activeTopSectionId);
                      if (topSec) {
                        const childSubIds = new Set(
                          thisCourseSections
                            .filter((s) => s.parentSectionId === topSec.id)
                            .map((s) => s.id)
                        );
                        const matchingKeys = visibleSectionsList
                          .filter(([, c]) => c.sectionId === topSec.id || (c.sectionId !== undefined && childSubIds.has(c.sectionId)))
                          .map(([k]) => k);
                        setActiveSectionName(matchingKeys[0] || topSec.name);
                        setExpandedSections(new Set(matchingKeys));
                      }
                    }}
                    style={{
                      background: activeSubSectionId === null ? courseColor : 'rgba(255, 255, 255, 0.04)',
                      color: activeSubSectionId === null ? '#fff' : 'var(--text-primary)',
                      padding: '0.2rem 0.6rem',
                      borderRadius: '12px',
                      fontSize: '0.75rem'
                    }}
                  >
                    {lang === 'he' ? 'כל תתי-הנושאים' : 'All Subtopics'}
                  </button>
                  {visibleSubSections.map((sub) => {
                    const isActive = activeSubSectionId === sub.id;
                    return (
                      <button
                        key={sub.id}
                        className="secondary-btn btn-sm"
                        onClick={() => {
                          setActiveSubSectionId(sub.id);
                          const key = sectionKeyById.get(sub.id) || sub.name;
                          handleSectionSelect(key);
                        }}
                        style={{
                          background: isActive ? courseColor : 'rgba(255, 255, 255, 0.04)',
                          color: isActive ? '#fff' : 'var(--text-primary)',
                          padding: '0.2rem 0.6rem',
                          borderRadius: '12px',
                          fontSize: '0.75rem'
                        }}
                      >
                        {sub.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : visibleSectionsList.length > 0 ? (
            <div className="subjects-nav-tree glass-panel" style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.5rem',
              padding: '0.75rem',
              marginBottom: '1.5rem',
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: '8px',
              alignItems: 'center'
            }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-secondary)', marginRight: '0.5rem' }}>
                {lang === 'he' ? 'נווּט נושאים:' : 'Navigate Subjects:'}
              </span>
              <button
                className="secondary-btn btn-sm"
                onClick={() => handleSectionSelect(null)}
                style={{
                  background: activeSectionName === null ? courseColor : 'rgba(255, 255, 255, 0.05)',
                  color: activeSectionName === null ? '#fff' : 'var(--text-primary)',
                  borderColor: activeSectionName === null ? 'transparent' : 'rgba(255, 255, 255, 0.1)',
                  fontWeight: activeSectionName === null ? 'bold' : 'normal',
                  padding: '0.3rem 0.75rem',
                  borderRadius: '16px',
                  cursor: 'pointer',
                  fontSize: '0.8rem'
                }}
              >
                {lang === 'he' ? 'הכל 🌐' : 'All 🌐'}
              </button>
              {visibleSectionsList.map(([secName, secContent]) => {
                const isActive = activeSectionName === secName;
                return (
                  <button
                    key={secName}
                    className="secondary-btn btn-sm"
                    onClick={() => handleSectionSelect(secName)}
                    style={{
                      background: isActive ? courseColor : 'rgba(255, 255, 255, 0.05)',
                      color: isActive ? '#fff' : 'var(--text-primary)',
                      borderColor: isActive ? 'transparent' : 'rgba(255, 255, 255, 0.1)',
                      fontWeight: isActive ? 'bold' : 'normal',
                      padding: '0.3rem 0.75rem',
                      borderRadius: '16px',
                      cursor: 'pointer',
                      fontSize: '0.8rem'
                    }}
                  >
                    {secContent.displayTitle}
                  </button>
                );
              })}
              {sectionsList.length > 0 && (
                <button
                  type="button"
                  className="secondary-btn btn-xs toggle-empty-sections-nav-btn"
                  onClick={handleToggleShowEmptySections}
                  title={showEmptySections ? (t('hide_empty_sections') || 'Hide empty sections') : (t('show_empty_sections') || 'Show empty sections')}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    marginInlineStart: 'auto',
                    fontSize: '0.72rem',
                    padding: '0.2rem 0.55rem',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    background: showEmptySections ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                    borderColor: showEmptySections ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255, 255, 255, 0.1)',
                    color: showEmptySections ? '#818cf8' : 'var(--text-secondary)'
                  }}
                >
                  {showEmptySections ? <EyeOffIcon size={11} /> : <EyeIcon size={11} />}
                  <span>{showEmptySections ? (lang === 'he' ? 'הסתר ריקים' : 'Hide empty') : (lang === 'he' ? 'הצג ריקים' : 'Show empty')}</span>
                </button>
              )}
            </div>
          ) : null}

          {visibleSectionsList.length === 0 ? (
            <div className="empty-state">
              {sectionsList.length > 0
                ? (lang === 'he' ? 'כל הנושאים בקורס זה ריקים (מוסתרים כברירת מחדל).' : 'All sections in this course are empty (hidden by default).')
                : t('empty_sections')}
              {sectionsList.length > 0 && !showEmptySections && (
                <div style={{ marginTop: '0.6rem' }}>
                  <button
                    type="button"
                    className="secondary-btn btn-xs"
                    onClick={handleToggleShowEmptySections}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                  >
                    <EyeIcon size={12} />
                    <span>{t('show_empty_sections') || (lang === 'he' ? 'הצג נושאים ריקים' : 'Show empty sections')}</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="sections-tree">
              {visibleSectionsList.map(([secName, content], sIdx) => {
                const isCollapsed = expandedSections !== null ? !expandedSections.has(secName) : false;
                return (
                  <div
                    key={sIdx}
                    id={`section-node-${encodeURIComponent(secName)}`}
                    className={`section-node glass-panel ${isCollapsed ? 'collapsed' : 'expanded'}`}
                    style={{
                      transition: 'all 0.3s ease',
                      opacity: isCollapsed ? 0.7 : 1,
                      padding: isCollapsed ? '0.75rem 1rem' : '1rem'
                    }}
                  >
                    <h5
                      className="section-node-title"
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        margin: 0,
                        cursor: 'pointer',
                        paddingBottom: isCollapsed ? '0' : '0.5rem',
                        borderBottom: isCollapsed ? 'none' : '1px solid rgba(255,255,255,0.08)'
                      }}
                      onClick={(e) => {
                        if (activeSectionName !== null) {
                          setActiveSectionName(null);
                        }
                        setExpandedSections(prev => {
                          const newSet = new Set(prev === null ? visibleSectionsList.map(s => s[0]) : prev);
                          if (newSet.has(secName)) {
                            newSet.delete(secName);
                          } else {
                            newSet.add(secName);
                          }
                          return newSet;
                        });
                        e.stopPropagation();
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span>{content.displayTitle}</span>
                        {content.isPanopto ? (
                          <a
                            href={panoptoCourseUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="action-icon-link"
                            onClick={(ev) => ev.stopPropagation()}
                          >
                            {t('panopto_short_link')}
                          </a>
                        ) : (
                          <a
                            href={(() => {
                              const matchingSec = thisCourseSections.find(
                                (s) => (content.sectionId !== undefined && s.id === content.sectionId) || s.name === content.displayTitle
                              );
                              return matchingSec?.sectionUrl || getCourseMoodleUrl(matchingSec?.courseId || courseId, courseAssignments[0]?.link);
                            })()}
                            target="_blank"
                            rel="noreferrer"
                            className="action-icon-link"
                            data-moodle-link="true"
                            onClick={(ev) => ev.stopPropagation()}
                          >
                            {lang === 'he' ? 'מודל ↗' : 'Moodle ↗'}
                          </a>
                        )}
                      </div>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {isCollapsed ? '▼' : '▲'}
                      </span>
                    </h5>

                    {!isCollapsed && (
                      <div className="section-node-body" style={{ marginTop: '1rem' }}>
                        {isSectionContentEmpty(content) && (
                          <div
                            className="empty-section-placeholder"
                            style={{
                              padding: '0.6rem 0.85rem',
                              color: 'var(--text-secondary)',
                              fontSize: '0.85rem',
                              fontStyle: 'italic',
                              background: 'rgba(255, 255, 255, 0.02)',
                              borderRadius: '6px',
                              border: '1px dashed rgba(255, 255, 255, 0.08)'
                            }}
                          >
                            {t('no_items_in_section')}
                          </div>
                        )}
                        {content.summaryHtml && (
                          <div
                            className="section-summary-banner"
                            style={{
                              padding: '0.65rem 0.85rem',
                              marginBottom: '0.85rem',
                              background: 'rgba(255, 255, 255, 0.03)',
                              borderRadius: '6px',
                              borderInlineStart: `3px solid ${courseColor}`,
                              fontSize: '0.85rem',
                              color: 'var(--text-secondary)',
                              lineHeight: '1.45',
                              whiteSpace: 'pre-line',
                            }}
                          >
                            {content.summaryHtml}
                          </div>
                        )}
                        {content.assignments.length > 0 && (
                          <div className="section-assignments-list">
                            {content.assignments.map((a) => {
                              const { badgeClass, deadlineText } = getDueTextAndClass(
                                a.deadline || null,
                                lang,
                                settings?.assignmentGreenDaysThreshold,
                                settings?.assignmentYellowDaysThreshold,
                                false,
                                a.status
                              );

                              return (
                                <div key={a.id} className="section-assignment-item">
                                  <div className="item-meta-row">
                                    <span className={`item-type-tag ${a.activityType === 'quiz' ? 'quiz-tag' : 'assign-tag'}`}>
                                      {a.activityType === 'quiz' ? `❓ ${lang === 'he' ? 'בוחן' : 'Quiz'}` : `📝 ${lang === 'he' ? 'מטלה' : 'Assignment'}`}
                                    </span>
                                    {a.timeLimitSeconds ? (
                                      <span className="badge" style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8', borderColor: 'rgba(99, 102, 241, 0.3)' }}>
                                        ⏱️ {Math.round(a.timeLimitSeconds / 60)} {lang === 'he' ? "דק'" : 'min'}
                                      </span>
                                    ) : null}
                                    {a.isBonus && (
                                      <span className="badge" style={{ background: 'rgba(234, 179, 8, 0.15)', color: '#eab308', borderColor: 'rgba(234, 179, 8, 0.3)' }}>
                                        ✨ {lang === 'he' ? 'בונוס' : 'Bonus'}
                                      </span>
                                    )}
                                    {a.isLateSubmissionBox && (
                                      <span className="badge" style={{ background: 'rgba(249, 115, 22, 0.15)', color: '#f97316', borderColor: 'rgba(249, 115, 22, 0.3)' }}>
                                        ⏳ {lang === 'he' ? 'הגשה באיחור' : 'Late Box'}
                                      </span>
                                    )}
                                    {a.status === 'Submitted' ? (
                                      <span className="badge badge-success">{lang === 'he' ? 'הוגש!' : 'Submitted!'}</span>
                                    ) : (a as any).isCompleted ? (
                                      <span
                                        className="badge badge-success"
                                        style={{
                                          background: 'rgba(16, 185, 129, 0.15)',
                                          color: '#10b981',
                                          borderColor: 'rgba(16, 185, 129, 0.3)',
                                        }}
                                      >
                                        {t('marked_as_done')}
                                      </span>
                                    ) : (
                                      <span className={`badge ${badgeClass}`}>{deadlineText}</span>
                                    )}
                                    {a.cutoffDate && hasGracePeriod(a) && (
                                      <span
                                        className="grace-period-clock-icon"
                                        title={formatGracePeriodTooltip(a.cutoffDate, lang)}
                                        aria-label={formatGracePeriodTooltip(a.cutoffDate, lang)}
                                      >
                                        <ClockIcon size={12} />
                                      </span>
                                    )}
                                  </div>
                                  <span className="item-name">
                                    {a.name}
                                    {a.feedback && (
                                      <div style={{ marginTop: '0.35rem', fontSize: '0.8rem', color: 'var(--text-secondary)', background: 'rgba(255, 255, 255, 0.03)', padding: '0.3rem 0.55rem', borderRadius: '4px', borderInlineStart: '3px solid #10b981' }}>
                                        💬 <strong>{lang === 'he' ? 'משוב:' : 'Feedback:'}</strong> {a.feedback}
                                      </div>
                                    )}
                                    {(a as any).isCompleted && !(a as any).isMoodleSubmitted && (
                                      <span className="assignment-tag tag-not-submitted" title={lang === 'he' ? 'הושלם ידנית - לא הוגש במודל' : 'Manually completed - not submitted in Moodle'}>
                                        {t('not_submitted_tag')}
                                      </span>
                                    )}
                                    {!(a as any).isCompleted && (a as any).isMoodleSubmitted && (
                                      <span className="assignment-tag tag-submitted" title={lang === 'he' ? 'הוגש במודל - סומן לביצוע' : 'Submitted in Moodle - marked as To Do'}>
                                        {t('submitted_tag')}
                                      </span>
                                    )}
                                  </span>
                                  <div className="item-actions" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.45rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                      <a href={a.link} target="_blank" rel="noreferrer" className="action-link-btn" data-moodle-link="true">
                                        {lang === 'he' ? 'פתח במודל ↗' : 'Open in Moodle ↗'}
                                      </a>
                                      {onToggleCompleted && (
                                        <button
                                          type="button"
                                          className="secondary-btn btn-sm"
                                          onClick={() => onToggleCompleted(a.uid || getActivityUid(a))}
                                          style={{
                                            fontSize: '0.75rem',
                                            padding: '0.2rem 0.55rem',
                                            borderRadius: '6px',
                                            background: (a as any).isCompleted ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                                            color: (a as any).isCompleted ? '#10b981' : 'var(--text-primary)',
                                            borderColor: (a as any).isCompleted ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255, 255, 255, 0.1)',
                                            cursor: 'pointer'
                                          }}
                                        >
                                          {(a as any).isCompleted ? '✓ ' + (lang === 'he' ? 'בוצע' : 'Done') : (lang === 'he' ? 'סמן כבוצע' : 'Mark as done')}
                                        </button>
                                      )}
                                    </div>
                                    {a.attachments && a.attachments.length > 0 && (
                                      <div className="files-column-list">
                                        {a.attachments.map((att, attIdx) => {
                                          const downloadUrl = buildFileDownloadUrl(att.url, token);
                                          const openUrl = buildFileOpenUrl(att.url, token);
                                          return (
                                            <div key={attIdx} className="submitted-file-chip file-column-item" style={{ background: 'rgba(255, 255, 255, 0.03)', borderColor: 'var(--border)' }}>
                                              <span style={{ fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}><FileIcon size={13} style={{ opacity: 0.7, flexShrink: 0 }} /><span>{att.name}</span></span>
                                              <FileOpenAction
                                                rawUrl={att.url}
                                                openUrl={openUrl}
                                                fileName={att.name}
                                                token={token}
                                                t={t}
                                                lang={lang}
                                              />
                                              <a href={downloadUrl} download={att.name} target="_blank" rel="noreferrer" className="file-action-btn file-download-btn" title={t('download_file')} aria-label={t('download_file')}>
                                                <DownloadIcon size={12} />
                                              </a>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {content.files.length > 0 && (
                          <div className="section-files-list">
                            {content.files.map((f, fIdx) => {
                              const downloadUrl = buildFileDownloadUrl(f.fileUrl, token);
                              const openUrl = buildFileOpenUrl(f.fileUrl, token);
                              return (
                                <div key={fIdx} className="section-file-item">
                                  <span className="item-name" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}><FileIcon size={13} style={{ opacity: 0.7, flexShrink: 0 }} /><span>{f.fileName}</span></span>
                                  <div className="file-meta" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    {f.fileSize > 0 && <span className="file-size">{(f.fileSize / 1024 / 1024).toFixed(2)} MB</span>}
                                    <FileOpenAction
                                      rawUrl={f.fileUrl}
                                      openUrl={openUrl}
                                      fileName={f.fileName}
                                      token={token}
                                      t={t}
                                      lang={lang}
                                    />
                                    <a
                                      href={downloadUrl}
                                      download={f.fileName}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="file-action-btn file-download-btn"
                                      title={t('download_file')}
                                      aria-label={t('download_file')}
                                    >
                                      <DownloadIcon size={12} />
                                    </a>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {content.folders && content.folders.length > 0 && (
                          <div className="section-folders-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.75rem' }}>
                            {content.folders.map((fld) => {
                              const isDownloading = downloadingFolderId === fld.id;
                              const isExpanded = !collapsedFolderIds.has(fld.id);
                              const files = fld.files || [];
                              const rootFiles = files.filter((f) => !f.relativePath || f.relativePath === '' || f.relativePath === '/');
                              const subfolderMap = new Map<string, CourseFolderFile[]>();
                              files.forEach((f) => {
                                const cleanRel = (f.relativePath || '').replace(/^\/+|\/+$/g, '');
                                if (cleanRel) {
                                  if (!subfolderMap.has(cleanRel)) subfolderMap.set(cleanRel, []);
                                  subfolderMap.get(cleanRel)!.push(f);
                                }
                              });
                              const subfolders = Array.from(subfolderMap.entries()).sort(([a], [b]) => a.localeCompare(b));

                              return (
                                <div
                                  key={fld.id}
                                  className="section-folder-card glass-panel"
                                  style={{
                                    borderRadius: '8px',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                    background: 'rgba(255, 255, 255, 0.02)',
                                    overflow: 'hidden',
                                    transition: 'all 0.2s ease',
                                  }}
                                >
                                  {/* Folder Header Row */}
                                  <div
                                    className="folder-header-row"
                                    style={{
                                      padding: '0.75rem 1rem',
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      flexWrap: 'wrap',
                                      gap: '0.5rem',
                                      cursor: files.length > 0 ? 'pointer' : 'default',
                                      background: isExpanded && files.length > 0 ? 'rgba(255, 255, 255, 0.03)' : 'transparent',
                                      borderBottom: isExpanded && files.length > 0 ? '1px solid rgba(255, 255, 255, 0.08)' : 'none',
                                    }}
                                    onClick={() => {
                                      if (files.length > 0) {
                                        toggleFolderCollapsed(fld.id);
                                      }
                                    }}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                      <FolderIcon size={18} style={{ color: "var(--accent, #6366f1)", opacity: 0.9 }} />
                                      <div>
                                        <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{fld.name}</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                          <span>
                                            {files.length} {lang === 'he' ? 'קבצים' : 'files'}
                                            {fld.totalSize > 0 ? ` (${(fld.totalSize / 1024 / 1024).toFixed(2)} MB)` : ''}
                                          </span>
                                          {files.length > 0 && (
                                            <span style={{ fontSize: '0.7rem', color: 'var(--accent, #6366f1)', marginInlineStart: '0.2rem' }}>
                                              {isExpanded ? '▲' : '▼'}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                    <div
                                      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <a
                                        href={fld.moodleUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="action-link-btn"
                                        style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                                      >
                                        {lang === 'he' ? 'פתח תיקייה במודל ↗' : 'Open in Moodle ↗'}
                                      </a>
                                      <button
                                        type="button"
                                        className="secondary-btn btn-sm"
                                        disabled={isDownloading || files.length === 0}
                                        onClick={() => handleDownloadFolderZip(fld)}
                                        title={files.length === 0 ? (lang === 'he' ? 'אין קבצים בתיקייה' : 'Folder is empty') : undefined}
                                        style={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '0.35rem',
                                          fontSize: '0.75rem',
                                          padding: '0.3rem 0.6rem',
                                          cursor: isDownloading ? 'wait' : files.length === 0 ? 'not-allowed' : 'pointer',
                                          opacity: files.length === 0 ? 0.6 : 1,
                                        }}
                                      >
                                        <DownloadIcon size={12} />
                                        <span>
                                          {isDownloading
                                            ? `${lang === 'he' ? 'מוריד...' : 'Downloading...'} (${downloadProgress?.current || 0}/${downloadProgress?.total || files.length})`
                                            : lang === 'he'
                                              ? 'הורד כ-ZIP'
                                              : 'Download ZIP'}
                                        </span>
                                      </button>
                                    </div>
                                  </div>

                                  {/* Expanded Folder Files List */}
                                  {isExpanded && files.length > 0 && (
                                    <div
                                      className="folder-files-container"
                                      style={{
                                        padding: '0.5rem 0.75rem 0.75rem',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '0.35rem',
                                        background: 'rgba(0, 0, 0, 0.08)',
                                      }}
                                    >
                                      {/* Root files */}
                                      {rootFiles.map((f, fIdx) => {
                                        const downloadUrl = buildFileDownloadUrl(f.fileUrl, token);
                                        const openUrl = buildFileOpenUrl(f.fileUrl, token);
                                        return (
                                          <div
                                            key={`root_${fIdx}`}
                                            className="section-file-item folder-file-item"
                                            style={{
                                              padding: '0.5rem 0.75rem',
                                              borderRadius: '6px',
                                              background: 'rgba(255, 255, 255, 0.025)',
                                              border: '1px solid rgba(255, 255, 255, 0.06)',
                                              display: 'flex',
                                              justifyContent: 'space-between',
                                              alignItems: 'center',
                                              gap: '0.5rem',
                                            }}
                                          >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', minWidth: 0, flex: 1 }}>
                                              <FileIcon size={15} style={{ color: "var(--text-secondary)", flexShrink: 0 }} />
                                              <span
                                                className="item-name"
                                                style={{
                                                  fontSize: '0.85rem',
                                                  overflow: 'hidden',
                                                  textOverflow: 'ellipsis',
                                                  whiteSpace: 'nowrap',
                                                }}
                                                title={f.fileName}
                                              >
                                                {f.fileName}
                                              </span>
                                            </div>
                                            <div className="file-meta" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                                              {f.fileSize > 0 && (
                                                <span className="file-size">{(f.fileSize / 1024 / 1024).toFixed(2)} MB</span>
                                              )}
                                              <FileOpenAction
                                                rawUrl={f.fileUrl}
                                                openUrl={openUrl}
                                                fileName={f.fileName}
                                                token={token}
                                                t={t}
                                                lang={lang}
                                              />
                                              <a
                                                href={downloadUrl}
                                                download={f.fileName}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="file-action-btn file-download-btn"
                                                title={t('download_file')}
                                                aria-label={t('download_file')}
                                              >
                                                <DownloadIcon size={12} />
                                              </a>
                                            </div>
                                          </div>
                                        );
                                      })}

                                      {/* Subfolders */}
                                      {subfolders.map(([subPath, subFiles]) => (
                                        <div
                                          key={subPath}
                                          className="folder-subgroup"
                                          style={{
                                            marginBlockStart: '0.4rem',
                                            paddingInlineStart: '0.5rem',
                                            borderInlineStart: '2px solid rgba(255, 255, 255, 0.12)',
                                          }}
                                        >
                                          <div
                                            style={{
                                              fontSize: '0.78rem',
                                              fontWeight: 600,
                                              color: 'var(--text-secondary)',
                                              display: 'flex',
                                              alignItems: 'center',
                                              gap: '0.35rem',
                                              padding: '0.2rem 0',
                                            }}
                                          >
                                            <FolderIcon size={14} style={{ color: "var(--accent, #6366f1)", opacity: 0.85 }} />
                                            <span>{subPath}/</span>
                                            <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>({subFiles.length})</span>
                                          </div>
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.2rem' }}>
                                            {subFiles.map((subFile, sfIdx) => {
                                              const downloadUrl = buildFileDownloadUrl(subFile.fileUrl, token);
                                              const openUrl = buildFileOpenUrl(subFile.fileUrl, token);
                                              return (
                                                <div
                                                  key={`${subPath}_${sfIdx}`}
                                                  className="section-file-item folder-file-item"
                                                  style={{
                                                    padding: '0.5rem 0.75rem',
                                                    borderRadius: '6px',
                                                    background: 'rgba(255, 255, 255, 0.025)',
                                                    border: '1px solid rgba(255, 255, 255, 0.06)',
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    gap: '0.5rem',
                                                  }}
                                                >
                                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', minWidth: 0, flex: 1 }}>
                                                    <FileIcon size={14} style={{ color: "var(--text-secondary)", flexShrink: 0 }} />
                                                    <span
                                                      className="item-name"
                                                      style={{
                                                        fontSize: '0.85rem',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                      }}
                                                      title={subFile.fileName}
                                                    >
                                                      {subFile.fileName}
                                                    </span>
                                                  </div>
                                                  <div className="file-meta" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                                                    {subFile.fileSize > 0 && (
                                                      <span className="file-size">{(subFile.fileSize / 1024 / 1024).toFixed(2)} MB</span>
                                                    )}
                                                    <FileOpenAction
                                                      rawUrl={subFile.fileUrl}
                                                      openUrl={openUrl}
                                                      fileName={subFile.fileName}
                                                      token={token}
                                                      t={t}
                                                      lang={lang}
                                                    />
                                                    <a
                                                      href={downloadUrl}
                                                      download={subFile.fileName}
                                                      target="_blank"
                                                      rel="noreferrer"
                                                      className="file-action-btn file-download-btn"
                                                      title={t('download_file')}
                                                      aria-label={t('download_file')}
                                                    >
                                                      <DownloadIcon size={12} />
                                                    </a>
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {content.links && content.links.length > 0 && (
                          <div className="section-links-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.75rem' }}>
                            {content.links.map((lnk) => {
                              let icon = '🔗';
                              if (lnk.linkKind === 'drive') icon = '📁';
                              else if (lnk.linkKind === 'github') icon = '💻';
                              else if (lnk.linkKind === 'zoom') icon = '📹';
                              else if (lnk.linkKind === 'panopto') icon = '🎬';

                              return (
                                <div
                                  key={lnk.id}
                                  className="section-link-item"
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '0.5rem 0.75rem',
                                    borderRadius: '6px',
                                    background: 'rgba(255, 255, 255, 0.02)',
                                    border: '1px solid rgba(255, 255, 255, 0.05)',
                                    fontSize: '0.85rem'
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                    <span>{icon}</span>
                                    <span style={{ fontWeight: 500 }}>{lnk.name}</span>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <a
                                      href={lnk.targetUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="action-link-btn"
                                      style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                                    >
                                      {lang === 'he' ? 'פתח קישור ↗' : 'Open Link ↗'}
                                    </a>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {content.recordings.length > 0 && renderPanoptoRecordingsBlock(content.recordings)}

                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right column: Assignments Quick Overview */}
        <div className="detail-sidebar">
          {(() => {
            const allHidden = sortedCourseAssigns.length > 0 && sortedCourseAssigns.every((a) => isActivityHidden(a, settings?.hiddenAssignments));
            return (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <h4 style={{ margin: 0 }}>{t('all_assignments_label')}</h4>
                {sortedCourseAssigns.length > 0 && onToggleHideAllCourse && (
                  <button
                    className="secondary-btn btn-xs"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    onClick={() => onToggleHideAllCourse(sortedCourseAssigns.map((a) => a.id), !allHidden)}
                  >
                    {allHidden ? <EyeIcon /> : <EyeOffIcon />}
                    <span>{allHidden ? t('unhide_all_assignments') : t('hide_all_assignments')}</span>
                  </button>
                )}
              </div>
            );
          })()}
          {sortedCourseAssigns.length === 0 ? (
            <div className="empty-state">{lang === 'he' ? 'לא נמצאו מטלות.' : 'No assignments found.'}</div>
          ) : (
            <div className="sidebar-assignments-list">
              {sortedCourseAssigns.map((a) => {
                const isExpanded = expandedDetailAssignId === a.id;
                const isHidden = isActivityHidden(a, settings?.hiddenAssignments);
                const assignSubjectFiles = (files || []).filter(
                  (f) =>
                    f.courseId === courseId &&
                    f.sectionName &&
                    a.sectionName &&
                    f.sectionName.trim().toLowerCase() === a.sectionName.trim().toLowerCase()
                );

                return (
                  <div
                    key={a.id}
                    className="sidebar-assign-card"
                    style={{
                      borderLeft: lang !== 'he' ? `3px solid ${(a as any).isCompleted || a.status === 'Submitted' ? '#10b981' : '#f59e0b'}` : undefined,
                      borderRight: lang === 'he' ? `3px solid ${(a as any).isCompleted || a.status === 'Submitted' ? '#10b981' : '#f59e0b'}` : undefined,
                      cursor: 'pointer'
                    }}
                    onClick={() => setExpandedDetailAssignId(isExpanded ? null : a.id)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                      <h6 style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexWrap: 'wrap', margin: 0 }}>
                        {a.name}
                        {isHidden && (
                          <span className="assignment-tag tag-hidden" style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger)', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '0.15rem 0.45rem', borderRadius: '4px', fontSize: '0.72rem' }}>
                            {t('hidden_tag')}
                          </span>
                        )}
                        {!(a as any).isCompleted && (a as any).isMoodleSubmitted && (
                          <span className="assignment-tag tag-submitted" title={lang === 'he' ? 'הוגש במודל - סומן לביצוע' : 'Submitted in Moodle - marked as To Do'}>
                            {t('submitted_tag')}
                          </span>
                        )}
                      </h6>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>
                        ▼
                      </span>
                    </div>

                    <p className="assign-status" style={{ margin: '0.35rem 0' }}>
                      {t('status_label')}: {(a as any).isCompleted && !(a as any).isMoodleSubmitted ? t('marked_as_done') : lang === 'he' ? (a.status === 'Submitted' ? 'הוגש' : a.status === 'Not submitted' ? 'טרם הוגש' : a.status === 'Assigned' ? 'הוקצה' : a.status) : a.status}
                    </p>
                    {a.status === 'Submitted' ? (
                      <p className="assign-deadline due-green" style={{ color: '#10b981', margin: 0 }}>
                        {lang === 'he' ? 'הוגש!' : 'Submitted!'} {a.grade !== null && a.gradeMax ? `(${a.grade}/${a.gradeMax})` : ''}
                      </p>
                    ) : (a as any).isCompleted ? (
                      <p className="assign-deadline due-green" style={{ color: '#10b981', margin: 0 }}>
                        {t('marked_as_done')}
                      </p>
                    ) : a.deadline && (() => {
                      const { timeColorClass } = getDueTextAndClass(
                        a.deadline,
                        lang,
                        settings?.assignmentGreenDaysThreshold,
                        settings?.assignmentYellowDaysThreshold,
                        false,
                        a.status
                      );
                      return (
                        <p className={`assign-deadline ${timeColorClass}`} style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                          <span>{lang === 'he' ? 'מועד הגשה:' : 'Due:'} {new Date(a.deadline).toLocaleString()}</span>
                          {a.cutoffDate && hasGracePeriod(a) && (
                            <span
                              className="grace-period-clock-icon"
                              title={formatGracePeriodTooltip(a.cutoffDate, lang)}
                              aria-label={formatGracePeriodTooltip(a.cutoffDate, lang)}
                            >
                              <ClockIcon size={13} />
                            </span>
                          )}
                        </p>
                      );
                    })()}

                    {/* Smoothly expandable body */}
                    <div
                      style={{
                        maxHeight: isExpanded ? '650px' : '0px',
                        opacity: isExpanded ? 1 : 0,
                        overflow: 'hidden',
                        transition: 'max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease, margin 0.2s ease',
                        marginTop: isExpanded ? '0.75rem' : '0px',
                        paddingTop: isExpanded ? '0.75rem' : '0px',
                        borderTop: isExpanded ? '1px solid rgba(255, 255, 255, 0.08)' : 'none'
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {a.attachments && a.attachments.length > 0 && (
                        <div className="files-column-group" style={{ marginBottom: '0.6rem' }}>
                          <div className="files-column-list">
                            {a.attachments.map((att, attIdx) => {
                              const downloadUrl = buildFileDownloadUrl(att.url, token);
                              const openUrl = buildFileOpenUrl(att.url, token);
                              return (
                                <div key={attIdx} className="submitted-file-chip file-column-item" style={{ background: 'rgba(255, 255, 255, 0.03)', borderColor: 'var(--border)' }}>
                                  <span style={{ fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}><FileIcon size={13} style={{ opacity: 0.7, flexShrink: 0 }} /><span>{att.name}</span></span>
                                  <FileOpenAction
                                    rawUrl={att.url}
                                    openUrl={openUrl}
                                    fileName={att.name}
                                    token={token}
                                    t={t}
                                    lang={lang}
                                  />
                                  <a href={downloadUrl} download={att.name} target="_blank" rel="noreferrer" className="file-action-btn file-download-btn" title={t('download_file')} aria-label={t('download_file')}>
                                    <DownloadIcon size={12} />
                                  </a>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Subject Files */}
                      {assignSubjectFiles.length > 0 && (
                        <div className="files-column-group" style={{ marginBottom: '0.6rem' }}>
                          <span className="files-column-label" style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                            {t('subject_files')}:
                          </span>
                          <div className="files-column-list">
                            {assignSubjectFiles.map((sf, sfIdx) => {
                              const downloadUrl = buildFileDownloadUrl(sf.fileUrl, token);
                              const openUrl = buildFileOpenUrl(sf.fileUrl, token);
                              return (
                                <div key={sfIdx} className="submitted-file-chip file-column-item" style={{ background: 'rgba(255, 255, 255, 0.03)', borderColor: 'var(--border)' }}>
                                  <span style={{ fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}><FolderIcon size={13} style={{ opacity: 0.7, flexShrink: 0 }} /><span>{sf.fileName}</span></span>
                                  <FileOpenAction
                                    rawUrl={sf.fileUrl}
                                    openUrl={openUrl}
                                    fileName={sf.fileName}
                                    token={token}
                                    t={t}
                                    lang={lang}
                                  />
                                  <a href={downloadUrl} download={sf.fileName} target="_blank" rel="noreferrer" className="file-action-btn file-download-btn" title={t('download_file')} aria-label={t('download_file')}>
                                    <DownloadIcon size={12} />
                                  </a>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {a.submittedFiles && a.submittedFiles.length > 0 && (
                        <div className="files-column-group" style={{ marginBottom: '0.6rem' }}>
                          <span className="files-column-label" style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                            {lang === 'he' ? 'קבצים שהוגשו:' : 'Submitted files:'}
                          </span>
                          <div className="files-column-list">
                            {a.submittedFiles.map((att, attIdx) => {
                              const downloadUrl = buildFileDownloadUrl(att.url, token);
                              const openUrl = buildFileOpenUrl(att.url, token);
                              return (
                                <div key={`sub-${attIdx}`} className="submitted-file-chip file-column-item">
                                  <CheckIcon size={11} />
                                  <span style={{ fontSize: '0.75rem' }}>{att.name}</span>
                                  <FileOpenAction
                                    rawUrl={att.url}
                                    openUrl={openUrl}
                                    fileName={att.name}
                                    token={token}
                                    t={t}
                                    lang={lang}
                                  />
                                  <a href={downloadUrl} download={att.name} target="_blank" rel="noreferrer" className="file-action-btn file-download-btn" title={t('download_file')} aria-label={t('download_file')}>
                                    <DownloadIcon size={12} />
                                  </a>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                          className="secondary-btn btn-xs"
                          onClick={() => onToggleCompleted && onToggleCompleted(a.uid || getActivityUid(a))}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          <CheckIcon size={12} />
                          <span>{(a as any).isCompleted ? t('mark_incomplete') : t('mark_done')}</span>
                        </button>
                        <button
                          className="secondary-btn btn-xs"
                          onClick={() => onToggleHidden && onToggleHidden(a.uid || getActivityUid(a))}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          {isHidden ? <EyeIcon /> : <EyeOffIcon />}
                          <span>{isHidden ? t('unhide_assignment') : t('hide_assignment')}</span>
                        </button>
                        {a.link && (
                          <a
                            href={a.link}
                            target="_blank"
                            rel="noreferrer"
                            className="primary-btn btn-xs action-submit-btn"
                            data-moodle-link="true"
                          >
                            <span>{t('submit_assignment')}</span>
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 7. ABOUT TAB
function AboutTab({
  t,
  lang,
  tourStep,
  onStartTour,
  logoImg: customLogo,
}: {
  t: (key: any) => string;
  lang: 'he' | 'en';
  tourStep?: number;
  onStartTour: () => void;
  logoImg?: string;
}) {
  const isHe = lang === 'he';
  const manifestVersion = browser.runtime.getManifest()?.version || '4.0.3';

  return (
    <div className={`tab-about glass-panel ${tourStep === 9 ? 'tour-highlight' : ''}`} style={{ padding: '2.5rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Brand Hero Header */}
      <div className="about-hero">
        <img src={customLogo || logoImg} alt="Noodle Logo" className="about-hero-logo" />
        <div>
          <h2 className="about-hero-title">
            <span className="about-brand-text">Noodle</span>
            <span className="about-version-badge">
              <span className="about-version-dot" aria-hidden="true" />
              v{manifestVersion}
            </span>
          </h2>
          <p style={{ margin: 0, fontSize: '1.05rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
            {isHe
              ? 'מרכז השליטה המבוזר למודל אוניברסיטת תל אביב • נבנה עבור סטודנטים ב-TAU'
              : 'Decentralized Moodle Cockpit for Tel Aviv University Students'}
          </p>
        </div>
      </div>

      {/* Description & Credits Card */}
      <div className="about-desc-card">
        <p className="about-desc-text">
          {isHe ? (
            <>
              <strong className="about-brand-highlight">Noodle</strong> הוא כלי עזר חכם בקוד פתוח המאפשר לסנכרן מועדי הגשת מטלות מהמודל ישירות ל-Google Tasks וללוח השנה של גוגל, לסנן קישורי זום בזמן אמת, לעקוב אחר הקלטות פנופטו (בטא), ולהוריד קבצים והנחיות במהירות ובפרטיות מוחלטת ללא שרתים חיצוניים.
            </>
          ) : (
            <>
              <strong className="about-brand-highlight">Noodle</strong> is a decentralized, client-only utility designed for TAU students. It syncs Moodle deadlines directly to Google Tasks and Google Calendar, organizes live Zoom recitations, tracks Panopto recordings (beta), provides fast offline-ready access to files, and protects your privacy without any external backend servers.
            </>
          )}
        </p>

        <div className="about-credits-row">
          <span className="about-credits-author-chip">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <strong>{t('developed_by')}</strong> {t('credits_authors')}
          </span>
        </div>

        {/* Action / Review / Repo Buttons */}
        <div className="about-actions-grid">
          <a
            href="https://noodle.mantin.dev/"
            target="_blank"
            rel="noreferrer"
            className="about-link-card card-accent-web featured"
          >
            <div className="about-link-icon-box">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </div>
            <span>{t('website_link')}</span>
          </a>
          <a
            href="https://chromewebstore.google.com/detail/noodle/nelflkccefbdpnaphjabcgkpakhdoope"
            target="_blank"
            rel="noreferrer"
            className="about-link-card card-accent-review"
          >
            <div className="about-link-icon-box">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </div>
            <span>{t('review_extension_label')}</span>
          </a>
          <a
            href="https://github.com/duck-5/Noodle"
            target="_blank"
            rel="noreferrer"
            className="about-link-card card-accent-github"
          >
            <div className="about-link-icon-box">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
              </svg>
            </div>
            <span>{t('github_repo_link')}</span>
          </a>
          <a
            href="https://github.com/duck-5/Noodle/issues"
            target="_blank"
            rel="noreferrer"
            className="about-link-card card-accent-issues"
          >
            <div className="about-link-icon-box">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <span>{t('github_issues_link')}</span>
          </a>
          <a
            href="mailto:noodle.d3v@gmail.com"
            className="about-link-card card-accent-email"
          >
            <div className="about-link-icon-box">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
            </div>
            <span>noodle.d3v@gmail.com</span>
          </a>
          <div
            className="about-link-card card-accent-tour"
            onClick={onStartTour}
            style={{ cursor: 'pointer' }}
          >
            <div className="about-link-icon-box">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
            <span>{isHe ? 'סיור מודרך' : 'Interactive Tour'}</span>
          </div>
        </div>
      </div>

      {/* Expandable Sections */}
      <div>
        {/* Accordion 1: Features */}
        <details className="about-accordion section-features" open>
          <summary>
            <div className="about-summary-left">
              <div className="about-summary-icon-box accent-indigo">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </div>
              <span>{t('about_features_title')}</span>
            </div>
            <div className="about-summary-right">
              <span className="about-count-badge accent-indigo">7</span>
              <span className="about-accordion-chevron" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </div>
          </summary>
          <div className="about-accordion-content">
            {isHe ? (
              <ul className="about-items-list">
                <li className="about-item-card accent-sky">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                      <polyline points="9 16 11 18 15 14" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">סנכרון דו-כיווני ל-Google Tasks ולוח שנה:</strong>
                    <span>דדליינים מהמודל מסונכרנים אוטומטית לרשימת המשימות שלך. משימות שסימנת כבוצעות או שמחקת מסונכרנות באופן שקוף.</span>
                  </div>
                </li>
                <li className="about-item-card accent-purple">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M10 2v7.31L4.69 18.2A2 2 0 0 0 6.4 21h11.2a2 2 0 0 0 1.71-2.8L14 9.31V2" />
                      <line x1="8.5" y1="2" x2="15.5" y2="2" />
                      <line x1="14" y1="9.3" x2="10" y2="9.3" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">זיהוי חכם לקורסי מעבדה:</strong>
                    <span>זיהוי אוטומטי של המילה "מעבדה" בשם הקורס והצעה להסתרת כל המטלות כברירת מחדל, כדי שלא תוצף בעשרות ניסויים שאינך נדרש להגיש.</span>
                  </div>
                </li>
                <li className="about-item-card accent-amber">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="13" r="8" />
                      <polyline points="12 9 12 13 15 15" />
                      <line x1="12" y1="2" x2="12" y2="5" />
                      <line x1="18.5" y1="5.5" x2="20.5" y2="7.5" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">Spotlight וספירה לאחור חיה:</strong>
                    <span>כרטיס המטלה הבאה מציג ספירה לאחור מדויקת עם צבעי התראה מותאמים אישית (ירוק/צהוב/אדום) וקישורי הגשה וקבצים ישירים.</span>
                  </div>
                </li>
                <li className="about-item-card accent-emerald">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polygon points="23 7 16 12 23 17 23 7" />
                      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">Zoom Hub לשיעורים ותרגולים:</strong>
                    <span>זיהוי הרצאות ותרגולים שמתקיימים כעת והצטרפות בלחיצה אחת, עם אפשרות להסתיר קבוצות תרגול לא רלוונטיות.</span>
                  </div>
                </li>
                <li className="about-item-card accent-rose">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <polygon points="10 8 16 12 10 16 10 8" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">מעקב הקלטות Panopto (בטא):</strong>
                    <span>סנכרון אוטומטי של הרצאות ותרגולים מוקלטים מתוך תיקיות פנופטו ישירות לנושאי הקורס.</span>
                  </div>
                </li>
                <li className="about-item-card accent-sky">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      <line x1="12" y1="11" x2="12" y2="17" />
                      <polyline points="9 14 12 17 15 14" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">גישה ישירה לקבצים ולהגשות:</strong>
                    <span>צפייה והורדה של קבצי הנחיות, קבצי נושא וקבצים שהגשת בעבר ישירות מתוך התוסף ללא מעבר בין דפי המודל.</span>
                  </div>
                </li>
                <li className="about-item-card accent-orange">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
                      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
                      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
                      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
                      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">ערכות נושא מותאמות:</strong>
                    <span>בחירה בין ערכת נושא כהה (Dark), נודלס חמים (Noodle), או קפה אספרסו עשיר (Coffee).</span>
                  </div>
                </li>
              </ul>
            ) : (
              <ul className="about-items-list">
                <li className="about-item-card accent-sky">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                      <polyline points="9 16 11 18 15 14" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">2-Way Google Tasks & Calendar Sync:</strong>
                    <span>Automatically synchronize deadlines to Google Tasks with instant updates when assignments are marked done or submitted.</span>
                  </div>
                </li>
                <li className="about-item-card accent-purple">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M10 2v7.31L4.69 18.2A2 2 0 0 0 6.4 21h11.2a2 2 0 0 0 1.71-2.8L14 9.31V2" />
                      <line x1="8.5" y1="2" x2="15.5" y2="2" />
                      <line x1="14" y1="9.3" x2="10" y2="9.3" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">Lab Course Experiment Detection:</strong>
                    <span>Detects lab courses ("מעבדה") and offers to hide all assignments by default so you aren't overwhelmed with experiments you don't take.</span>
                  </div>
                </li>
                <li className="about-item-card accent-amber">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="13" r="8" />
                      <polyline points="12 9 12 13 15 15" />
                      <line x1="12" y1="2" x2="12" y2="5" />
                      <line x1="18.5" y1="5.5" x2="20.5" y2="7.5" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">Next Task Spotlight & Live Countdown:</strong>
                    <span>Real-time countdown for upcoming submissions with customizable color thresholds (green/yellow/red) and 1-click submission links.</span>
                  </div>
                </li>
                <li className="about-item-card accent-emerald">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polygon points="23 7 16 12 23 17 23 7" />
                      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">Zoom Hub:</strong>
                    <span>Highlights active lectures and recitations happening right now, with easy per-meeting visibility toggles to hide recitations you don't attend.</span>
                  </div>
                </li>
                <li className="about-item-card accent-rose">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <polygon points="10 8 16 12 10 16 10 8" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">Panopto Recordings Tracking:</strong>
                    <span>Automatic sync of lecture and recitation recordings from Panopto folders directly grouped within course views.</span>
                  </div>
                </li>
                <li className="about-item-card accent-sky">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      <line x1="12" y1="11" x2="12" y2="17" />
                      <polyline points="9 14 12 17 15 14" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">Fast File Browser & Attachments:</strong>
                    <span>View and download subject materials, prompt PDFs, and your past submitted files without navigating endless Moodle pages.</span>
                  </div>
                </li>
                <li className="about-item-card accent-orange">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
                      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
                      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
                      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
                      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">Custom Themes:</strong>
                    <span>Switch anytime between Dark, Noodle (warm terracotta), and Coffee (deep espresso).</span>
                  </div>
                </li>
              </ul>
            )}
          </div>
        </details>

        {/* Accordion 2: Usage Tips */}
        <details className="about-accordion section-tips">
          <summary>
            <div className="about-summary-left">
              <div className="about-summary-icon-box accent-amber">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="9" y1="18" x2="15" y2="18" />
                  <line x1="10" y1="22" x2="14" y2="22" />
                  <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
                </svg>
              </div>
              <span>{t('about_tips_title')}</span>
            </div>
            <div className="about-summary-right">
              <span className="about-count-badge accent-amber">5</span>
              <span className="about-accordion-chevron" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </div>
          </summary>
          <div className="about-accordion-content">
            {isHe ? (
              <ul className="about-items-list">
                <li className="about-item-card accent-purple">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">איך להשתמש במעבדות ביעילות?</strong>
                    <span>לאחר הוספת קורס מעבדה והסתרת כל המטלות, עבור ללשונית "מטלות", סמן את תיבת הסינון "מוסתרים", ולחץ על סמל העין רק ליד הניסויים שהוקצו לך. כך תראה בלוח הבקרה רק את הניסויים שבאמת עליך לבצע!</span>
                  </div>
                </li>
                <li className="about-item-card accent-sky">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="16" />
                      <line x1="8" y1="12" x2="16" y2="12" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">סנכרון מטלות ללא תאריך יעד:</strong>
                    <span>סטודנטים רבים רוצים לראות גם פרויקטים פתוחים או תרגילי רשות ברשימת המשימות שלהם. ניתן להפעיל זאת בקלות בהגדרות Google Tasks.</span>
                  </div>
                </li>
                <li className="about-item-card accent-amber">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                      <line x1="7" y1="7" x2="7.01" y2="7" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">כינויי קורסים וצבעים:</strong>
                    <span>לחץ על "ניהול קורסים" בלוח הבקרה והענק לכל קורס שם קצר ומוכר וצבע ייחודי שיסונכרן בכל הממשק.</span>
                  </div>
                </li>
                <li className="about-item-card accent-emerald">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">גיבוי ושחזור קונפיגורציה:</strong>
                    <span>עובר למחשב אחר או משתמש גם בפיירפוקס? ייצא קובץ גיבוי בלשונית ההגדרות וייבא אותו בשניות בכל דפדפן.</span>
                  </div>
                </li>
                <li className="about-item-card accent-indigo">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
                      <line x1="6" y1="8" x2="8" y2="8" />
                      <line x1="10" y1="8" x2="14" y2="8" />
                      <line x1="16" y1="8" x2="18" y2="8" />
                      <line x1="6" y1="12" x2="8" y2="12" />
                      <line x1="10" y1="12" x2="14" y2="12" />
                      <line x1="16" y1="12" x2="18" y2="12" />
                      <line x1="7" y1="16" x2="17" y2="16" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">קיצורי דרך בסיור המודרך:</strong>
                    <span>השתמש במקשי החצים ימינה ושמאלה כדי לנווט בין שלבי הסיור, ולחץ על Esc כדי לצאת בכל עת.</span>
                  </div>
                </li>
              </ul>
            ) : (
              <ul className="about-items-list">
                <li className="about-item-card accent-purple">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">How to efficiently handle lab courses:</strong>
                    <span>When adding a lab course, choose to hide all assignments. Then head over to the Assignments tab, check the "Hidden" filter, and click the eye icon only on the experiments you actually need to submit!</span>
                  </div>
                </li>
                <li className="about-item-card accent-sky">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="16" />
                      <line x1="8" y1="12" x2="16" y2="12" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">Syncing tasks without a deadline:</strong>
                    <span>If you want ongoing projects and optional exercises to appear in your Google Tasks, enable "Sync assignments without deadline" under Settings.</span>
                  </div>
                </li>
                <li className="about-item-card accent-amber">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                      <line x1="7" y1="7" x2="7.01" y2="7" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">Custom Course Nicknames & Colors:</strong>
                    <span>Tap "Manage Courses" on your dashboard to assign short nicknames and distinct colors for instant recognition across all tabs.</span>
                  </div>
                </li>
                <li className="about-item-card accent-emerald">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">Cross-device Backup & Restore:</strong>
                    <span>Switching laptops or using both Chrome and Firefox? Export your JSON config in Settings and import it anywhere in seconds.</span>
                  </div>
                </li>
                <li className="about-item-card accent-indigo">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
                      <line x1="6" y1="8" x2="8" y2="8" />
                      <line x1="10" y1="8" x2="14" y2="8" />
                      <line x1="16" y1="8" x2="18" y2="8" />
                      <line x1="6" y1="12" x2="8" y2="12" />
                      <line x1="10" y1="12" x2="14" y2="12" />
                      <line x1="16" y1="12" x2="18" y2="12" />
                      <line x1="7" y1="16" x2="17" y2="16" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">Keyboard Navigation:</strong>
                    <span>During the interactive tour, use arrow keys to navigate forward/back and hit Escape to exit at any time.</span>
                  </div>
                </li>
              </ul>
            )}
          </div>
        </details>

        {/* Accordion 3: Privacy */}
        <details className="about-accordion section-privacy">
          <summary>
            <div className="about-summary-left">
              <div className="about-summary-icon-box accent-emerald">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              </div>
              <span>{t('about_privacy_title')}</span>
            </div>
            <div className="about-summary-right">
              <span className="about-count-badge accent-emerald">4</span>
              <span className="about-accordion-chevron" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </div>
          </summary>
          <div className="about-accordion-content">
            {isHe ? (
              <ul className="about-items-list">
                <li className="about-item-card accent-emerald">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="2" y1="12" x2="22" y2="12" />
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">100% Client-Only & Decentralized:</strong>
                    <span>Noodle פועל אך ורק בתוך הדפדפן שלך. אין לנו שרת מרכזי, שרת פרוקסי או בסיס נתונים בענן.</span>
                  </div>
                </li>
                <li className="about-item-card accent-teal">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">ללא מעקב או טלמטריה:</strong>
                    <span>אפס מעקב (Analytics), אפס קוקיות מעקב ואפס שיתוף נתונים עם צדדים שלישיים.</span>
                  </div>
                </li>
                <li className="about-item-card accent-sky">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">אחסון מקומי מאובטח:</strong>
                    <span>פרטי החיבור ואסימון הגישה למודל נשמרים באחסון המקומי של הדפדפן שלך בלבד (browser.storage.local).</span>
                  </div>
                </li>
                <li className="about-item-card accent-purple">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="16 18 22 12 16 6" />
                      <polyline points="8 6 2 12 8 18" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">קוד פתוח ושקוף:</strong>
                    <span>הקוד זמין במלואו לבדיקה ותרומה ב-GitHub, ונכתב מתוך אהבה ומחויבות לקהילת הסטודנטים ב-TAU.</span>
                  </div>
                </li>
              </ul>
            ) : (
              <ul className="about-items-list">
                <li className="about-item-card accent-emerald">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="2" y1="12" x2="22" y2="12" />
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">100% Client-Only & Decentralized:</strong>
                    <span>Noodle executes entirely within your browser. There is no middleman server, proxy, or backend database.</span>
                  </div>
                </li>
                <li className="about-item-card accent-teal">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">Zero Analytics or Telemetry:</strong>
                    <span>No tracking scripts, no behavioral telemetry, and no third-party data collection whatsoever.</span>
                  </div>
                </li>
                <li className="about-item-card accent-sky">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">Secure Local Storage:</strong>
                    <span>All credentials and Moodle access tokens are stored strictly within your browser's private local storage (browser.storage.local).</span>
                  </div>
                </li>
                <li className="about-item-card accent-purple">
                  <div className="about-item-icon-box">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="16 18 22 12 16 6" />
                      <polyline points="8 6 2 12 8 18" />
                    </svg>
                  </div>
                  <div className="about-item-text">
                    <strong className="about-item-title">Open Source Transparency:</strong>
                    <span>The complete codebase is open on GitHub for auditing, contributions, and community improvements.</span>
                  </div>
                </li>
              </ul>
            )}
          </div>
        </details>
      </div>
    </div>
  );
}

// 8. TOUR OVERLAY
interface TourOverlayProps {
  step: number;
  setStep: (s: number) => void;
  onClose: () => void;
  t: (key: any) => string;
  lang: 'he' | 'en';
}

function TourOverlay({ step, setStep, onClose, t, lang }: TourOverlayProps) {
  const steps: {
    icon: React.ReactNode;
    title: string;
    tag: string;
    desc: string;
    chips: string[];
  }[] = [
      {
        icon: <DashboardIcon size={22} />,
        title: t('tour_welcome_title'),
        tag: t('tour_welcome_tag'),
        desc: t('tour_welcome_desc'),
        chips: lang === 'he' ? ['מודל את"א', 'ללא שרת', 'פרטיות מלאה'] : ['TAU Moodle', 'Decentralized', 'Zero Server'],
      },
      {
        icon: <SyncIcon size={22} />,
        title: t('tour_sync_btn_title'),
        tag: t('tour_sync_btn_tag'),
        desc: t('tour_sync_btn_desc'),
        chips: lang === 'he' ? ['סנכרון מיידי', 'חלונית מתקפלת', 'Google Tasks'] : ['Live Sync', 'Collapsible Dock', 'Google Tasks'],
      },
      {
        icon: <AssignmentsIcon size={22} />,
        title: t('tour_next_task_title'),
        tag: t('tour_next_task_tag'),
        desc: t('tour_next_task_desc'),
        chips: lang === 'he' ? ['חלונית פרטים חיה', 'השלמות פאנופטו', 'הסרת משימות'] : ['Live Split Pane', 'Panopto Catch-Up', 'Dismiss Tasks'],
      },
      {
        icon: <VideoIcon size={22} />,
        title: t('tour_tasks_actions_title'),
        tag: t('tour_tasks_actions_tag'),
        desc: t('tour_tasks_actions_desc'),
        chips: lang === 'he' ? ['מפגשי Zoom חיים', 'תצוגת כרטיסים / רשימה', 'חישוב פערים נקי'] : ['Live Zoom Strip', 'Cards & List Views', 'Filtered Gaps'],
      },
      {
        icon: <BookOpenIcon size={22} />,
        title: t('tour_courses_custom_title'),
        tag: t('tour_courses_custom_tag'),
        desc: t('tour_courses_custom_desc'),
        chips: lang === 'he' ? ['כינויים וצבעים', 'מיפוי מרצים ומתרגלים', 'מעקב סמסטריאלי'] : ['Nicknames & Colors', 'Lecturer & TA Mapping', 'Semester Tracking'],
      },
      {
        icon: <FolderIcon size={22} />,
        title: t('tour_zoom_visibility_title'),
        tag: t('tour_zoom_visibility_tag'),
        desc: t('tour_zoom_visibility_desc'),
        chips: lang === 'he' ? ['הורדת תיקיות כ-ZIP', 'פתיחת קבצים במחשב', 'עקוב אחרי מנחה'] : ['Folder ZIP Download', 'Open PC Files', 'Track This Host'],
      },
      {
        icon: <CheckIcon size={22} />,
        title: t('tour_tab_assignments_title'),
        tag: t('tour_tab_assignments_tag'),
        desc: t('tour_tab_assignments_desc'),
        chips: lang === 'he' ? ['חיפוש מיידי', '4 מסנני סטטוס', 'חלון חסד להגשה'] : ['Instant Search', '4 Status Filters', 'Grace Period Clocks'],
      },
      {
        icon: <GradesIcon size={22} />,
        title: t('tour_tab_grades_title'),
        tag: t('tour_tab_grades_tag'),
        desc: t('tour_tab_grades_desc'),
        chips: lang === 'he' ? ['ממוצע משוקלל', 'פירוט רכיבים', 'סנכרון ישיר ממודל'] : ['Weighted GPA', 'Components Breakdown', 'Direct Moodle Sync'],
      },
      {
        icon: <SettingsIcon size={22} />,
        title: t('tour_google_tasks_title'),
        tag: t('tour_google_tasks_tag'),
        desc: t('tour_google_tasks_desc'),
        chips: lang === 'he' ? ['סנכרון תיקייה מקומית', 'Google Tasks דו-כיווני', '4 ערכות נושא'] : ['Local Folder Sync', '2-Way Google Tasks', '4 Themes'],
      },
      {
        icon: <AboutIcon size={22} />,
        title: t('tour_finish_title'),
        tag: t('tour_finish_tag'),
        desc: t('tour_finish_desc'),
        chips: lang === 'he' ? ['הפעלה מחדש מ"אודות"', 'קיצורי מקלדת', 'משוב ב-GitHub'] : ['Restart via About', 'Keyboard Shortcuts', 'GitHub Feedback'],
      },
    ];

  const currentStep = steps[step] || steps[0];
  const isHighlightStep = step >= 1 && step <= 8;

  // Auto-scroll to highlighted element with smooth animation
  useEffect(() => {
    if (isHighlightStep) {
      const timer = setTimeout(() => {
        const highlightedEl = document.querySelector('.tour-highlight');
        if (highlightedEl) {
          highlightedEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 160);
      return () => clearTimeout(timer);
    }
  }, [step, isHighlightStep]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      const isNextKey = lang === 'he' ? e.key === 'ArrowLeft' : e.key === 'ArrowRight';
      const isBackKey = lang === 'he' ? e.key === 'ArrowRight' : e.key === 'ArrowLeft';

      if (isNextKey) {
        e.preventDefault();
        if (step < steps.length - 1) {
          setStep(step + 1);
        } else {
          onClose();
        }
      } else if (isBackKey) {
        e.preventDefault();
        if (step > 0) {
          setStep(step - 1);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [step, lang, onClose, setStep, steps.length]);

  const handleNext = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      onClose();
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  return (
    <div className={`tour-overlay ${isHighlightStep ? 'highlight-mode' : ''}`} dir={lang === 'he' ? 'rtl' : 'ltr'}>
      <div className="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-step-title">
        {/* Segmented Stepper */}
        <div className="tour-stepper" aria-label={`Step ${step + 1} of ${steps.length}`}>
          {steps.map((_, idx) => (
            <div
              key={idx}
              className={`tour-stepper-bar ${idx < step ? 'completed' : ''} ${idx === step ? 'active' : ''}`}
              onClick={() => setStep(idx)}
              title={`${idx + 1}. ${steps[idx].title}`}
            />
          ))}
        </div>

        {/* Header with Tag & Icon Badge */}
        <div className="tour-header">
          <div className="tour-badge-group">
            <span className="tour-icon-badge">{currentStep.icon}</span>
            <div className="tour-badge-text">
              <span className="tour-tag-pill">{currentStep.tag}</span>
              <span className="tour-step-indicator">{step + 1} / {steps.length}</span>
            </div>
          </div>
          <button
            className="tour-close-btn"
            onClick={onClose}
            aria-label={t('tour_skip')}
            title={t('tour_skip')}
          >
            ✕
          </button>
        </div>

        {/* Step Title & Body */}
        <div className="tour-body">
          <h3 id="tour-step-title" className="tour-title">{currentStep.title}</h3>
          <p className="tour-desc">{currentStep.desc}</p>
        </div>

        {/* Feature Chips */}
        {currentStep.chips && currentStep.chips.length > 0 && (
          <div className="tour-chips-container">
            {currentStep.chips.map((chip, cIdx) => (
              <span key={cIdx} className="tour-chip">
                {chip}
              </span>
            ))}
          </div>
        )}

        {/* Keyboard hints banner */}
        <div className="tour-keyboard-hint-row">
          <span className="tour-key-badge">{lang === 'he' ? '←' : '→'}</span>
          <span className="tour-key-badge">{lang === 'he' ? '→' : '←'}</span>
          <span className="tour-key-badge">Esc</span>
          <span className="tour-hint-text">{t('tour_keyboard_hint')}</span>
        </div>

        {/* Action Footer */}
        <div className="tour-footer">
          <button className="secondary-btn btn-sm" onClick={onClose}>
            {t('tour_skip')}
          </button>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {step > 0 && (
              <button className="secondary-btn btn-sm" onClick={handleBack}>
                {t('tour_back')}
              </button>
            )}
            <button className="primary-btn btn-sm" onClick={handleNext}>
              {step === steps.length - 1 ? t('tour_finish') : t('tour_next')}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
