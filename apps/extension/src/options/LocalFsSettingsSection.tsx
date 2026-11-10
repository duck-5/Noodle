import { useEffect, useMemo, useState } from 'react';
import {
  type LocalFsConfig,
  type LocalFsStatus,
  setLocalFsConfig,
} from '../shared/storage.js';
import {
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
}

export function LocalFsSettingsSection({
  config,
  status,
  onConfigChanged,
  onShowToast,
  t,
  lang,
}: LocalFsSettingsSectionProps) {
  const provider = useMemo(() => createFileSystemProvider(), []);
  const isFsa = provider.backendType === 'fsa';

  const [permState, setPermState] = useState<FsaPermissionState>('unselected');
  const [subfolderDraft, setSubfolderDraft] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<'unix' | 'win' | null>(null);
  const [showLogs, setShowLogs] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);

  const subfolderInput = subfolderDraft ?? (config.rootLabel || (isFsa ? '' : 'Noodle'));

  useEffect(() => {
    if (provider instanceof ChromiumFsaProvider) {
      provider.getPermissionState().then(setPermState).catch(() => {});
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
    } else {
      const cleanSub = (subfolderInput || '').trim() || 'Noodle';
      await provider.selectRootDirectory(cleanSub);
    }

    await updatePatch({ enabled: true }, true);
  };

  const handleSaveFirefoxSubfolder = async () => {
    const cleanSub = (subfolderInput || '').trim() || 'Noodle';
    const prevSub = config.rootLabel || 'Noodle';
    const res = await provider.selectRootDirectory(cleanSub);
    if (res.success) {
      const normalized = res.displayPath.replace(/^Downloads\//, '');
      setSubfolderDraft(null);
      if (prevSub !== normalized) {
        await resetLocalFsFolderOnBackground();
      }
      const nextCfg = await setLocalFsConfig({ rootLabel: normalized });
      onConfigChanged(nextCfg);
      if (nextCfg.enabled) {
        await startLocalFsSyncOnBackground(false);
      }
      onShowToast?.(res.displayPath, 'success');
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

  return (
    <div className="settings-section local-fs-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h4 style={{ margin: 0 }}>{t('local_fs_title')}</h4>
        <span className={`local-fs-status-pill tone-${badge.tone}`}>
          {badge.text}
        </span>
      </div>

      <div className="toggle-row">
        <div>
          <span className="toggle-label">{t('local_fs_enable_label')}</span>
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
              <div className="local-fs-path-chip" dir="ltr">
                📁 {config.rootLabel || t('local_fs_no_folder_selected')}
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

      {config.enabled && (
        <div className="local-fs-subsettings" style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', marginTop: '1rem' }}>
          {/* Progress & Action Bar */}
          <div className="local-fs-status-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.82rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                <span>{t('local_fs_synced_total_label')} <strong>{status.syncedCountTotal}</strong></span>
                {status.failedCount > 0 && (
                  <span style={{ color: 'var(--accent-red, #ef4444)' }}>
                    {t('local_fs_failed_label')} <strong>{status.failedCount}</strong>
                  </span>
                )}
                {status.skippedTooLargeCount > 0 && (
                  <span>{t('local_fs_skipped_label')} <strong>{status.skippedTooLargeCount}</strong></span>
                )}
              </div>

              {status.state === 'syncing' && (
                <span className="local-fs-mode-tag">
                  {status.isInitialBulkMode ? t('local_fs_initial_bulk_badge') : t('local_fs_incremental_badge')}
                </span>
              )}
            </div>

            {status.state === 'syncing' && status.totalQueued > 0 && (
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
              <div style={{ fontSize: '0.78rem', color: '#fca5a5', marginBottom: '0.6rem' }}>
                ⚠️ {status.lastError}
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
                onChange={(e) => updatePatch({ autoResyncMissingFiles: e.target.checked }, e.target.checked)}
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
                onChange={(e) => updatePatch({ includeAssignments: e.target.checked }, e.target.checked)}
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
                  onChange={(e) => updatePatch({ includeSubmissions: e.target.checked }, e.target.checked)}
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
                onChange={(e) => updatePatch({ useCourseNicknames: e.target.checked })}
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
                onChange={(e) => updatePatch({ maxFileSizeMb: Number(e.target.value) })}
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
      )}
    </div>
  );
}
