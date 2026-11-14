import { useEffect, useMemo, useRef, useState } from 'react';
import { sanitizeRelativePath } from '@tautracker/moodle-client';
import {
  type LocalFsConfig,
  type LocalFsStatus,
  setLocalFsConfig,
} from '../shared/storage.js';
import {
  adoptScannedLocalFilesOnBackground,
  pauseLocalFsSyncOnBackground,
  resetLocalFsFolderOnBackground,
  resumeLocalFsSyncOnBackground,
  retryFailedLocalFsOnBackground,
  startLocalFsSyncOnBackground,
} from '../shared/messaging.js';
import { translations } from '../shared/i18n.js';
import { createFileSystemProvider } from '../services/fs/FileSystemProvider.js';
import { ChromiumFsaProvider, type FsaPermissionState } from '../services/fs/ChromiumFsaProvider.js';

interface LocalFsSettingsSectionProps {
  config: LocalFsConfig;
  status: LocalFsStatus;
  onConfigChanged: (cfg: LocalFsConfig) => void;
  onShowToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
  t: (key: keyof (typeof translations)['en']) => string;
  lang: 'he' | 'en';
  highlightForTour?: boolean;
}

const FolderIcon = ({ size = 14 }: { size?: number }) => (
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
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
  </svg>
);

