import { useEffect, useRef, useState } from 'react';
import type {
  CoursePanoptoStaffEntry,
  CourseStaffMember,
  PanoptoRecordingType,
} from '@tautracker/moodle-client';
import {
  doesHostMatchPersonName,
  normalizePersonName,
  transliterateHebrewNameToEnglish,
} from '@tautracker/moodle-client';

interface PanoptoStaffEditorProps {
  courseId: number;
  entries: CoursePanoptoStaffEntry[];
  moodleStaff?: CourseStaffMember[];
  detectedHosts?: string[];
  onSaveEntries: (courseId: number, entries: CoursePanoptoStaffEntry[]) => void;
  onImportFromMoodle: (courseId: number) => Promise<CourseStaffMember[]>;
  t: (key: string) => string;
  lang: 'he' | 'en';
}

export function PanoptoStaffEditor({
  courseId,
  entries,
  moodleStaff,
  detectedHosts = [],
  onSaveEntries,
  onImportFromMoodle,
  t,
  lang,
}: PanoptoStaffEditorProps) {
  const [draftEntries, setDraftEntries] = useState<CoursePanoptoStaffEntry[]>(entries);
  const [prevSyncedProps, setPrevSyncedProps] = useState({
    courseId,
    serialized: JSON.stringify(entries),
  });
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [newHostName, setNewHostName] = useState('');
  const [newRole, setNewRole] = useState<PanoptoRecordingType>('Lecture');
  const draftEntriesRef = useRef<CoursePanoptoStaffEntry[]>(draftEntries);

  useEffect(() => {
    draftEntriesRef.current = draftEntries;
  }, [draftEntries]);

  const serializedEntries = JSON.stringify(entries);
  if (prevSyncedProps.courseId !== courseId || prevSyncedProps.serialized !== serializedEntries) {
    setPrevSyncedProps({ courseId, serialized: serializedEntries });
    setDraftEntries(entries);
  }

  const commitEntries = (next: CoursePanoptoStaffEntry[]) => {
    draftEntriesRef.current = next;
    setDraftEntries(next);
    const cleaned = next.filter(
      (item) =>
        (item.panoptoName && item.panoptoName.trim().length > 0) ||
        (item.moodleName && item.moodleName.trim().length > 0)
    );
    onSaveEntries(courseId, cleaned);
  };

  const mergeStaffMembers = (
    base: CoursePanoptoStaffEntry[],
    members: CourseStaffMember[]
  ): { merged: CoursePanoptoStaffEntry[]; addedCount: number } => {
    const next = [...base];
    const existingKeys = new Set<string>();
    for (const item of next) {
      if (item.moodleName) existingKeys.add(normalizePersonName(item.moodleName));
      if (item.panoptoName) existingKeys.add(normalizePersonName(item.panoptoName));
    }

    let addedCount = 0;
    for (const member of members) {
      const moodleNorm = normalizePersonName(member.fullName);
      const englishNorm = member.englishName ? normalizePersonName(member.englishName) : '';
      if ((moodleNorm && existingKeys.has(moodleNorm)) || (englishNorm && existingKeys.has(englishNorm))) {
        continue;
      }
      const suggestedPanopto =
        member.englishName?.trim() || transliterateHebrewNameToEnglish(member.fullName).trim();
      next.push({
        moodleName: member.fullName,
        panoptoName: suggestedPanopto,
        role: member.role,
      });
      if (moodleNorm) existingKeys.add(moodleNorm);
      if (suggestedPanopto) existingKeys.add(normalizePersonName(suggestedPanopto));
      addedCount++;
    }

    return { merged: next, addedCount };
  };

  const handleImportClick = async () => {
    setImporting(true);
    setImportNotice(null);
    try {
      let members = await onImportFromMoodle(courseId);
      if ((!members || members.length === 0) && moodleStaff && moodleStaff.length > 0) {
        members = moodleStaff;
      }
      if (!members || members.length === 0) {
        setImportNotice(t('panopto_staff_import_none'));
        return;
      }
      const { merged } = mergeStaffMembers(draftEntriesRef.current, members);
      commitEntries(merged);
    } finally {
      setImporting(false);
    }
  };

  const handleAddManual = () => {
    const trimmed = newHostName.trim();
    if (!trimmed) return;
    const norm = normalizePersonName(trimmed);
    const existingIdx = draftEntries.findIndex(
      (e) =>
        (norm && normalizePersonName(e.panoptoName) === norm) ||
        (norm && e.moodleName && normalizePersonName(e.moodleName) === norm)
    );
    const next =
      existingIdx >= 0
        ? draftEntries.map((item, i) => (i === existingIdx ? { ...item, panoptoName: trimmed, role: newRole } : item))
        : [...draftEntries, { panoptoName: trimmed, role: newRole }];
    setNewHostName('');
    commitEntries(next);
  };

  const handleAddDetectedHost = (host: string, role: PanoptoRecordingType = 'Lecture') => {
    const trimmed = host.trim();
    if (!trimmed) return;
    const norm = normalizePersonName(trimmed);
    const alreadyExists = draftEntries.some(
      (e) =>
        normalizePersonName(e.panoptoName) === norm ||
        (e.moodleName && normalizePersonName(e.moodleName) === norm)
    );
    if (alreadyExists) return;
    commitEntries([...draftEntries, { panoptoName: trimmed, role }]);
  };

  const handleRoleChange = (idx: number, role: PanoptoRecordingType) => {
    const next = draftEntries.map((item, i) => (i === idx ? { ...item, role } : item));
    commitEntries(next);
  };

  const handlePanoptoNameChange = (idx: number, value: string) => {
    setDraftEntries((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, panoptoName: value } : item))
    );
  };

  const handlePanoptoNameBlur = () => {
    commitEntries(draftEntries);
  };

  const handleRemove = (idx: number) => {
    const next = draftEntries.filter((_, i) => i !== idx);
    commitEntries(next);
  };

  const { mappedNorms, unmappedHosts } = (() => {
    const norms = new Set(
      draftEntries.flatMap((e) => [
        normalizePersonName(e.panoptoName),
        e.moodleName ? normalizePersonName(e.moodleName) : '',
      ]).filter(Boolean)
    );
    return {
      mappedNorms: norms,
      unmappedHosts: detectedHosts.filter((h) => !norms.has(normalizePersonName(h))),
    };
  })();
  void mappedNorms;

  return (
    <div className="panopto-staff-editor" dir={lang === 'he' ? 'rtl' : 'ltr'}>
      <div className="panopto-staff-header">
        <div>
          <div className="panopto-staff-title">{t('panopto_staff_title')}</div>
          <div className="panopto-staff-desc">{t('panopto_staff_desc')}</div>
        </div>
        <button
          type="button"
          className="secondary-btn btn-xs panopto-staff-import-btn"
          onClick={handleImportClick}
          disabled={importing}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={importing ? 'spinning-sync-icon' : ''}
          >
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="19" y1="8" x2="19" y2="14" />
            <line x1="22" y1="11" x2="16" y2="11" />
          </svg>
          <span>{importing ? t('panopto_staff_importing') : t('panopto_staff_import_moodle')}</span>
        </button>
      </div>

      {importNotice && (
        <div className="panopto-staff-notice">{importNotice}</div>
      )}

      {unmappedHosts.length > 0 && (
        <div className="panopto-detected-hosts-row">
          <span className="panopto-detected-hosts-label">{t('panopto_staff_detected_hosts')}</span>
          <div className="panopto-detected-hosts-chips">
            {unmappedHosts.map((host) => (
              <div key={host} className="panopto-detected-host-chip" dir="ltr">
                <span>{host}</span>
                <button
                  type="button"
                  className="panopto-chip-role-btn lecture"
                  onClick={() => handleAddDetectedHost(host, 'Lecture')}
                  title={t('panopto_staff_lecturer')}
                >
                  + {t('panopto_lecture_badge')}
                </button>
                <button
                  type="button"
                  className="panopto-chip-role-btn recitation"
                  onClick={() => handleAddDetectedHost(host, 'Recitation')}
                  title={t('panopto_staff_ta')}
                >
                  + {t('panopto_recitation_badge')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {draftEntries.length === 0 ? (
        <div className="panopto-staff-empty">{t('panopto_staff_empty')}</div>
      ) : (
        <div className="panopto-staff-list">
          {draftEntries.map((entry, idx) => (
            <div key={`${entry.moodleName || ''}-${idx}`} className="panopto-staff-row">
              {entry.moodleName && (
                <span className="panopto-staff-moodle-badge" title={`${t('panopto_staff_moodle_label')} ${entry.moodleName}`}>
                  {entry.moodleName}
                </span>
              )}
              <input
                type="text"
                className="nickname-input panopto-staff-host-input"
                dir="ltr"
                value={entry.panoptoName}
                placeholder={
                  entry.moodleName
                    ? transliterateHebrewNameToEnglish(entry.moodleName) || t('panopto_staff_host_placeholder')
                    : t('panopto_staff_host_placeholder')
                }
                onChange={(e) => handlePanoptoNameChange(idx, e.target.value)}
                onBlur={handlePanoptoNameBlur}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
              />
              <div className="panopto-staff-role-toggle" role="group">
                <button
                  type="button"
                  className={`panopto-role-btn ${entry.role === 'Lecture' ? 'active lecture' : ''}`}
                  onClick={() => handleRoleChange(idx, 'Lecture')}
                >
                  {t('panopto_staff_lecturer')}
                </button>
                <button
                  type="button"
                  className={`panopto-role-btn ${entry.role === 'Recitation' ? 'active recitation' : ''}`}
                  onClick={() => handleRoleChange(idx, 'Recitation')}
                >
                  {t('panopto_staff_ta')}
                </button>
              </div>
              <button
                type="button"
                className="btn-ghost panopto-staff-remove-btn"
                onClick={() => handleRemove(idx)}
                aria-label={t('panopto_staff_remove')}
                title={t('panopto_staff_remove')}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="panopto-staff-add-row">
        <input
          type="text"
          className="nickname-input panopto-staff-host-input"
          dir="ltr"
          value={newHostName}
          placeholder={t('panopto_staff_host_placeholder')}
          onChange={(e) => setNewHostName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAddManual();
            }
          }}
        />
        <div className="panopto-staff-role-toggle" role="group">
          <button
            type="button"
            className={`panopto-role-btn ${newRole === 'Lecture' ? 'active lecture' : ''}`}
            onClick={() => setNewRole('Lecture')}
          >
            {t('panopto_staff_lecturer')}
          </button>
          <button
            type="button"
            className={`panopto-role-btn ${newRole === 'Recitation' ? 'active recitation' : ''}`}
            onClick={() => setNewRole('Recitation')}
          >
            {t('panopto_staff_ta')}
          </button>
        </div>
        <button
          type="button"
          className="secondary-btn btn-xs"
          onClick={handleAddManual}
          disabled={!newHostName.trim()}
          style={{ whiteSpace: 'nowrap' }}
        >
          + {t('panopto_staff_add_manual')}
        </button>
      </div>
    </div>
  );
}

interface CourseStaffHostColumnCellProps {
  courseId: number;
  role: PanoptoRecordingType;
  entries: CoursePanoptoStaffEntry[];
  moodleStaff?: CourseStaffMember[];
  detectedHosts?: string[];
  isLoadingMoodle?: boolean;
  onSaveEntries: (courseId: number, entries: CoursePanoptoStaffEntry[]) => void;
  onRefreshFromMoodle?: (courseId: number) => Promise<CourseStaffMember[]>;
  t: (key: string) => string;
  lang: 'he' | 'en';
}

/**
 * Inline table cell for picking or manually adding a course's Lecturer (Lecture Host)
 * or TA (Recitation Host) inside Manage Courses.
 */
export function CourseStaffHostColumnCell({
  courseId,
  role,
  entries,
  moodleStaff = [],
  detectedHosts = [],
  isLoadingMoodle = false,
  onSaveEntries,
  onRefreshFromMoodle,
  t,
  lang,
}: CourseStaffHostColumnCellProps) {
  const [manualHost, setManualHost] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const roleEntries = entries
    .map((entry, originalIndex) => ({ entry, originalIndex }))
    .filter(({ entry }) => entry.role === role);

  const selectedNormsForRole = new Set(
    roleEntries.flatMap(({ entry }) => [
      normalizePersonName(entry.panoptoName),
      entry.moodleName ? normalizePersonName(entry.moodleName) : '',
    ]).filter(Boolean)
  );

  // Build deduplicated combobox options: same-role Moodle staff first, then remaining Moodle staff, then detected hosts
  const seenOptionNorms = new Set<string>(selectedNormsForRole);
  const matchedOptionHosts: string[] = [];
  const moodlePrimaryOptions: Array<{ id: string; label: string; moodleName: string; panoptoName: string }> = [];
  const moodleOtherOptions: Array<{ id: string; label: string; moodleName: string; panoptoName: string }> = [];

  moodleStaff.forEach((member, idx) => {
    const moodleNorm = normalizePersonName(member.fullName);
    const englishNorm = member.englishName ? normalizePersonName(member.englishName) : '';
    if (!moodleNorm && !englishNorm) return;
    if ((moodleNorm && seenOptionNorms.has(moodleNorm)) || (englishNorm && seenOptionNorms.has(englishNorm))) {
      return;
    }
    const matchingDetectedHost = detectedHosts.find(
      (h) =>
        doesHostMatchPersonName(h, member.fullName, true) ||
        (member.englishName ? doesHostMatchPersonName(h, member.englishName, true) : false)
    );
    const suggested =
      matchingDetectedHost?.trim() ||
      member.englishName?.trim() ||
      transliterateHebrewNameToEnglish(member.fullName).trim();
    const label =
      suggested && suggested !== member.fullName
        ? `${member.fullName} (${suggested})`
        : member.fullName;
    const opt = {
      id: `moodle:${idx}:${member.fullName}`,
      label,
      moodleName: member.fullName,
      panoptoName: suggested || member.fullName,
    };
    if (member.role === role) {
      moodlePrimaryOptions.push(opt);
    } else {
      moodleOtherOptions.push(opt);
    }
    if (moodleNorm) seenOptionNorms.add(moodleNorm);
    if (englishNorm) seenOptionNorms.add(englishNorm);
    if (suggested) {
      seenOptionNorms.add(normalizePersonName(suggested));
      matchedOptionHosts.push(suggested);
    }
  });

  const detectedOptions: Array<{ id: string; label: string; panoptoName: string }> = [];
  for (const host of detectedHosts) {
    const trimmed = host.trim();
    const norm = normalizePersonName(trimmed);
    const matchesExistingMoodle = matchedOptionHosts.some((mh) => doesHostMatchPersonName(trimmed, mh, true));
    if (!trimmed || !norm || seenOptionNorms.has(norm) || matchesExistingMoodle) continue;
    seenOptionNorms.add(norm);
    detectedOptions.push({
      id: `host:${trimmed}`,
      label: trimmed,
      panoptoName: trimmed,
    });
  }

  const upsertHostEntry = (panoptoName: string, moodleName?: string) => {
    const trimmed = panoptoName.trim();
    if (!trimmed) return;
    const norm = normalizePersonName(trimmed);
    const moodleNorm = moodleName ? normalizePersonName(moodleName) : '';

    const existingIdx = entries.findIndex(
      (e) =>
        (norm && normalizePersonName(e.panoptoName) === norm) ||
        (moodleNorm && e.moodleName && normalizePersonName(e.moodleName) === moodleNorm)
    );

    const nextEntry: CoursePanoptoStaffEntry = {
      ...(moodleName ? { moodleName } : existingIdx >= 0 && entries[existingIdx].moodleName ? { moodleName: entries[existingIdx].moodleName } : {}),
      panoptoName: trimmed,
      role,
    };

    const next =
      existingIdx >= 0
        ? entries.map((item, idx) => (idx === existingIdx ? nextEntry : item))
        : [...entries, nextEntry];

    onSaveEntries(courseId, next);
  };

  const handleSelectChange = (selectedId: string) => {
    if (!selectedId) return;
    const moodleMatch = [...moodlePrimaryOptions, ...moodleOtherOptions].find((o) => o.id === selectedId);
    if (moodleMatch) {
      upsertHostEntry(moodleMatch.panoptoName, moodleMatch.moodleName);
      return;
    }
    const detectedMatch = detectedOptions.find((o) => o.id === selectedId);
    if (detectedMatch) {
      upsertHostEntry(detectedMatch.panoptoName);
    }
  };

  const handleAddManual = () => {
    const trimmed = manualHost.trim();
    if (!trimmed) return;
    upsertHostEntry(trimmed);
    setManualHost('');
  };

  const handleRemoveEntry = (originalIndex: number) => {
    const next = entries.filter((_, idx) => idx !== originalIndex);
    onSaveEntries(courseId, next);
  };

  const handleRefreshClick = async () => {
    if (!onRefreshFromMoodle || refreshing) return;
    setRefreshing(true);
    try {
      await onRefreshFromMoodle(courseId);
    } finally {
      setRefreshing(false);
    }
  };

  const selectId = `staff-select-${courseId}-${role.toLowerCase()}`;

  return (
    <div
      className={`staff-host-cell staff-host-cell-${role.toLowerCase()}`}
      dir={lang === 'he' ? 'rtl' : 'ltr'}
    >
      {roleEntries.length > 0 && (
        <div className="staff-cell-chips">
          {roleEntries.map(({ entry, originalIndex }) => {
            const display = entry.panoptoName || entry.moodleName || '';
            const tooltip =
              entry.moodleName && entry.moodleName !== entry.panoptoName
                ? `${entry.moodleName} -> ${entry.panoptoName}`
                : display;
            return (
              <span key={`${originalIndex}-${display}`} className={`staff-cell-chip ${role.toLowerCase()}`} title={tooltip}>
                <span className="staff-cell-chip-text" dir="ltr">{display}</span>
                <button
                  type="button"
                  className="staff-cell-chip-remove"
                  onClick={() => handleRemoveEntry(originalIndex)}
                  aria-label={t('panopto_staff_remove')}
                  title={t('panopto_staff_remove')}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div className="staff-cell-combo-row">
        <label className="staff-cell-label" htmlFor={selectId}>
          {role === 'Lecture' ? t('panopto_select_lecturer') : t('panopto_select_ta')}
        </label>
        <select
          id={selectId}
          className="nickname-input staff-cell-select"
          value=""
          onChange={(e) => handleSelectChange(e.target.value)}
        >
          <option value="">
            {isLoadingMoodle || refreshing ? t('panopto_loading_moodle_staff') : t('panopto_choose_from_moodle')}
          </option>
          {moodlePrimaryOptions.length > 0 && (
            <optgroup label={role === 'Lecture' ? t('panopto_staff_lecturer') : t('panopto_staff_ta')}>
              {moodlePrimaryOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </optgroup>
          )}
          {moodleOtherOptions.length > 0 && (
            <optgroup label={t('panopto_staff_moodle_label')}>
              {moodleOtherOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </optgroup>
          )}
          {detectedOptions.length > 0 && (
            <optgroup label={t('panopto_staff_detected_hosts')}>
              {detectedOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {onRefreshFromMoodle && (
          <button
            type="button"
            className="btn-ghost staff-cell-refresh-btn"
            onClick={handleRefreshClick}
            disabled={refreshing || isLoadingMoodle}
            title={t('panopto_refresh_moodle_staff')}
            aria-label={t('panopto_refresh_moodle_staff')}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={refreshing || isLoadingMoodle ? 'spinning-sync-icon' : ''}
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        )}
      </div>

      <div className="staff-cell-manual-row">
        <input
          type="text"
          className="nickname-input staff-cell-manual-input"
          dir="ltr"
          value={manualHost}
          placeholder={t('panopto_manual_host_add')}
          onChange={(e) => setManualHost(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAddManual();
            }
          }}
        />
        <button
          type="button"
          className="secondary-btn btn-xs staff-cell-add-btn"
          disabled={!manualHost.trim()}
          onClick={handleAddManual}
          title={t('panopto_staff_add_manual')}
        >
          +
        </button>
      </div>
    </div>
  );
}