const WarningTriangleIcon = ({ size = 14 }: { size?: number }) => (
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
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

export function LocalFsSettingsSection({
  config,
  status,
  onConfigChanged,
  onShowToast,
  t,
  lang,
  highlightForTour = false,
}: LocalFsSettingsSectionProps) {
  const provider = useMemo(() => createFileSystemProvider(), []);
  const isFsa = provider.backendType === 'fsa';

  const [permState, setPermState] = useState<FsaPermissionState>('unselected');
  const [subfolderDraft, setSubfolderDraft] = useState<string | null>(null);
  const [pendingSubfolderChange, setPendingSubfolderChange] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<'unix' | 'win' | null>(null);
  const [showLogs, setShowLogs] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const scanFolderInputRef = useRef<HTMLInputElement | null>(null);

  const subfolderInput = subfolderDraft ?? (config.rootLabel || (isFsa ? '' : 'Noodle'));

  useEffect(() => {
    if (!pendingSubfolderChange || busy) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && !busy) {
        setPendingSubfolderChange(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pendingSubfolderChange, busy]);

  useEffect(() => {
    if (provider instanceof ChromiumFsaProvider) {
      provider.getPermissionState().then(setPermState).catch(() => { });
    }
  }, [provider, config.enabled, config.rootLabel, status.state]);

  const updatePatch = async (patch: Partial<LocalFsConfig>, triggerSync = false) => {
    const updated = await setLocalFsConfig(patch);
    onConfigChanged(updated);
    if (triggerSync && updated.enabled) {
      await startLocalFsSyncOnBackground(false);
    }
  };

  const handleChooseFolder = async (): Promise<boolean> => {
    setBusy(true);
    try {
      const previousLabel = config.rootLabel;
      const res = await provider.selectRootDirectory(isFsa ? undefined : subfolderInput);
      if (!res.success) return false;

      if (previousLabel && previousLabel !== res.displayPath) {
        await resetLocalFsFolderOnBackground();
      }
      const nextCfg = await setLocalFsConfig({
        rootLabel: isFsa ? res.displayPath : subfolderInput.trim() || 'Noodle',
      });
      onConfigChanged(nextCfg);
      if (provider instanceof ChromiumFsaProvider) {
        setPermState(await provider.getPermissionState());
      }
      if (nextCfg.enabled) {
        await startLocalFsSyncOnBackground(false);
      }
      return true;
    } catch (err: unknown) {
      onShowToast?.(err instanceof Error ? err.message : String(err), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleReconnectFolder = async () => {
    if (!(provider instanceof ChromiumFsaProvider)) return;
    setBusy(true);
    try {
      const granted = await provider.requestStoredPermission();
      const nextPerm = await provider.getPermissionState();
      setPermState(nextPerm);
      if (granted) {
        await resumeLocalFsSyncOnBackground();
        onShowToast?.(t('local_fs_status_idle'), 'success');
      }
    } catch (err: unknown) {
      onShowToast?.(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleEnabled = async (nextEnabled: boolean) => {
    if (!nextEnabled) {
      await pauseLocalFsSyncOnBackground();
      await updatePatch({ enabled: false });
      await startLocalFsSyncOnBackground(false);
      return;
    }

    if (isFsa) {
      const ready = await provider.isReady();
      if (!ready) {
        if (permState === 'prompt') {
          const ok = await (provider as ChromiumFsaProvider).requestStoredPermission();
          if (!ok) {
            const picked = await handleChooseFolder();
            if (!picked) return;
          }
        } else {
          const picked = await handleChooseFolder();
          if (!picked) return;
        }
      }
      await updatePatch({ enabled: true }, true);
    } else {
      const cleanSub = sanitizeRelativePath((subfolderInput || '').trim() || 'Noodle', 80) || 'Noodle';
      await provider.selectRootDirectory(cleanSub);
      // Do not start downloading immediately on Firefox so user can scan an existing/rclone folder first.
      await updatePatch({ enabled: true }, false);
      onShowToast?.(t('local_fs_firefox_enable_hint'), 'info');
    }
  };

  const applyFirefoxSubfolderChange = async (cleanSub: string) => {
    setBusy(true);
    try {
      const prevSub = sanitizeRelativePath((config.rootLabel || 'Noodle').trim() || 'Noodle', 80) || 'Noodle';
      const res = await provider.selectRootDirectory(cleanSub);
      if (res.success) {
        const normalized = res.displayPath.replace(/^Downloads\//, '');
        setSubfolderDraft(null);
        if (prevSub !== normalized) {
          await resetLocalFsFolderOnBackground();
        }
        const nextCfg = await setLocalFsConfig({ rootLabel: normalized });
        onConfigChanged(nextCfg);
        onShowToast?.(res.displayPath, 'success');
      }
    } catch (err: unknown) {
      onShowToast?.(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setPendingSubfolderChange(null);
      setBusy(false);
    }
  };

  const handleSaveFirefoxSubfolder = async () => {
    const cleanSub = sanitizeRelativePath((subfolderInput || '').trim() || 'Noodle', 80) || 'Noodle';
    const prevSub = sanitizeRelativePath((config.rootLabel || 'Noodle').trim() || 'Noodle', 80) || 'Noodle';
    const pendingNow = status.pendingCount ?? Math.max(0, status.totalQueued - status.completedInCycle);
    const hasTrackedState =
      status.syncedCountTotal > 0 ||
      pendingNow > 0 ||
      status.state === 'syncing' ||
      status.state === 'paused' ||
      status.state === 'cooldown';

    if (prevSub !== cleanSub && hasTrackedState) {
      setPendingSubfolderChange(cleanSub);
      return;
    }

    await applyFirefoxSubfolderChange(cleanSub);
  };

  const handleScanExistingFolder = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setBusy(true);
    try {
      const entries = Array.from(fileList)
        .filter((f) => f.size > 0)
        .map((f) => {
          const rel =
            (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
          return {
            relativePath: rel,
            size: f.size,
            lastModified: f.lastModified,
          };
        });
      const res = await adoptScannedLocalFilesOnBackground(entries);
      if (res.success) {
        const msg = t('local_fs_firefox_scan_result').replace(
          '{count}',
          String(res.adoptedCount ?? 0)
        );
        onShowToast?.(msg, 'success');
      } else if (res.error) {
        onShowToast?.(res.error, 'error');
      }
    } catch (err: unknown) {
      onShowToast?.(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      if (scanFolderInputRef.current) {
        scanFolderInputRef.current.value = '';
      }
      setBusy(false);
    }
  };

  const getStatusBadge = () => {
    if (!config.enabled) {
      return { text: t('local_fs_status_disabled'), tone: 'muted' };
    }
    switch (status.state) {
      case 'syncing':
        return { text: t('local_fs_status_syncing'), tone: 'info' };
      case 'paused':
        return { text: t('local_fs_status_paused'), tone: 'warn' };
      case 'cooldown':
        return { text: t('local_fs_status_cooldown'), tone: 'warn' };
      case 'needs_permission':
        return { text: t('local_fs_status_needs_perm'), tone: 'danger' };
      case 'needs_auth':
        return { text: t('local_fs_status_needs_auth'), tone: 'danger' };
      case 'error':
        return { text: t('local_fs_status_error'), tone: 'danger' };
      default:
        return { text: t('local_fs_status_idle'), tone: 'ok' };
    }
  };

  const badge = getStatusBadge();
  const activeFirefoxSub = (config.rootLabel || subfolderInput || 'Noodle').trim() || 'Noodle';
  const unixSymlinkCmd = `ln -s "/path/to/your/target/folder" ~/Downloads/${activeFirefoxSub}`;
  const winSymlinkCmd = `mklink /J "%USERPROFILE%\\Downloads\\${activeFirefoxSub}" "C:\\path\\to\\your\\target\\folder"`;

  const copyCommand = (kind: 'unix' | 'win', cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(kind);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  const progressPct =
    status.totalQueued > 0
      ? Math.min(100, Math.round((status.completedInCycle / status.totalQueued) * 100))
      : 0;
  const plannedTotal = status.plannedTotal ?? 0;
  const pendingCount = status.pendingCount ?? Math.max(0, status.totalQueued - status.completedInCycle);
  const showProgressStates =
    status.state === 'syncing' ||
    status.state === 'paused' ||
    status.state === 'cooldown' ||
    status.state === 'needs_permission' ||
    status.state === 'needs_auth';
  const lastSyncLabel = status.lastSyncAt
    ? new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-US', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(status.lastSyncAt))
    : t('local_fs_never_synced');
  const shouldReplanOnOptionChange =
    isFsa || status.syncedCountTotal > 0 || pendingCount > 0 || status.totalQueued > 0;

  return (
    <div className={`settings-section local-fs-section ${highlightForTour ? 'tour-highlight' : ''}`}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h4 style={{ margin: 0 }}>{t('local_fs_title')}</h4>
        <span className={`local-fs-status-pill tone-${badge.tone}`}>
          {badge.text}
        </span>
      </div>

      <div className="toggle-row">
        <div>
          <div style={{ display: 'flex-row' }}>
            <span className="toggle-label">{t('local_fs_enable_label')}</span>
            <span className="badge-beta" style={{ marginInlineStart: '0.5rem' }}>
              {lang === 'he' ? 'נסיוני' : 'EXPERIMENTAL'}
            </span>
          </div>
          <p className="subtitle">{t('local_fs_desc')}</p>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            id="local-fs-enabled-toggle"
            checked={config.enabled}
            disabled={busy}
            onChange={(e) => handleToggleEnabled(e.target.checked)}
          />
          <span className="slider round"></span>
        </label>
      </div>

      {/* Root Folder / Subfolder Selection */}
      <div className="local-fs-root-box">
        {isFsa ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '0.84rem', fontWeight: 600 }}>{t('local_fs_root_folder_label')}</div>
              <div className="local-fs-path-chip" dir="ltr" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                <FolderIcon size={13} />
                <span>{config.rootLabel || t('local_fs_no_folder_selected')}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {permState === 'prompt' && config.rootLabel && (
                <button
                  type="button"
                  id="local-fs-reconnect-btn"
                  className="primary-btn btn-sm"
                  disabled={busy}
                  onClick={handleReconnectFolder}
                >
                  {t('local_fs_reconnect_btn')}
                </button>
              )}
              <button
                type="button"
                id="local-fs-choose-folder-btn"
                className="secondary-btn btn-sm"
                disabled={busy}
                onClick={handleChooseFolder}
              >
                {config.rootLabel ? t('local_fs_change_folder_btn') : t('local_fs_choose_folder_btn')}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div>
              <label htmlFor="local-fs-firefox-subfolder-input" style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                {t('local_fs_firefox_subfolder_label')}
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  id="local-fs-firefox-subfolder-input"
                  className="settings-text-input"
                  value={subfolderInput}
                  dir="ltr"
                  placeholder="Noodle"
                  onChange={(e) => setSubfolderDraft(e.target.value)}
                  style={{ flex: 1, minWidth: '180px' }}
                />
                <button
                  type="button"
                  id="local-fs-firefox-save-btn"
                  className="secondary-btn btn-sm"
                  disabled={busy}
                  onClick={handleSaveFirefoxSubfolder}
                >
                  {t('local_fs_firefox_save_subfolder')}
                </button>
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                {t('local_fs_firefox_target_preview')}{' '}
                <code dir="ltr">Downloads/{activeFirefoxSub}/</code>
              </div>

              <div style={{ marginTop: '0.65rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    ref={(el) => {
                      scanFolderInputRef.current = el;
                      if (el) {
                        el.setAttribute('webkitdirectory', '');
                        el.setAttribute('directory', '');
                      }
                    }}
                    type="file"
                    multiple
                    id="local-fs-firefox-scan-input"
                    style={{ display: 'none' }}
                    onChange={(e) => handleScanExistingFolder(e.target.files)}
                  />
                  <button
                    type="button"
                    id="local-fs-firefox-scan-btn"
                    className="secondary-btn btn-sm"
                    disabled={busy}
                    onClick={() => scanFolderInputRef.current?.click()}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                  >
                    <FolderIcon size={13} />
                    <span>{t('local_fs_firefox_scan_btn')}</span>
                  </button>
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                  {t('local_fs_firefox_scan_hint')}
                </div>
              </div>
            </div>

            <details className="local-fs-symlink-details">
              <summary>{t('local_fs_firefox_symlink_title')}</summary>
              <div className="local-fs-symlink-body">
                <p style={{ margin: '0 0 0.65rem 0', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                  {t('local_fs_firefox_symlink_desc')}
                </p>

                <div className="local-fs-cmd-row">
                  <span className="local-fs-cmd-label">{t('local_fs_firefox_symlink_unix')}</span>
                  <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
                    <code dir="ltr" className="local-fs-cmd-code">{unixSymlinkCmd}</code>
                    <button
                      type="button"
                      className="secondary-btn btn-xs"
                      onClick={() => copyCommand('unix', unixSymlinkCmd)}
                    >
                      {copiedCmd === 'unix' ? `✓ ${t('copied_btn')}` : t('copy_btn')}
                    </button>
                  </div>
                </div>

                <div className="local-fs-cmd-row">
                  <span className="local-fs-cmd-label">{t('local_fs_firefox_symlink_win')}</span>
                  <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
                    <code dir="ltr" className="local-fs-cmd-code">{winSymlinkCmd}</code>
                    <button
                      type="button"
                      className="secondary-btn btn-xs"
                      onClick={() => copyCommand('win', winSymlinkCmd)}
                    >
                      {copiedCmd === 'win' ? `✓ ${t('copied_btn')}` : t('copy_btn')}
                    </button>
                  </div>
                </div>
              </div>
            </details>
          </div>
        )}
      </div>

      {
        config.enabled && (
          <div className="local-fs-subsettings" style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', marginTop: '1rem' }}>
            {/* Progress & Action Bar */}
            <div className="local-fs-status-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.82rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                  <span>
                    {t('local_fs_synced_total_label')}{' '}
                    <strong>
                      {plannedTotal > 0 ? `${status.syncedCountTotal} / ${plannedTotal}` : status.syncedCountTotal}
                    </strong>
                  </span>
                  {pendingCount > 0 && status.state !== 'syncing' && (
                    <span>
                      {t('local_fs_pending_label')} <strong>{pendingCount}</strong>
                    </span>
                  )}
                  {status.failedCount > 0 && (
                    <span style={{ color: 'var(--accent-red, #ef4444)' }}>
                      {t('local_fs_failed_label')} <strong>{status.failedCount}</strong>
                    </span>
                  )}
                  {status.skippedTooLargeCount > 0 && (
                    <span>{t('local_fs_skipped_label')} <strong>{status.skippedTooLargeCount}</strong></span>
                  )}
                  <span>
                    {t('local_fs_last_sync_label')} <strong dir="ltr">{lastSyncLabel}</strong>
                  </span>
                </div>

                {status.state === 'syncing' && (
                  <span className="local-fs-mode-tag">
                    {status.isInitialBulkMode ? t('local_fs_initial_bulk_badge') : t('local_fs_incremental_badge')}
                  </span>
                )}
              </div>

              {showProgressStates && status.totalQueued > 0 && (
                <div style={{ marginBottom: '0.65rem' }}>
                  <div className="local-fs-progress-track">
                    <div className="local-fs-progress-fill" style={{ width: `${progressPct}%` }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '0.25rem', gap: '0.5rem' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="ltr">
                      {status.currentFilePath || ''}
                    </span>
                    <span style={{ flexShrink: 0 }}>
                      {status.completedInCycle} / {status.totalQueued} ({progressPct}%)
                    </span>
                  </div>
                </div>
              )}

              {status.lastError && (
                <div style={{ fontSize: '0.78rem', color: '#fca5a5', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <WarningTriangleIcon size={13} />
                  <span>{status.lastError}</span>
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  id="local-fs-sync-now-btn"
                  className="primary-btn btn-sm"
                  disabled={busy || status.state === 'syncing'}
                  onClick={() => startLocalFsSyncOnBackground(false)}
                >
                  {status.state === 'syncing' ? t('syncing') : t('local_fs_sync_now_btn')}
                </button>

                {status.state === 'syncing' ? (
                  <button
                    type="button"
                    id="local-fs-pause-btn"
                    className="secondary-btn btn-sm"
                    onClick={() => pauseLocalFsSyncOnBackground()}
                  >
                    {t('local_fs_pause_btn')}
                  </button>
                ) : (status.state === 'paused' || status.state === 'cooldown') ? (
                  <button
                    type="button"
                    id="local-fs-resume-btn"
                    className="secondary-btn btn-sm"
                    onClick={() => resumeLocalFsSyncOnBackground()}
                  >
                    {t('local_fs_resume_btn')}
                  </button>
                ) : null}

                {status.failedCount > 0 && (
                  <button
                    type="button"
                    id="local-fs-retry-btn"
                    className="secondary-btn btn-sm"
                    onClick={() => retryFailedLocalFsOnBackground()}
                  >
                    {t('local_fs_retry_failed_btn')} ({status.failedCount})
                  </button>
                )}
              </div>

              {status.logs.length > 0 && (
                <div style={{ marginTop: '0.65rem' }}>
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ fontSize: '0.78rem', padding: 0, cursor: 'pointer', color: 'var(--text-muted)', background: 'none', border: 'none' }}
                    onClick={() => setShowLogs((p) => !p)}
                  >
                    {showLogs ? '▼' : (lang === 'he' ? '◀' : '▶')} {t('local_fs_logs_toggle')} ({status.logs.length})
                  </button>
                  {showLogs && (
                    <div className="local-fs-logs-list">
                      {status.logs.map((log, idx) => (
                        <div key={`${log.moodleFileId}_${idx}`} className="local-fs-log-item">
                          <span style={{ fontWeight: 600 }} dir="ltr">{log.relativePath}</span>
                          <span style={{ fontSize: '0.74rem', color: log.status === 'failed' ? '#fca5a5' : 'var(--text-muted)' }}>
                            {log.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Sub-Toggles */}
            <div className="toggle-row" style={{ padding: '0.15rem 0' }}>
              <div>
                <span className="toggle-label" style={{ fontSize: '0.9rem' }}>{t('local_fs_auto_resync_missing_title')}</span>
                <p className="subtitle" style={{ fontSize: '0.8rem', marginTop: '0.15rem' }}>{t('local_fs_auto_resync_missing_desc')}</p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  id="local-fs-auto-resync-toggle"
                  checked={config.autoResyncMissingFiles}
                  onChange={(e) => updatePatch({ autoResyncMissingFiles: e.target.checked }, shouldReplanOnOptionChange)}
                />
                <span className="slider round"></span>
              </label>
            </div>

            <div className="toggle-row" style={{ padding: '0.15rem 0' }}>
              <span className="toggle-label" style={{ fontSize: '0.9rem' }}>{t('local_fs_include_assignments_title')}</span>
              <label className="switch">
                <input
                  type="checkbox"
                  id="local-fs-include-assignments-toggle"
                  checked={config.includeAssignments}
                  onChange={(e) => updatePatch({ includeAssignments: e.target.checked }, shouldReplanOnOptionChange)}
                />
                <span className="slider round"></span>
              </label>
            </div>

            {config.includeAssignments && (
              <div className="toggle-row" style={{ padding: '0.15rem 0', paddingInlineStart: '1rem' }}>
                <span className="toggle-label" style={{ fontSize: '0.88rem' }}>{t('local_fs_include_submissions_title')}</span>
                <label className="switch">
                  <input
                    type="checkbox"
                    id="local-fs-include-submissions-toggle"
                    checked={config.includeSubmissions}
                    onChange={(e) => updatePatch({ includeSubmissions: e.target.checked }, shouldReplanOnOptionChange)}
                  />
                  <span className="slider round"></span>
                </label>
              </div>
            )}

            <div className="toggle-row" style={{ padding: '0.15rem 0' }}>
              <span className="toggle-label" style={{ fontSize: '0.9rem' }}>{t('local_fs_use_nicknames_title')}</span>
              <label className="switch">
                <input
                  type="checkbox"
                  id="local-fs-use-nicknames-toggle"
                  checked={config.useCourseNicknames}
                  onChange={(e) => updatePatch({ useCourseNicknames: e.target.checked }, shouldReplanOnOptionChange)}
                />
                <span className="slider round"></span>
              </label>
            </div>

            <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
              <div>
                <label htmlFor="local-fs-max-size-select" style={{ display: 'block', fontSize: '0.82rem', marginBottom: '0.25rem' }}>
                  {t('local_fs_max_size_label')}
                </label>
                <select
                  id="local-fs-max-size-select"
                  className="settings-text-input"
                  value={config.maxFileSizeMb}
                  onChange={(e) => updatePatch({ maxFileSizeMb: Number(e.target.value) }, shouldReplanOnOptionChange)}
                  style={{ maxWidth: '180px', cursor: 'pointer' }}
                >
                  <option value={50}>50 MB</option>
                  <option value={100}>100 MB</option>
                  <option value={250}>250 MB</option>
                  <option value={500}>500 MB</option>
                  <option value={0}>{t('local_fs_max_size_unlimited')}</option>
                </select>
              </div>

              <div>
                <label htmlFor="local-fs-speed-profile-select" style={{ display: 'block', fontSize: '0.82rem', marginBottom: '0.25rem' }}>
                  {t('local_fs_speed_profile_label')}
                </label>
                <select
                  id="local-fs-speed-profile-select"
                  className="settings-text-input"
                  value={config.speedProfile}
                  onChange={(e) => updatePatch({ speedProfile: e.target.value as 'safe' | 'moderate' })}
                  style={{ maxWidth: '280px', cursor: 'pointer' }}
                >
                  <option value="safe">{t('local_fs_speed_safe')}</option>
                  <option value="moderate">{t('local_fs_speed_moderate')}</option>
                </select>
              </div>
            </div>
          </div>
        )
      }

      {
        pendingSubfolderChange && (
          <div
            className="modal-overlay"
            onClick={() => !busy && setPendingSubfolderChange(null)}
          >
            <div
              className="modal-content glass-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="local-fs-subfolder-modal-title"
              style={{ maxWidth: '460px', padding: '1.75rem' }}
              onClick={(ev) => ev.stopPropagation()}
            >
              <h3 id="local-fs-subfolder-modal-title" style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <WarningTriangleIcon size={18} />
                <span>{t('local_fs_change_subfolder_modal_title')}</span>
              </h3>
              <p style={{ margin: '0.9rem 0 1.4rem 0', color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: 1.5 }}>
                {t('local_fs_change_subfolder_modal_desc')
                  .replace('{path}', `Downloads/${pendingSubfolderChange}/`)
                  .replace('{count}', String(status.syncedCountTotal))}
              </p>
              <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  id="local-fs-subfolder-cancel-btn"
                  className="secondary-btn btn-sm"
                  disabled={busy}
                  onClick={() => setPendingSubfolderChange(null)}
                >
                  {t('cancel_btn')}
                </button>
                <button
                  type="button"
                  id="local-fs-subfolder-confirm-btn"
                  className="primary-btn btn-sm"
                  disabled={busy}
                  onClick={() => applyFirefoxSubfolderChange(pendingSubfolderChange)}
                >
                  {t('local_fs_change_subfolder_confirm_btn')}
                </button>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );
}
