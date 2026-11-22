import { Platform } from 'react-native';
import type * as SQLiteTypes from 'expo-sqlite';
import type {
  Assignment,
  CourseAnnouncement,
  CourseFile,
  CourseFolder,
  CourseGradeSummary,
  CourseLink,
  CourseSection,
  CourseStaffMember,
  MoodleCourse,
  PanoptoRecording,
  SyncError,
  SyncResult,
  ZoomMeeting,
} from '@tautracker/moodle-client';

export interface TrackedCourseRow {
  id?: number;
  moodle_id: number;
  course_id?: string | null;
  name: string;
  semester?: string | null;
  year?: string | null;
  color?: string | null;
  is_active: number;
}

export type TrackedCourseInput = Omit<Partial<TrackedCourseRow>, 'is_active'> & {
  id?: number;
  moodle_id?: number;
  courseId?: string;
  idnumber?: string;
  fullname?: string;
  shortname?: string;
  is_active?: number | boolean;
};

const PRESERVED_UI_PREFS = new Set([
  'theme',
  'language',
  'theme_time_day_start',
  'theme_time_day_end',
]);

const WEB_PREF_PREFIX = 'noodle_pref_';

// ── In-memory fallback store (Expo Web & Jest without native SQLite) ───────

const memPrefs: Record<string, string> = {};

interface MemTables {
  tracked_courses: any[];
  courses: any[];
  assignments: any[];
  files: any[];
  meetings: any[];
  course_sections: any[];
  course_folders: any[];
  course_links: any[];
  course_announcements: any[];
  recordings: any[];
  course_staff: any[];
  grade_summaries: any[];
}

const memTables: MemTables = {
  tracked_courses: [],
  courses: [],
  assignments: [],
  files: [],
  meetings: [],
  course_sections: [],
  course_folders: [],
  course_links: [],
  course_announcements: [],
  recordings: [],
  course_staff: [],
  grade_summaries: [],
};

let autoIdCounter = 1;
function nextMemId(): number {
  return autoIdCounter++;
}

function getWebLocalStorage(): Storage | null {
  try {
    if (
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      typeof window.localStorage !== 'undefined'
    ) {
      return window.localStorage;
    }
  } catch {
    // Ignore restricted storage access
  }
  return null;
}

function readMemPref(key: string): string | null {
  if (Object.prototype.hasOwnProperty.call(memPrefs, key)) {
    return memPrefs[key];
  }
  const ls = getWebLocalStorage();
  if (ls) {
    try {
      const val = ls.getItem(`${WEB_PREF_PREFIX}${key}`);
      if (val !== null) {
        memPrefs[key] = val;
        return val;
      }
    } catch {
      // Ignore
    }
  }
  return null;
}

function writeMemPref(key: string, value: string): void {
  const strVal = String(value);
  memPrefs[key] = strVal;
  const ls = getWebLocalStorage();
  if (ls) {
    try {
      ls.setItem(`${WEB_PREF_PREFIX}${key}`, strVal);
    } catch {
      // Ignore quota errors
    }
  }
}

function deleteMemPref(key: string): void {
  delete memPrefs[key];
  const ls = getWebLocalStorage();
  if (ls) {
    try {
      ls.removeItem(`${WEB_PREF_PREFIX}${key}`);
    } catch {
      // Ignore
    }
  }
}

function createMemorySqliteAdapter(): SQLiteTypes.SQLiteDatabase {
  const clearTable = (table: keyof MemTables, whereCol?: string, whereVal?: any) => {
    if (!whereCol) {
      memTables[table] = [];
      return;
    }
    memTables[table] = memTables[table].filter((row) => row[whereCol] !== whereVal);
  };

  const adapter = {
    withTransactionSync(fn: () => void) {
      fn();
    },
    execSync(sql: string) {
      const statements = sql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stmt of statements) {
        const delMatch = stmt.match(/^DELETE\s+FROM\s+([a-z_]+)$/i);
        if (delMatch) {
          const tbl = delMatch[1] as keyof MemTables;
          if (tbl === ('preferences' as any)) {
            for (const k of Object.keys(memPrefs)) {
              deleteMemPref(k);
            }
          } else if (memTables[tbl]) {
            memTables[tbl] = [];
          }
        }
      }
    },
    runSync(sql: string, params: any[] = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();

      if (/^INSERT\s+OR\s+REPLACE\s+INTO\s+preferences/i.test(normalized)) {
        writeMemPref(String(params[0]), String(params[1]));
        return { changes: 1, lastInsertRowId: 0 };
      }

      if (/^DELETE\s+FROM\s+preferences\s+WHERE\s+key\s*=\s*\?/i.test(normalized)) {
        deleteMemPref(String(params[0]));
        return { changes: 1, lastInsertRowId: 0 };
      }

      if (/^DELETE\s+FROM\s+preferences\s+WHERE\s+key\s+NOT\s+IN/i.test(normalized)) {
        for (const k of Object.keys(memPrefs)) {
          if (!PRESERVED_UI_PREFS.has(k)) {
            deleteMemPref(k);
          }
        }
        return { changes: 1, lastInsertRowId: 0 };
      }

      const delWhereMatch = normalized.match(/^DELETE\s+FROM\s+([a-z_]+)\s+WHERE\s+([a-z_]+)\s*=\s*\?/i);
      if (delWhereMatch) {
        const tbl = delWhereMatch[1] as keyof MemTables;
        const col = delWhereMatch[2];
        if (memTables[tbl]) {
          clearTable(tbl, col, params[0]);
        }
        return { changes: 1, lastInsertRowId: 0 };
      }

      const delAllMatch = normalized.match(/^DELETE\s+FROM\s+([a-z_]+)$/i);
      if (delAllMatch) {
        const tbl = delAllMatch[1] as keyof MemTables;
        if (tbl === ('preferences' as any)) {
          for (const k of Object.keys(memPrefs)) {
            deleteMemPref(k);
          }
        } else if (memTables[tbl]) {
          memTables[tbl] = [];
        }
        return { changes: 1, lastInsertRowId: 0 };
      }

      if (/^UPDATE\s+tracked_courses\s+SET\s+is_active\s*=\s*0$/i.test(normalized)) {
        memTables.tracked_courses.forEach((r) => {
          r.is_active = 0;
        });
        return { changes: memTables.tracked_courses.length, lastInsertRowId: 0 };
      }

      if (/^UPDATE\s+tracked_courses\s+SET\s+is_active\s*=\s*1,\s*color\s*=\s*\?,\s*name\s*=\s*\?\s+WHERE\s+moodle_id\s*=\s*\?/i.test(normalized)) {
        const [color, name, moodleId] = params;
        const row = memTables.tracked_courses.find((r) => r.moodle_id === Number(moodleId));
        if (row) {
          row.is_active = 1;
          row.color = color;
          row.name = name;
        }
        return { changes: row ? 1 : 0, lastInsertRowId: 0 };
      }

      if (/^INSERT\s+(?:OR\s+REPLACE\s+)?INTO\s+tracked_courses/i.test(normalized)) {
        const colMatch = normalized.match(/\(([^)]+)\)\s+VALUES\s+\(([^)]+)\)/i);
        if (colMatch) {
          const cols = colMatch[1].split(',').map((c) => c.trim());
          const vals = colMatch[2].split(',').map((v) => v.trim());
          const record: any = { id: nextMemId(), is_active: 1 };
          let pIdx = 0;
          cols.forEach((c, idx) => {
            const vToken = vals[idx];
            if (vToken === '?') {
              record[c] = params[pIdx++];
            } else if (/^\d+$/.test(vToken)) {
              record[c] = Number(vToken);
            } else {
              record[c] = vToken.replace(/^['"]|['"]$/g, '');
            }
          });
          const existingIdx = memTables.tracked_courses.findIndex((r) => r.moodle_id === Number(record.moodle_id));
          if (existingIdx >= 0) {
            memTables.tracked_courses[existingIdx] = { ...memTables.tracked_courses[existingIdx], ...record };
          } else {
            memTables.tracked_courses.push(record);
          }
          return { changes: 1, lastInsertRowId: record.id };
        }
      }

      return { changes: 0, lastInsertRowId: 0 };
    },
    getAllSync<T = any>(sql: string, params: any[] = []): T[] {
      const normalized = sql.replace(/\s+/g, ' ').trim();

      if (/FROM\s+preferences\s+WHERE\s+key\s*=\s*\?/i.test(normalized)) {
        const val = readMemPref(String(params[0]));
        return (val !== null ? [{ value: val }] : []) as T[];
      }

      if (/FROM\s+preferences\b/i.test(normalized)) {
        const ls = getWebLocalStorage();
        if (ls) {
          try {
            for (let i = 0; i < ls.length; i++) {
              const k = ls.key(i);
              if (k && k.startsWith(WEB_PREF_PREFIX)) {
                const prefKey = k.slice(WEB_PREF_PREFIX.length);
                if (!Object.prototype.hasOwnProperty.call(memPrefs, prefKey)) {
                  const v = ls.getItem(k);
                  if (v !== null) memPrefs[prefKey] = v;
                }
              }
            }
          } catch {}
        }
        return Object.entries(memPrefs).map(([key, value]) => ({ key, value })) as T[];
      }

      if (/FROM\s+tracked_courses/i.test(normalized)) {
        let rows = [...memTables.tracked_courses];
        if (/WHERE\s+is_active\s*=\s*1/i.test(normalized)) {
          rows = rows.filter((r) => Number(r.is_active) === 1);
        } else if (/WHERE\s+moodle_id\s*=\s*\?/i.test(normalized)) {
          rows = rows.filter((r) => r.moodle_id === Number(params[0]));
        }
        return rows.map((r) => ({ ...r })) as T[];
      }

      if (/FROM\s+assignments/i.test(normalized)) {
        let rows = [...memTables.assignments];
        if (/JOIN\s+tracked_courses/i.test(normalized)) {
          const activeCourseMap = new Map(
            memTables.tracked_courses
              .filter((c) => Number(c.is_active) === 1)
              .map((c) => [c.moodle_id, c])
          );
          rows = rows
            .filter((a) => activeCourseMap.has(a.course_moodle_id))
            .map((a) => {
              const c = activeCourseMap.get(a.course_moodle_id);
              return {
                ...a,
                custom_course_name: c?.name,
                course_color: c?.color,
              };
            });
        } else if (/WHERE\s+(?:a\.)?course_moodle_id\s*=\s*\?/i.test(normalized)) {
          rows = rows.filter((a) => a.course_moodle_id === Number(params[0]));
        }
        return rows.map((r) => ({ ...r })) as T[];
      }

      if (/FROM\s+files/i.test(normalized)) {
        let rows = [...memTables.files];
        if (/JOIN\s+tracked_courses/i.test(normalized)) {
          const activeCourseMap = new Map(
            memTables.tracked_courses
              .filter((c) => Number(c.is_active) === 1)
              .map((c) => [c.moodle_id, c])
          );
          rows = rows
            .filter((f) => activeCourseMap.has(f.course_moodle_id))
            .map((f) => {
              const c = activeCourseMap.get(f.course_moodle_id);
              return {
                ...f,
                custom_course_name: c?.name,
                course_color: c?.color,
              };
            });
        } else if (/WHERE\s+(?:f\.)?course_moodle_id\s*=\s*\?/i.test(normalized)) {
          rows = rows.filter((f) => f.course_moodle_id === Number(params[0]));
        }
        return rows.map((r) => ({ ...r })) as T[];
      }

      if (/FROM\s+meetings/i.test(normalized)) {
        let rows = [...memTables.meetings];
        if (/JOIN\s+tracked_courses/i.test(normalized)) {
          const activeCourseMap = new Map(
            memTables.tracked_courses
              .filter((c) => Number(c.is_active) === 1)
              .map((c) => [c.moodle_id, c])
          );
          rows = rows
            .filter((m) => activeCourseMap.has(m.course_moodle_id))
            .map((m) => {
              const c = activeCourseMap.get(m.course_moodle_id);
              return {
                ...m,
                custom_course_name: c?.name,
                course_color: c?.color,
              };
            });
        } else if (/WHERE\s+(?:m\.)?course_moodle_id\s*=\s*\?/i.test(normalized)) {
          rows = rows.filter((m) => m.course_moodle_id === Number(params[0]));
        }
        return rows.map((r) => ({ ...r })) as T[];
      }

      if (/FROM\s+course_sections/i.test(normalized)) {
        let rows = [...memTables.course_sections];
        if (/WHERE\s+course_moodle_id\s*=\s*\?/i.test(normalized)) {
          rows = rows.filter((r) => r.course_moodle_id === Number(params[0]));
        }
        rows.sort((a, b) => (a.section_number ?? 0) - (b.section_number ?? 0));
        return rows.map((r) => ({ ...r })) as T[];
      }

      if (/FROM\s+course_folders/i.test(normalized)) {
        let rows = [...memTables.course_folders];
        if (/WHERE\s+course_moodle_id\s*=\s*\?/i.test(normalized)) {
          rows = rows.filter((r) => r.course_moodle_id === Number(params[0]));
        }
        return rows.map((r) => ({ ...r })) as T[];
      }

      if (/FROM\s+course_links/i.test(normalized)) {
        let rows = [...memTables.course_links];
        if (/WHERE\s+course_moodle_id\s*=\s*\?/i.test(normalized)) {
          rows = rows.filter((r) => r.course_moodle_id === Number(params[0]));
        }
        return rows.map((r) => ({ ...r })) as T[];
      }

      if (/FROM\s+course_announcements/i.test(normalized)) {
        let rows = [...memTables.course_announcements];
        if (/WHERE\s+course_id\s*=\s*\?/i.test(normalized)) {
          rows = rows.filter((r) => r.course_id === Number(params[0]));
        }
        return rows.map((r) => ({ ...r })) as T[];
      }

      if (/FROM\s+recordings/i.test(normalized)) {
        let rows = [...memTables.recordings];
        if (/WHERE\s+course_id\s*=\s*\?/i.test(normalized)) {
          rows = rows.filter((r) => r.course_id === Number(params[0]));
        }
        return rows.map((r) => ({ ...r })) as T[];
      }

      if (/FROM\s+course_staff/i.test(normalized)) {
        return memTables.course_staff.map((r) => ({ ...r })) as T[];
      }

      if (/FROM\s+grade_summaries/i.test(normalized)) {
        return memTables.grade_summaries.map((r) => ({ ...r })) as T[];
      }

      if (/FROM\s+courses/i.test(normalized)) {
        return memTables.courses.map((r) => ({ ...r })) as T[];
      }

      return [];
    },
    getFirstSync<T = any>(sql: string, params: any[] = []): T | null {
      const all = adapter.getAllSync<T>(sql, params);
      return all.length > 0 ? all[0] : null;
    },
  };

  return adapter as unknown as SQLiteTypes.SQLiteDatabase;
}

// ── SQLite / Fallback lifecycle ────────────────────────────────────────────

let dbInstance: SQLiteTypes.SQLiteDatabase | null = null;
let usingMemoryStore = false;

function loadNativeSqlite(): typeof SQLiteTypes | null {
  if (Platform.OS === 'web') {
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-sqlite') as typeof SQLiteTypes;
  } catch {
    return null;
  }
}

let txDepth = 0;

/**
 * Executes a synchronous database block inside a transaction if not already
 * inside an active transaction, preventing SQLite `cannot start a transaction within a transaction`.
 */
export function runInTransaction<T>(fn: () => T): T {
  if (txDepth > 0 || isMemoryFallbackActive()) {
    return fn();
  }
  const db = getDb();
  if (typeof db.withTransactionSync !== 'function') {
    return fn();
  }
  let result!: T;
  txDepth += 1;
  try {
    db.withTransactionSync(() => {
      result = fn();
    });
  } finally {
    txDepth -= 1;
  }
  return result;
}

export function getDb(): SQLiteTypes.SQLiteDatabase {
  if (dbInstance) {
    return dbInstance;
  }

  const SQLite = loadNativeSqlite();
  if (SQLite && typeof SQLite.openDatabaseSync === 'function') {
    try {
      const nativeDb = SQLite.openDatabaseSync('noodle.db');
      initDb(nativeDb);
      const sanity = nativeDb.getAllSync<{ name: string }>('PRAGMA table_info(preferences);');
      if (!Array.isArray(sanity)) {
        throw new Error('SQLite sanity check failed (non-array pragma output)');
      }
      usingMemoryStore = false;
      dbInstance = nativeDb;
      return dbInstance;
    } catch (e) {
      if (typeof jest === 'undefined') {
        console.warn('[database] Native SQLite unavailable, falling back to in-memory store:', e);
      }
    }
  }

  usingMemoryStore = true;
  dbInstance = createMemorySqliteAdapter();
  return dbInstance;
}

function isMemoryFallbackActive(): boolean {
  getDb();
  return usingMemoryStore;
}

function initDb(db: SQLiteTypes.SQLiteDatabase) {
  db.execSync(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS tracked_courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      moodle_id INTEGER UNIQUE NOT NULL,
      course_id TEXT,
      name TEXT NOT NULL,
      semester TEXT,
      year TEXT,
      color TEXT,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY,
      course_id TEXT,
      shortname TEXT,
      fullname TEXT NOT NULL,
      idnumber TEXT,
      semester TEXT,
      year TEXT,
      visible INTEGER,
      startdate INTEGER,
      enddate INTEGER,
      summary TEXT,
      courseimage TEXT,
      base_url TEXT,
      format TEXT,
      coursecategory TEXT
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT UNIQUE NOT NULL,
      moodle_assign_id INTEGER NOT NULL,
      activity_type TEXT DEFAULT 'assign',
      cmid INTEGER,
      course_moodle_id INTEGER NOT NULL,
      source_course_id INTEGER,
      course_name TEXT,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'Assigned',
      deadline TEXT,
      cutoff_date TEXT,
      opened TEXT,
      link TEXT,
      grade REAL,
      grade_max REAL,
      last_synced TEXT,
      attachments TEXT,
      submitted_files TEXT,
      time_limit_seconds INTEGER,
      attempts_allowed INTEGER,
      has_finished_attempt INTEGER DEFAULT 0,
      requires_manual_completion INTEGER DEFAULT 0,
      is_manual_completion_done INTEGER DEFAULT 0,
      completion_tracking INTEGER,
      is_completed INTEGER DEFAULT 0,
      section_id INTEGER,
      section_name TEXT,
      feedback TEXT,
      is_bonus INTEGER DEFAULT 0,
      is_late_submission_box INTEGER DEFAULT 0,
      is_hidden INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module_id INTEGER,
      course_moodle_id INTEGER NOT NULL,
      source_course_id INTEGER,
      course_name TEXT,
      section_id INTEGER,
      section_number INTEGER,
      section_name TEXT,
      folder_id INTEGER,
      folder_name TEXT,
      relative_path TEXT,
      module_name TEXT,
      file_name TEXT NOT NULL,
      file_url TEXT UNIQUE NOT NULL,
      download_url TEXT,
      file_size INTEGER,
      mime_type TEXT,
      time_modified INTEGER,
      is_new INTEGER DEFAULT 0,
      last_synced TEXT
    );

    CREATE TABLE IF NOT EXISTS meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_moodle_id INTEGER NOT NULL,
      course_name TEXT,
      title TEXT,
      meeting_url TEXT NOT NULL,
      section_id INTEGER,
      section_name TEXT,
      last_synced TEXT,
      start_time TEXT,
      meeting_number TEXT,
      password TEXT
    );

    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS course_sections (
      id INTEGER PRIMARY KEY,
      course_moodle_id INTEGER NOT NULL,
      source_course_id INTEGER,
      section_number INTEGER NOT NULL,
      name TEXT NOT NULL,
      summary_html TEXT,
      parent_section_id INTEGER,
      level INTEGER DEFAULT 0,
      is_subsection_module INTEGER DEFAULT 0,
      section_url TEXT,
      visible INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS course_folders (
      id INTEGER PRIMARY KEY,
      instance_id INTEGER,
      course_moodle_id INTEGER NOT NULL,
      source_course_id INTEGER,
      course_name TEXT,
      section_id INTEGER,
      section_name TEXT,
      name TEXT NOT NULL,
      description_html TEXT,
      moodle_url TEXT,
      files_json TEXT,
      total_size INTEGER
    );

    CREATE TABLE IF NOT EXISTS course_links (
      id INTEGER PRIMARY KEY,
      course_moodle_id INTEGER NOT NULL,
      source_course_id INTEGER,
      course_name TEXT,
      section_id INTEGER,
      section_name TEXT,
      name TEXT NOT NULL,
      target_url TEXT,
      moodle_url TEXT,
      link_kind TEXT
    );

    CREATE TABLE IF NOT EXISTS course_announcements (
      id INTEGER PRIMARY KEY,
      course_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      moodle_url TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recordings (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      recording_url TEXT NOT NULL,
      published_date TEXT,
      type TEXT NOT NULL,
      course_id INTEGER NOT NULL,
      source_course_id INTEGER,
      course_name TEXT NOT NULL,
      folder_id TEXT,
      folder_url TEXT,
      section_name TEXT,
      duration_seconds INTEGER,
      host TEXT,
      classification_source TEXT,
      last_synced TEXT
    );

    CREATE TABLE IF NOT EXISTS course_staff (
      course_id INTEGER PRIMARY KEY,
      members_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS grade_summaries (
      course_id INTEGER PRIMARY KEY,
      course_total_formatted TEXT,
      course_total_raw REAL,
      course_total_max REAL,
      has_course_total INTEGER DEFAULT 0,
      items_json TEXT NOT NULL
    );
  `);

  try {
    const row = db.getFirstSync<{ value: string }>(
      "SELECT value FROM preferences WHERE key = 'migrated_zoom_unique_v2'"
    );
    if (!row) {
      db.execSync('DROP TABLE IF EXISTS meetings;');
      db.execSync(`
        CREATE TABLE IF NOT EXISTS meetings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          course_moodle_id INTEGER NOT NULL,
          course_name TEXT,
          title TEXT,
          meeting_url TEXT NOT NULL,
          section_id INTEGER,
          section_name TEXT,
          last_synced TEXT,
          start_time TEXT,
          meeting_number TEXT,
          password TEXT
        );
      `);
      db.runSync("INSERT OR REPLACE INTO preferences (key, value) VALUES ('migrated_zoom_unique_v2', '1')");
    }
  } catch {
    // Ignore
  }

  // Ensure legacy v1 columns exist before attempting v1 -> v2 table migration
  try { db.execSync('ALTER TABLE assignments ADD COLUMN attachments TEXT;'); } catch {}
  try { db.execSync('ALTER TABLE assignments ADD COLUMN submitted_files TEXT;'); } catch {}

  // Self-healing migration: check whether `uid` column actually exists on `assignments`
  try {
    const columns = db.getAllSync<{ name: string }>('PRAGMA table_info(assignments);');
    const hasUidColumn = Array.isArray(columns) && columns.some((col) => col.name === 'uid');
    if (Array.isArray(columns) && columns.length > 0 && !hasUidColumn) {
      db.execSync(`
        CREATE TABLE IF NOT EXISTS assignments_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          uid TEXT UNIQUE NOT NULL,
          moodle_assign_id INTEGER NOT NULL,
          activity_type TEXT DEFAULT 'assign',
          cmid INTEGER,
          course_moodle_id INTEGER NOT NULL,
          source_course_id INTEGER,
          course_name TEXT,
          name TEXT NOT NULL,
          status TEXT DEFAULT 'Assigned',
          deadline TEXT,
          cutoff_date TEXT,
          opened TEXT,
          link TEXT,
          grade REAL,
          grade_max REAL,
          last_synced TEXT,
          attachments TEXT,
          submitted_files TEXT,
          time_limit_seconds INTEGER,
          attempts_allowed INTEGER,
          has_finished_attempt INTEGER DEFAULT 0,
          requires_manual_completion INTEGER DEFAULT 0,
          is_manual_completion_done INTEGER DEFAULT 0,
          completion_tracking INTEGER,
          is_completed INTEGER DEFAULT 0,
          section_id INTEGER,
          section_name TEXT,
          feedback TEXT,
          is_bonus INTEGER DEFAULT 0,
          is_late_submission_box INTEGER DEFAULT 0,
          is_hidden INTEGER DEFAULT 0
        );
      `);
      try {
        db.execSync(`
          INSERT OR IGNORE INTO assignments_v2 (
            uid, moodle_assign_id, activity_type, cmid, course_moodle_id, course_name, name, status, deadline, opened, link, grade, grade_max, last_synced, attachments, submitted_files
          )
          SELECT
            'assign:' || moodle_assign_id,
            moodle_assign_id,
            'assign',
            cmid,
            course_moodle_id,
            course_name,
            name,
            status,
            deadline,
            opened,
            link,
            grade,
            grade_max,
            last_synced,
            attachments,
            submitted_files
          FROM assignments;
        `);
      } catch (errCopy) {
        console.warn('assignments_v2 copy warning:', errCopy);
      }
      db.execSync('DROP TABLE IF EXISTS assignments;');
      db.execSync('ALTER TABLE assignments_v2 RENAME TO assignments;');
      db.runSync("INSERT OR REPLACE INTO preferences (key, value) VALUES ('migrated_assignments_v2', '1')");
    }
  } catch (e) {
    console.warn('assignments_v2 migration error:', e);
  }

  // Incremental column migrations for existing databases
  const alterStatements = [
    'ALTER TABLE meetings ADD COLUMN start_time TEXT;',
    'ALTER TABLE meetings ADD COLUMN meeting_number TEXT;',
    'ALTER TABLE meetings ADD COLUMN password TEXT;',
    'ALTER TABLE meetings ADD COLUMN section_id INTEGER;',
    'ALTER TABLE files ADD COLUMN module_id INTEGER;',
    'ALTER TABLE files ADD COLUMN source_course_id INTEGER;',
    'ALTER TABLE files ADD COLUMN section_id INTEGER;',
    'ALTER TABLE files ADD COLUMN section_number INTEGER;',
    'ALTER TABLE files ADD COLUMN folder_id INTEGER;',
    'ALTER TABLE files ADD COLUMN folder_name TEXT;',
    'ALTER TABLE files ADD COLUMN relative_path TEXT;',
    'ALTER TABLE files ADD COLUMN module_name TEXT;',
    'ALTER TABLE files ADD COLUMN download_url TEXT;',
    'ALTER TABLE files ADD COLUMN time_modified INTEGER;',
    'ALTER TABLE files ADD COLUMN is_new INTEGER DEFAULT 0;',
    'ALTER TABLE assignments ADD COLUMN source_course_id INTEGER;',
    'ALTER TABLE assignments ADD COLUMN section_id INTEGER;',
    'ALTER TABLE assignments ADD COLUMN section_name TEXT;',
    'ALTER TABLE assignments ADD COLUMN feedback TEXT;',
    'ALTER TABLE assignments ADD COLUMN is_bonus INTEGER DEFAULT 0;',
    'ALTER TABLE assignments ADD COLUMN is_late_submission_box INTEGER DEFAULT 0;',
    'ALTER TABLE assignments ADD COLUMN cutoff_date TEXT;',
    'ALTER TABLE assignments ADD COLUMN is_hidden INTEGER DEFAULT 0;',
    'ALTER TABLE assignments ADD COLUMN attempts_allowed INTEGER;',
    'ALTER TABLE assignments ADD COLUMN has_finished_attempt INTEGER DEFAULT 0;',
    'ALTER TABLE assignments ADD COLUMN completion_tracking INTEGER;',
    'ALTER TABLE assignments ADD COLUMN is_completed INTEGER DEFAULT 0;',
    'ALTER TABLE course_sections ADD COLUMN source_course_id INTEGER;',
    'ALTER TABLE course_folders ADD COLUMN source_course_id INTEGER;',
    'ALTER TABLE course_links ADD COLUMN source_course_id INTEGER;',
  ];

  for (const stmt of alterStatements) {
    try {
      db.execSync(stmt);
    } catch {
      // Column already exists
    }
  }

  // Performance indexes on hot foreign-key and sort columns
  const indexStatements = [
    'CREATE INDEX IF NOT EXISTS idx_assignments_course_moodle_id ON assignments(course_moodle_id);',
    'CREATE INDEX IF NOT EXISTS idx_assignments_deadline ON assignments(deadline);',
    'CREATE INDEX IF NOT EXISTS idx_files_course_moodle_id ON files(course_moodle_id);',
    'CREATE INDEX IF NOT EXISTS idx_meetings_course_moodle_id ON meetings(course_moodle_id);',
    'CREATE INDEX IF NOT EXISTS idx_course_sections_course_moodle_id ON course_sections(course_moodle_id);',
    'CREATE INDEX IF NOT EXISTS idx_course_folders_course_moodle_id ON course_folders(course_moodle_id);',
    'CREATE INDEX IF NOT EXISTS idx_course_links_course_moodle_id ON course_links(course_moodle_id);',
    'CREATE INDEX IF NOT EXISTS idx_course_announcements_course_id ON course_announcements(course_id);',
    'CREATE INDEX IF NOT EXISTS idx_recordings_course_id ON recordings(course_id);',
  ];
  for (const stmt of indexStatements) {
    try {
      db.execSync(stmt);
    } catch {
      // Ignore index creation error on unsupported adapters
    }
  }
}

// ── Preference Helpers ─────────────────────────────────────────────────────

export function getAllPreferences(): Record<string, string> {
  try {
    if (isMemoryFallbackActive()) {
      const ls = getWebLocalStorage();
      if (ls) {
        try {
          for (let i = 0; i < ls.length; i++) {
            const k = ls.key(i);
            if (k && k.startsWith(WEB_PREF_PREFIX)) {
              const prefKey = k.slice(WEB_PREF_PREFIX.length);
              if (!Object.prototype.hasOwnProperty.call(memPrefs, prefKey)) {
                const v = ls.getItem(k);
                if (v !== null) memPrefs[prefKey] = v;
              }
            }
          }
        } catch {}
      }
      return { ...memPrefs };
    }
    const db = getDb();
    const rows = db.getAllSync<{ key: string; value: string }>('SELECT key, value FROM preferences');
    const out: Record<string, string> = {};
    for (const row of rows) {
      if (row && typeof row.key === 'string') {
        out[row.key] = row.value;
      }
    }
    return out;
  } catch (e) {
    console.error('getAllPreferences error:', e);
    return {};
  }
}

export function getPreference(key: string): string | null {
  try {
    if (isMemoryFallbackActive()) {
      return readMemPref(key);
    }
    const db = getDb();
    const result = db.getFirstSync<{ value: string }>(
      'SELECT value FROM preferences WHERE key = ?',
      [key]
    );
    return result ? result.value : null;
  } catch (e) {
    console.error('getPreference error:', e);
    return null;
  }
}

export function setPreference(key: string, value: string): void {
  try {
    if (isMemoryFallbackActive()) {
      writeMemPref(key, value);
      return;
    }
    const db = getDb();
    db.runSync('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)', [key, String(value)]);
  } catch (e) {
    console.error('setPreference error:', e);
  }
}

export function removePreference(key: string): void {
  try {
    if (isMemoryFallbackActive()) {
      deleteMemPref(key);
      return;
    }
    const db = getDb();
    db.runSync('DELETE FROM preferences WHERE key = ?', [key]);
  } catch (e) {
    console.error('removePreference error:', e);
  }
}

// ── Tracked Courses Helpers ────────────────────────────────────────────────

export function getTrackedCourses(activeOnly: boolean = true): TrackedCourseRow[] {
  try {
    if (isMemoryFallbackActive()) {
      const rows = activeOnly
        ? memTables.tracked_courses.filter((r) => Number(r.is_active) === 1)
        : memTables.tracked_courses;
      return rows.map((r) => ({ ...r }));
    }
    const db = getDb();
    const query = activeOnly
      ? 'SELECT * FROM tracked_courses WHERE is_active = 1 ORDER BY id ASC'
      : 'SELECT * FROM tracked_courses ORDER BY id ASC';
    return db.getAllSync<TrackedCourseRow>(query);
  } catch (e) {
    console.error('getTrackedCourses error:', e);
    return [];
  }
}

export function saveTrackedCourses(
  courses: TrackedCourseInput[],
  options?: { merge?: boolean }
): void {
  try {
    const merge = options?.merge ?? false;
    const normalizeRow = (c: TrackedCourseInput): TrackedCourseRow | null => {
      const moodleId = Number(c.moodle_id ?? c.id);
      if (!Number.isFinite(moodleId) || moodleId <= 0) return null;
      const isActive =
        c.is_active === undefined ? 1 : c.is_active === false || c.is_active === 0 ? 0 : 1;
      return {
        moodle_id: moodleId,
        course_id: c.course_id ?? c.courseId ?? c.idnumber ?? null,
        name: c.name ?? c.fullname ?? c.shortname ?? `Course ${moodleId}`,
        semester: c.semester ?? null,
        year: c.year ?? null,
        color: c.color ?? '#6366f1',
        is_active: isActive,
      };
    };

    const normalized = courses.map(normalizeRow).filter((r): r is TrackedCourseRow => r !== null);

    if (isMemoryFallbackActive()) {
      if (!merge) {
        for (const existing of memTables.tracked_courses) {
          existing.is_active = 0;
        }
      }
      for (const row of normalized) {
        const idx = memTables.tracked_courses.findIndex((r) => r.moodle_id === row.moodle_id);
        if (idx >= 0) {
          memTables.tracked_courses[idx] = { ...memTables.tracked_courses[idx], ...row };
        } else {
          memTables.tracked_courses.push({ id: nextMemId(), ...row });
        }
      }
      return;
    }

    const db = getDb();
    runInTransaction(() => {
      if (!merge) {
        db.runSync('UPDATE tracked_courses SET is_active = 0');
      }
      for (const row of normalized) {
        const existing = db.getFirstSync<{ id: number }>(
          'SELECT id FROM tracked_courses WHERE moodle_id = ?',
          [row.moodle_id]
        );
        if (existing) {
          db.runSync(
            `UPDATE tracked_courses
             SET course_id = ?, name = ?, semester = ?, year = ?, color = ?, is_active = ?
             WHERE moodle_id = ?`,
            [row.course_id ?? null, row.name, row.semester ?? null, row.year ?? null, row.color ?? null, row.is_active, row.moodle_id]
          );
        } else {
          db.runSync(
            `INSERT INTO tracked_courses (moodle_id, course_id, name, semester, year, color, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [row.moodle_id, row.course_id ?? null, row.name, row.semester ?? null, row.year ?? null, row.color ?? null, row.is_active]
          );
        }
      }
    });
  } catch (e) {
    console.error('saveTrackedCourses error:', e);
  }
}

// ── Sync Result Persistence ────────────────────────────────────────────────

export interface SaveSyncOptions {
  panoptoEnabled?: boolean;
  activeCourseIds?: number[];
}

function dedupeMeetings(meetings: ZoomMeeting[]): ZoomMeeting[] {
  const seen = new Set<string>();
  const out: ZoomMeeting[] = [];
  for (const m of meetings) {
    const key = `${m.courseId}|${(m.meetingUrl || '').trim()}|${(m.title || '').trim()}|${m.startTime || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(m);
    }
  }
  return out;
}

export function saveSyncResultToDatabase(
  result: Partial<SyncResult>,
  options?: SaveSyncOptions
): void {
  try {
    const nowStr = result.syncedAt || new Date().toISOString();
    const isFinalSync = Boolean(result.syncedAt);

    const isPanoptoEnabled =
      options?.panoptoEnabled !== undefined
        ? Boolean(options.panoptoEnabled)
        : getPreference('panopto_enabled') === 'true';

    const errorsList = Array.isArray(result.errors) ? result.errors : [];
    const hasPanoptoError = errorsList.some((e) =>
      /panopto/i.test(`${e?.context || ''} ${e?.message || ''}`)
    );

    const failedContentCourseIds = new Set<number>();
    for (const err of errorsList) {
      const errWithCourse = err as SyncError & { courseId?: number };
      const ctx = String(errWithCourse?.context || '');
      const msg = String(errWithCourse?.message || '');
      let errCourseId: number | undefined =
        typeof errWithCourse?.courseId === 'number' ? errWithCourse.courseId : undefined;
      if (errCourseId === undefined) {
        const match = `${ctx} ${msg}`.match(/course[\s_:#-]*(\d+)/i);
        if (match && match[1]) {
          const parsed = Number(match[1]);
          if (Number.isFinite(parsed) && parsed > 0) errCourseId = parsed;
        }
      }
      if (
        errCourseId !== undefined &&
        (/content|section|file|folder|module|getCourseContents/i.test(`${ctx} ${msg}`) ||
          !/panopto|grade|staff/i.test(ctx))
      ) {
        failedContentCourseIds.add(errCourseId);
      }
    }

    const syncedCourseIds = new Set<number>();
    const addCourseIds = (arr?: any[], field: string = 'courseId') => {
      if (!Array.isArray(arr)) return;
      for (const item of arr) {
        if (typeof item?.[field] === 'number') {
          syncedCourseIds.add(item[field]);
        }
      }
    };
    addCourseIds(result.courses, 'id');
    addCourseIds(result.assignments);
    addCourseIds(result.files);
    addCourseIds(result.meetings);
    addCourseIds(result.sections);
    addCourseIds(result.folders);
    addCourseIds(result.links);
    addCourseIds(result.announcements);
    addCourseIds(result.recordings);

    if (result.courseStaff) {
      for (const cidKey of Object.keys(result.courseStaff)) {
        const cid = Number(cidKey);
        if (Number.isFinite(cid)) syncedCourseIds.add(cid);
      }
    }
    if (result.gradeSummaries) {
      for (const cidKey of Object.keys(result.gradeSummaries)) {
        const cid = Number(cidKey);
        if (Number.isFinite(cid)) syncedCourseIds.add(cid);
      }
    }

    // Meetings to write (deduped) and the course IDs whose meetings should be replaced even on partial save
    const uniqueMeetings = Array.isArray(result.meetings) ? dedupeMeetings(result.meetings) : [];
    const meetingCourseIds = new Set<number>();
    for (const m of uniqueMeetings) {
      if (typeof m.courseId === 'number') meetingCourseIds.add(m.courseId);
    }

    // Active tracked course IDs for untracked-course pruning on final sync (preserves MOCK_COURSE_ID if active)
    const activeKeepIds = new Set<number>();
    if (isFinalSync) {
      if (Array.isArray(options?.activeCourseIds)) {
        for (const id of options.activeCourseIds) {
          if (Number.isFinite(id) && id > 0) activeKeepIds.add(id);
        }
      } else {
        try {
          for (const row of getTrackedCourses(true)) {
            if (Number.isFinite(row.moodle_id) && row.moodle_id > 0) {
              activeKeepIds.add(row.moodle_id);
            }
          }
        } catch {}
        if (activeKeepIds.size === 0) {
          const prefIds = safeJsonParse<number[]>(getPreference('tracked_course_ids'), []);
          for (const id of prefIds) {
            if (Number.isFinite(id) && id > 0) activeKeepIds.add(id);
          }
        }
      }
      for (const cid of syncedCourseIds) {
        if (activeKeepIds.size > 0 && activeKeepIds.has(cid)) {
          activeKeepIds.add(cid);
        }
      }
    }

    if (isMemoryFallbackActive()) {
      if (isFinalSync) {
        for (const cid of syncedCourseIds) {
          const contentFailed = failedContentCourseIds.has(cid);
          if (Array.isArray(result.courses)) {
            memTables.courses = memTables.courses.filter((c) => c.id !== cid);
          }
          if (Array.isArray(result.assignments)) {
            memTables.assignments = memTables.assignments.filter((a) => a.course_moodle_id !== cid);
          }
          if (Array.isArray(result.files) && !contentFailed) {
            memTables.files = memTables.files.filter((f) => f.course_moodle_id !== cid);
          }
          if (Array.isArray(result.meetings)) {
            memTables.meetings = memTables.meetings.filter((m) => m.course_moodle_id !== cid);
          }
          if (Array.isArray(result.sections) && !contentFailed) {
            memTables.course_sections = memTables.course_sections.filter((s) => s.course_moodle_id !== cid);
          }
          if (Array.isArray(result.folders) && !contentFailed) {
            memTables.course_folders = memTables.course_folders.filter((f) => f.course_moodle_id !== cid);
          }
          if (Array.isArray(result.links) && !contentFailed) {
            memTables.course_links = memTables.course_links.filter((l) => l.course_moodle_id !== cid);
          }
          if (Array.isArray(result.announcements)) {
            memTables.course_announcements = memTables.course_announcements.filter((a) => a.course_id !== cid);
          }
          if (Array.isArray(result.recordings) && isPanoptoEnabled && !hasPanoptoError) {
            memTables.recordings = memTables.recordings.filter((r) => r.course_id !== cid);
          }
          if (result.courseStaff) {
            memTables.course_staff = memTables.course_staff.filter((s) => s.course_id !== cid);
          }
          if (result.gradeSummaries) {
            memTables.grade_summaries = memTables.grade_summaries.filter((g) => g.course_id !== cid);
          }
        }

        // Prune rows belonging to untracked courses
        if (activeKeepIds.size > 0) {
          memTables.courses = memTables.courses.filter((c) => activeKeepIds.has(c.id));
          memTables.assignments = memTables.assignments.filter((a) => activeKeepIds.has(a.course_moodle_id));
          memTables.files = memTables.files.filter((f) => activeKeepIds.has(f.course_moodle_id));
          memTables.meetings = memTables.meetings.filter((m) => activeKeepIds.has(m.course_moodle_id));
          memTables.course_sections = memTables.course_sections.filter((s) => activeKeepIds.has(s.course_moodle_id));
          memTables.course_folders = memTables.course_folders.filter((f) => activeKeepIds.has(f.course_moodle_id));
          memTables.course_links = memTables.course_links.filter((l) => activeKeepIds.has(l.course_moodle_id));
          memTables.course_announcements = memTables.course_announcements.filter((a) => activeKeepIds.has(a.course_id));
          memTables.recordings = memTables.recordings.filter((r) => activeKeepIds.has(r.course_id));
          memTables.course_staff = memTables.course_staff.filter((s) => activeKeepIds.has(s.course_id));
          memTables.grade_summaries = memTables.grade_summaries.filter((g) => activeKeepIds.has(g.course_id));
        }
      } else if (meetingCourseIds.size > 0) {
        // Partial save: still replace meetings per course so Zoom meetings never duplicate
        memTables.meetings = memTables.meetings.filter((m) => !meetingCourseIds.has(m.course_moodle_id));
      }

      for (const c of result.courses || []) {
        const row = {
          id: c.id,
          course_id: c.courseId,
          shortname: c.shortname,
          fullname: c.fullname,
          idnumber: c.idnumber ?? null,
          semester: c.semester,
          year: c.year,
          visible: c.visible ?? 1,
          startdate: c.startdate ?? null,
          enddate: c.enddate ?? null,
          summary: c.summary ?? null,
          courseimage: c.courseimage ?? null,
          base_url: c.baseUrl ?? null,
          format: c.format ?? null,
          coursecategory: c.coursecategory ?? null,
        };
        const idx = memTables.courses.findIndex((x) => x.id === row.id);
        if (idx >= 0) memTables.courses[idx] = row;
        else memTables.courses.push(row);
      }

      for (const a of result.assignments || []) {
        const uid = a.uid || `${a.activityType || 'assign'}:${a.id}`;
        const row = {
          id: nextMemId(),
          uid,
          moodle_assign_id: a.id,
          activity_type: a.activityType || 'assign',
          cmid: a.cmid,
          course_moodle_id: a.courseId,
          source_course_id: a.sourceCourseId ?? null,
          course_name: a.courseName,
          name: a.name,
          status: a.status,
          deadline: a.deadline,
          cutoff_date: a.cutoffDate || null,
          opened: a.opened,
          link: a.link,
          grade: a.grade,
          grade_max: a.gradeMax,
          last_synced: nowStr,
          attachments: JSON.stringify(a.attachments || []),
          submitted_files: JSON.stringify(a.submittedFiles || []),
          time_limit_seconds: a.timeLimitSeconds ?? null,
          attempts_allowed: a.attemptsAllowed ?? null,
          has_finished_attempt: a.hasFinishedAttempt ? 1 : 0,
          requires_manual_completion: a.requiresManualCompletion ? 1 : 0,
          is_manual_completion_done: a.isManualCompletionDone ? 1 : 0,
          completion_tracking: a.completionTracking ?? null,
          is_completed: a.isCompleted ? 1 : 0,
          section_id: a.sectionId ?? null,
          section_name: a.sectionName || null,
          feedback: a.feedback || null,
          is_bonus: a.isBonus ? 1 : 0,
          is_late_submission_box: a.isLateSubmissionBox ? 1 : 0,
          is_hidden: a.isHidden ? 1 : 0,
        };
        const idx = memTables.assignments.findIndex((x) => x.uid === uid);
        if (idx >= 0) memTables.assignments[idx] = row;
        else memTables.assignments.push(row);
      }

      for (const f of result.files || []) {
        const row = {
          id: nextMemId(),
          module_id: f.id ?? null,
          course_moodle_id: f.courseId,
          source_course_id: f.sourceCourseId ?? null,
          course_name: f.courseName,
          section_id: f.sectionId ?? null,
          section_number: f.sectionNumber ?? null,
          section_name: f.sectionName || null,
          folder_id: f.folderId ?? null,
          folder_name: f.folderName || null,
          relative_path: f.relativePath || null,
          module_name: f.moduleName || null,
          file_name: f.fileName,
          file_url: f.fileUrl,
          download_url: f.downloadUrl || null,
          file_size: f.fileSize,
          mime_type: f.mimeType,
          time_modified: f.timeModified ?? 0,
          is_new: f.isNew ? 1 : 0,
          last_synced: nowStr,
        };
        const idx = memTables.files.findIndex((x) => x.file_url === row.file_url);
        if (idx >= 0) memTables.files[idx] = row;
        else memTables.files.push(row);
      }

      for (const m of uniqueMeetings) {
        memTables.meetings.push({
          id: nextMemId(),
          course_moodle_id: m.courseId,
          course_name: m.courseName,
          title: m.title,
          meeting_url: m.meetingUrl,
          section_id: m.sectionId ?? null,
          section_name: m.sectionName,
          last_synced: nowStr,
          start_time: m.startTime || null,
          meeting_number: m.meetingNumber || null,
          password: m.password || null,
        });
      }

      for (const s of result.sections || []) {
        const row = {
          id: s.id,
          course_moodle_id: s.courseId,
          source_course_id: s.sourceCourseId ?? null,
          section_number: s.sectionNumber,
          name: s.name,
          summary_html: s.summaryHtml || null,
          parent_section_id: s.parentSectionId !== undefined ? s.parentSectionId : null,
          level: s.level ?? 0,
          is_subsection_module: s.isSubsectionModule ? 1 : 0,
          section_url: s.sectionUrl || null,
          visible: s.visible ? 1 : 0,
        };
        const idx = memTables.course_sections.findIndex((x) => x.id === row.id);
        if (idx >= 0) memTables.course_sections[idx] = row;
        else memTables.course_sections.push(row);
      }

      for (const fld of result.folders || []) {
        const row = {
          id: fld.id,
          instance_id: fld.instanceId || null,
          course_moodle_id: fld.courseId,
          source_course_id: fld.sourceCourseId ?? null,
          course_name: fld.courseName || '',
          section_id: fld.sectionId || 0,
          section_name: fld.sectionName || '',
          name: fld.name,
          description_html: fld.descriptionHtml || null,
          moodle_url: fld.moodleUrl || null,
          files_json: JSON.stringify(fld.files || []),
          total_size: fld.totalSize || 0,
        };
        const idx = memTables.course_folders.findIndex((x) => x.id === row.id);
        if (idx >= 0) memTables.course_folders[idx] = row;
        else memTables.course_folders.push(row);
      }

      for (const lnk of result.links || []) {
        const row = {
          id: lnk.id,
          course_moodle_id: lnk.courseId,
          source_course_id: lnk.sourceCourseId ?? null,
          course_name: lnk.courseName || '',
          section_id: lnk.sectionId || 0,
          section_name: lnk.sectionName || '',
          name: lnk.name,
          target_url: lnk.targetUrl,
          moodle_url: lnk.moodleUrl || null,
          link_kind: lnk.linkKind || 'external',
        };
        const idx = memTables.course_links.findIndex((x) => x.id === row.id);
        if (idx >= 0) memTables.course_links[idx] = row;
        else memTables.course_links.push(row);
      }

      for (const ann of result.announcements || []) {
        const row = {
          id: ann.id,
          course_id: ann.courseId,
          name: ann.name,
          moodle_url: ann.moodleUrl,
        };
        const idx = memTables.course_announcements.findIndex((x) => x.id === row.id);
        if (idx >= 0) memTables.course_announcements[idx] = row;
        else memTables.course_announcements.push(row);
      }

      for (const rec of result.recordings || []) {
        const row = {
          id: rec.id,
          title: rec.title,
          recording_url: rec.recordingUrl,
          published_date: rec.publishedDate || '',
          type: rec.type,
          course_id: rec.courseId,
          source_course_id: rec.sourceCourseId ?? null,
          course_name: rec.courseName,
          folder_id: rec.folderId ?? null,
          folder_url: rec.folderUrl ?? null,
          section_name: rec.sectionName ?? null,
          duration_seconds: rec.durationSeconds ?? null,
          host: rec.host ?? null,
          classification_source: rec.classificationSource ?? null,
          last_synced: nowStr,
        };
        const idx = memTables.recordings.findIndex((x) => x.id === row.id);
        if (idx >= 0) memTables.recordings[idx] = row;
        else memTables.recordings.push(row);
      }

      if (result.courseStaff) {
        for (const [cidKey, members] of Object.entries(result.courseStaff)) {
          const courseId = Number(cidKey);
          const row = { course_id: courseId, members_json: JSON.stringify(members || []) };
          const idx = memTables.course_staff.findIndex((x) => x.course_id === courseId);
          if (idx >= 0) memTables.course_staff[idx] = row;
          else memTables.course_staff.push(row);
        }
      }

      if (result.gradeSummaries) {
        for (const [cidKey, summary] of Object.entries(result.gradeSummaries)) {
          const courseId = Number(cidKey);
          const row = {
            course_id: courseId,
            course_total_formatted: summary.courseTotalFormatted ?? null,
            course_total_raw: summary.courseTotalRaw ?? null,
            course_total_max: summary.courseTotalMax ?? null,
            has_course_total: summary.hasCourseTotal ? 1 : 0,
            items_json: JSON.stringify(summary.items || []),
          };
          const idx = memTables.grade_summaries.findIndex((x) => x.course_id === courseId);
          if (idx >= 0) memTables.grade_summaries[idx] = row;
          else memTables.grade_summaries.push(row);
        }
      }

      if (result.syncedAt) {
        writeMemPref('last_synced_at', result.syncedAt);
      }
      if (Array.isArray(result.errors)) {
        writeMemPref('last_sync_errors', JSON.stringify(result.errors));
      }
      return;
    }

    const db = getDb();
    runInTransaction(() => {
      if (isFinalSync) {
        for (const cid of syncedCourseIds) {
          const contentFailed = failedContentCourseIds.has(cid);
          if (Array.isArray(result.courses)) {
            db.runSync('DELETE FROM courses WHERE id = ?', [cid]);
          }
          if (Array.isArray(result.assignments)) {
            db.runSync('DELETE FROM assignments WHERE course_moodle_id = ?', [cid]);
          }
          if (Array.isArray(result.files) && !contentFailed) {
            db.runSync('DELETE FROM files WHERE course_moodle_id = ?', [cid]);
          }
          if (Array.isArray(result.meetings)) {
            db.runSync('DELETE FROM meetings WHERE course_moodle_id = ?', [cid]);
          }
          if (Array.isArray(result.sections) && !contentFailed) {
            db.runSync('DELETE FROM course_sections WHERE course_moodle_id = ?', [cid]);
          }
          if (Array.isArray(result.folders) && !contentFailed) {
            db.runSync('DELETE FROM course_folders WHERE course_moodle_id = ?', [cid]);
          }
          if (Array.isArray(result.links) && !contentFailed) {
            db.runSync('DELETE FROM course_links WHERE course_moodle_id = ?', [cid]);
          }
          if (Array.isArray(result.announcements)) {
            db.runSync('DELETE FROM course_announcements WHERE course_id = ?', [cid]);
          }
          if (Array.isArray(result.recordings) && isPanoptoEnabled && !hasPanoptoError) {
            db.runSync('DELETE FROM recordings WHERE course_id = ?', [cid]);
          }
          if (result.courseStaff) {
            db.runSync('DELETE FROM course_staff WHERE course_id = ?', [cid]);
          }
          if (result.gradeSummaries) {
            db.runSync('DELETE FROM grade_summaries WHERE course_id = ?', [cid]);
          }
        }

        // Prune rows belonging to untracked courses (preserving MOCK_COURSE_ID if active)
        if (activeKeepIds.size > 0) {
          const keepArr = Array.from(activeKeepIds);
          const placeholders = keepArr.map(() => '?').join(', ');
          db.runSync(`DELETE FROM courses WHERE id NOT IN (${placeholders})`, keepArr);
          db.runSync(`DELETE FROM assignments WHERE course_moodle_id NOT IN (${placeholders})`, keepArr);
          db.runSync(`DELETE FROM files WHERE course_moodle_id NOT IN (${placeholders})`, keepArr);
          db.runSync(`DELETE FROM meetings WHERE course_moodle_id NOT IN (${placeholders})`, keepArr);
          db.runSync(`DELETE FROM course_sections WHERE course_moodle_id NOT IN (${placeholders})`, keepArr);
          db.runSync(`DELETE FROM course_folders WHERE course_moodle_id NOT IN (${placeholders})`, keepArr);
          db.runSync(`DELETE FROM course_links WHERE course_moodle_id NOT IN (${placeholders})`, keepArr);
          db.runSync(`DELETE FROM course_announcements WHERE course_id NOT IN (${placeholders})`, keepArr);
          db.runSync(`DELETE FROM recordings WHERE course_id NOT IN (${placeholders})`, keepArr);
          db.runSync(`DELETE FROM course_staff WHERE course_id NOT IN (${placeholders})`, keepArr);
          db.runSync(`DELETE FROM grade_summaries WHERE course_id NOT IN (${placeholders})`, keepArr);
        }
      } else if (meetingCourseIds.size > 0) {
        // Partial save: replace meetings per course so Zoom meetings never duplicate
        for (const cid of meetingCourseIds) {
          db.runSync('DELETE FROM meetings WHERE course_moodle_id = ?', [cid]);
        }
      }

      for (const c of result.courses || []) {
        db.runSync(
          `INSERT OR REPLACE INTO courses
          (id, course_id, shortname, fullname, idnumber, semester, year, visible, startdate, enddate, summary, courseimage, base_url, format, coursecategory)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            c.id,
            c.courseId,
            c.shortname,
            c.fullname,
            c.idnumber ?? null,
            c.semester,
            c.year,
            c.visible ?? 1,
            c.startdate ?? null,
            c.enddate ?? null,
            c.summary ?? null,
            c.courseimage ?? null,
            c.baseUrl ?? null,
            c.format ?? null,
            c.coursecategory ?? null,
          ]
        );
      }

      for (const a of result.assignments || []) {
        const uid = a.uid || `${a.activityType || 'assign'}:${a.id}`;
        db.runSync(
          `INSERT OR REPLACE INTO assignments
          (uid, moodle_assign_id, activity_type, cmid, course_moodle_id, source_course_id, course_name, name, status, deadline, cutoff_date, opened, link, grade, grade_max, last_synced, attachments, submitted_files, time_limit_seconds, attempts_allowed, has_finished_attempt, requires_manual_completion, is_manual_completion_done, completion_tracking, is_completed, section_id, section_name, feedback, is_bonus, is_late_submission_box, is_hidden)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uid,
            a.id,
            a.activityType || 'assign',
            a.cmid,
            a.courseId,
            a.sourceCourseId ?? null,
            a.courseName,
            a.name,
            a.status,
            a.deadline,
            a.cutoffDate || null,
            a.opened,
            a.link,
            a.grade,
            a.gradeMax,
            nowStr,
            JSON.stringify(a.attachments || []),
            JSON.stringify(a.submittedFiles || []),
            a.timeLimitSeconds ?? null,
            a.attemptsAllowed ?? null,
            a.hasFinishedAttempt ? 1 : 0,
            a.requiresManualCompletion ? 1 : 0,
            a.isManualCompletionDone ? 1 : 0,
            a.completionTracking ?? null,
            a.isCompleted ? 1 : 0,
            a.sectionId ?? null,
            a.sectionName || null,
            a.feedback || null,
            a.isBonus ? 1 : 0,
            a.isLateSubmissionBox ? 1 : 0,
            a.isHidden ? 1 : 0,
          ]
        );
      }

      for (const f of result.files || []) {
        db.runSync(
          `INSERT OR REPLACE INTO files
          (module_id, course_moodle_id, source_course_id, course_name, section_id, section_number, section_name, folder_id, folder_name, relative_path, module_name, file_name, file_url, download_url, file_size, mime_type, time_modified, is_new, last_synced)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            f.id ?? null,
            f.courseId,
            f.sourceCourseId ?? null,
            f.courseName,
            f.sectionId ?? null,
            f.sectionNumber ?? null,
            f.sectionName || null,
            f.folderId ?? null,
            f.folderName || null,
            f.relativePath || null,
            f.moduleName || null,
            f.fileName,
            f.fileUrl,
            f.downloadUrl || null,
            f.fileSize,
            f.mimeType,
            f.timeModified ?? 0,
            f.isNew ? 1 : 0,
            nowStr,
          ]
        );
      }

      for (const m of uniqueMeetings) {
        db.runSync(
          `INSERT OR REPLACE INTO meetings
          (course_moodle_id, course_name, title, meeting_url, section_id, section_name, last_synced, start_time, meeting_number, password)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            m.courseId,
            m.courseName,
            m.title,
            m.meetingUrl,
            m.sectionId ?? null,
            m.sectionName,
            nowStr,
            m.startTime || null,
            m.meetingNumber || null,
            m.password || null,
          ]
        );
      }

      if (Array.isArray(result.sections)) {
        for (const s of result.sections) {
          db.runSync(
            `INSERT OR REPLACE INTO course_sections
            (id, course_moodle_id, source_course_id, section_number, name, summary_html, parent_section_id, level, is_subsection_module, section_url, visible)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              s.id,
              s.courseId,
              s.sourceCourseId ?? null,
              s.sectionNumber,
              s.name,
              s.summaryHtml || null,
              s.parentSectionId !== undefined ? s.parentSectionId : null,
              s.level ?? 0,
              s.isSubsectionModule ? 1 : 0,
              s.sectionUrl || null,
              s.visible ? 1 : 0,
            ]
          );
        }
      }

      if (Array.isArray(result.folders)) {
        for (const fld of result.folders) {
          db.runSync(
            `INSERT OR REPLACE INTO course_folders
            (id, instance_id, course_moodle_id, source_course_id, course_name, section_id, section_name, name, description_html, moodle_url, files_json, total_size)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              fld.id,
              fld.instanceId || null,
              fld.courseId,
              fld.sourceCourseId ?? null,
              fld.courseName || '',
              fld.sectionId || 0,
              fld.sectionName || '',
              fld.name,
              fld.descriptionHtml || null,
              fld.moodleUrl || null,
              JSON.stringify(fld.files || []),
              fld.totalSize || 0,
            ]
          );
        }
      }

      if (Array.isArray(result.links)) {
        for (const lnk of result.links) {
          db.runSync(
            `INSERT OR REPLACE INTO course_links
            (id, course_moodle_id, source_course_id, course_name, section_id, section_name, name, target_url, moodle_url, link_kind)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              lnk.id,
              lnk.courseId,
              lnk.sourceCourseId ?? null,
              lnk.courseName || '',
              lnk.sectionId || 0,
              lnk.sectionName || '',
              lnk.name,
              lnk.targetUrl,
              lnk.moodleUrl || null,
              lnk.linkKind || 'external',
            ]
          );
        }
      }

      if (Array.isArray(result.announcements)) {
        for (const ann of result.announcements) {
          db.runSync(
            `INSERT OR REPLACE INTO course_announcements
            (id, course_id, name, moodle_url)
            VALUES (?, ?, ?, ?)`,
            [ann.id, ann.courseId, ann.name, ann.moodleUrl]
          );
        }
      }

      if (Array.isArray(result.recordings)) {
        for (const rec of result.recordings) {
          db.runSync(
            `INSERT OR REPLACE INTO recordings
            (id, title, recording_url, published_date, type, course_id, source_course_id, course_name, folder_id, folder_url, section_name, duration_seconds, host, classification_source, last_synced)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              rec.id,
              rec.title,
              rec.recordingUrl,
              rec.publishedDate || '',
              rec.type,
              rec.courseId,
              rec.sourceCourseId ?? null,
              rec.courseName,
              rec.folderId ?? null,
              rec.folderUrl ?? null,
              rec.sectionName ?? null,
              rec.durationSeconds ?? null,
              rec.host ?? null,
              rec.classificationSource ?? null,
              nowStr,
            ]
          );
        }
      }

      if (result.courseStaff) {
        for (const [cidKey, members] of Object.entries(result.courseStaff)) {
          db.runSync(
            'INSERT OR REPLACE INTO course_staff (course_id, members_json) VALUES (?, ?)',
            [Number(cidKey), JSON.stringify(members || [])]
          );
        }
      }

      if (result.gradeSummaries) {
        for (const [cidKey, summary] of Object.entries(result.gradeSummaries)) {
          db.runSync(
            `INSERT OR REPLACE INTO grade_summaries
            (course_id, course_total_formatted, course_total_raw, course_total_max, has_course_total, items_json)
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
              Number(cidKey),
              summary.courseTotalFormatted ?? null,
              summary.courseTotalRaw ?? null,
              summary.courseTotalMax ?? null,
              summary.hasCourseTotal ? 1 : 0,
              JSON.stringify(summary.items || []),
            ]
          );
        }
      }

      if (result.syncedAt) {
        db.runSync('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)', [
          'last_synced_at',
          result.syncedAt,
        ]);
      }
      if (Array.isArray(result.errors)) {
        db.runSync('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)', [
          'last_sync_errors',
          JSON.stringify(result.errors),
        ]);
      }
    });
  } catch (e) {
    console.error('saveSyncResultToDatabase error:', e);
  }
}

// ── Row Mappers ────────────────────────────────────────────────────────────

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function mapAssignmentRow(r: any): Assignment {
  return {
    id: r.moodle_assign_id,
    cmid: r.cmid,
    uid: r.uid,
    activityType: r.activity_type || 'assign',
    courseId: r.course_moodle_id,
    ...(r.source_course_id !== null && r.source_course_id !== undefined
      ? { sourceCourseId: r.source_course_id }
      : {}),
    courseName: r.course_name || '',
    name: r.name,
    status: r.status || 'Assigned',
    deadline: r.deadline ?? null,
    cutoffDate: r.cutoff_date ?? null,
    opened: r.opened ?? null,
    link: r.link || '',
    grade: r.grade ?? null,
    gradeMax: r.grade_max ?? null,
    ...(r.section_id !== null && r.section_id !== undefined ? { sectionId: r.section_id } : {}),
    ...(r.section_name ? { sectionName: r.section_name } : {}),
    attachments: safeJsonParse(r.attachments, []),
    submittedFiles: safeJsonParse(r.submitted_files, []),
    ...(r.time_limit_seconds !== null && r.time_limit_seconds !== undefined
      ? { timeLimitSeconds: r.time_limit_seconds }
      : {}),
    ...(r.attempts_allowed !== null && r.attempts_allowed !== undefined
      ? { attemptsAllowed: r.attempts_allowed }
      : {}),
    hasFinishedAttempt: Boolean(r.has_finished_attempt),
    requiresManualCompletion: Boolean(r.requires_manual_completion),
    isManualCompletionDone: Boolean(r.is_manual_completion_done),
    ...(r.completion_tracking !== null && r.completion_tracking !== undefined
      ? { completionTracking: r.completion_tracking }
      : {}),
    isCompleted: Boolean(r.is_completed),
    ...(r.feedback ? { feedback: r.feedback } : {}),
    ...(r.is_bonus ? { isBonus: true } : {}),
    ...(r.is_late_submission_box ? { isLateSubmissionBox: true } : {}),
    isHidden: Boolean(r.is_hidden),
  };
}

function mapFileRow(r: any): CourseFile {
  return {
    ...(r.module_id !== null && r.module_id !== undefined ? { id: r.module_id } : {}),
    fileName: r.file_name,
    fileUrl: r.file_url,
    ...(r.download_url ? { downloadUrl: r.download_url } : {}),
    fileSize: r.file_size ?? 0,
    mimeType: r.mime_type || 'application/octet-stream',
    ...(r.section_id !== null && r.section_id !== undefined ? { sectionId: r.section_id } : {}),
    ...(r.section_number !== null && r.section_number !== undefined
      ? { sectionNumber: r.section_number }
      : {}),
    sectionName: r.section_name || '',
    ...(r.folder_id !== null && r.folder_id !== undefined ? { folderId: r.folder_id } : {}),
    ...(r.folder_name ? { folderName: r.folder_name } : {}),
    ...(r.relative_path !== null && r.relative_path !== undefined
      ? { relativePath: r.relative_path }
      : {}),
    ...(r.module_name ? { moduleName: r.module_name } : {}),
    timeModified: r.time_modified ?? 0,
    courseId: r.course_moodle_id,
    ...(r.source_course_id !== null && r.source_course_id !== undefined
      ? { sourceCourseId: r.source_course_id }
      : {}),
    courseName: r.course_name || '',
    ...(r.is_new ? { isNew: true } : {}),
  };
}

function mapMeetingRow(r: any): ZoomMeeting {
  return {
    title: r.title || '',
    meetingUrl: r.meeting_url,
    ...(r.section_id !== null && r.section_id !== undefined ? { sectionId: r.section_id } : {}),
    sectionName: r.section_name || '',
    courseId: r.course_moodle_id,
    courseName: r.course_name || '',
    ...(r.start_time ? { startTime: r.start_time } : {}),
    ...(r.meeting_number ? { meetingNumber: r.meeting_number } : {}),
    ...(r.password ? { password: r.password } : {}),
  };
}

function mapRecordingRow(r: any): PanoptoRecording {
  return {
    id: r.id,
    title: r.title,
    recordingUrl: r.recording_url,
    publishedDate: r.published_date || '',
    type: r.type === 'Recitation' ? 'Recitation' : 'Lecture',
    courseId: r.course_id,
    ...(r.source_course_id !== null && r.source_course_id !== undefined
      ? { sourceCourseId: r.source_course_id }
      : {}),
    courseName: r.course_name,
    ...(r.folder_id ? { folderId: r.folder_id } : {}),
    ...(r.folder_url ? { folderUrl: r.folder_url } : {}),
    ...(r.section_name ? { sectionName: r.section_name } : {}),
    ...(r.duration_seconds !== null && r.duration_seconds !== undefined
      ? { durationSeconds: r.duration_seconds }
      : {}),
    ...(r.host ? { host: r.host } : {}),
    ...(r.classification_source ? { classificationSource: r.classification_source } : {}),
  };
}

// ── Entity Getters ─────────────────────────────────────────────────────────

export function getAssignments(courseMoodleId?: number): Assignment[] {
  try {
    if (isMemoryFallbackActive()) {
      const rows =
        courseMoodleId !== undefined
          ? memTables.assignments.filter((a) => a.course_moodle_id === courseMoodleId)
          : memTables.assignments;
      return [...rows]
        .sort((a, b) => {
          const da = a.deadline ? new Date(a.deadline).getTime() : Number.POSITIVE_INFINITY;
          const db = b.deadline ? new Date(b.deadline).getTime() : Number.POSITIVE_INFINITY;
          return da - db;
        })
        .map(mapAssignmentRow);
    }
    const db = getDb();
    const rows =
      courseMoodleId !== undefined
        ? db.getAllSync<any>(
            `SELECT * FROM assignments WHERE course_moodle_id = ?
             ORDER BY CASE WHEN deadline IS NULL OR deadline = '' THEN 1 ELSE 0 END, deadline ASC`,
            [courseMoodleId]
          )
        : db.getAllSync<any>(
            `SELECT * FROM assignments
             ORDER BY CASE WHEN deadline IS NULL OR deadline = '' THEN 1 ELSE 0 END, deadline ASC`
          );
    return rows.map(mapAssignmentRow);
  } catch (e) {
    console.error('getAssignments error:', e);
    return [];
  }
}

export function getFiles(courseMoodleId?: number): CourseFile[] {
  try {
    if (isMemoryFallbackActive()) {
      const rows =
        courseMoodleId !== undefined
          ? memTables.files.filter((f) => f.course_moodle_id === courseMoodleId)
          : memTables.files;
      return rows.map(mapFileRow);
    }
    const db = getDb();
    const rows =
      courseMoodleId !== undefined
        ? db.getAllSync<any>('SELECT * FROM files WHERE course_moodle_id = ?', [courseMoodleId])
        : db.getAllSync<any>('SELECT * FROM files');
    return rows.map(mapFileRow);
  } catch (e) {
    console.error('getFiles error:', e);
    return [];
  }
}

export function getMeetings(courseMoodleId?: number): ZoomMeeting[] {
  try {
    if (isMemoryFallbackActive()) {
      const rows =
        courseMoodleId !== undefined
          ? memTables.meetings.filter((m) => m.course_moodle_id === courseMoodleId)
          : memTables.meetings;
      return rows.map(mapMeetingRow);
    }
    const db = getDb();
    const rows =
      courseMoodleId !== undefined
        ? db.getAllSync<any>('SELECT * FROM meetings WHERE course_moodle_id = ? ORDER BY id ASC', [courseMoodleId])
        : db.getAllSync<any>('SELECT * FROM meetings ORDER BY id ASC');
    return rows.map(mapMeetingRow);
  } catch (e) {
    console.error('getMeetings error:', e);
    return [];
  }
}

export function getCourseSections(courseMoodleId?: number): any[] {
  try {
    let rows: any[];
    if (isMemoryFallbackActive()) {
      rows = (
        courseMoodleId !== undefined
          ? memTables.course_sections.filter((s) => s.course_moodle_id === courseMoodleId)
          : memTables.course_sections
      ).slice();
      rows.sort((a, b) => (a.course_moodle_id - b.course_moodle_id) || (a.section_number - b.section_number));
    } else {
      const db = getDb();
      rows =
        courseMoodleId !== undefined
          ? db.getAllSync<any>(
              'SELECT * FROM course_sections WHERE course_moodle_id = ? ORDER BY section_number ASC',
              [courseMoodleId]
            )
          : db.getAllSync<any>(
              'SELECT * FROM course_sections ORDER BY course_moodle_id ASC, section_number ASC'
            );
    }
    return rows.map((r) => ({
      ...r,
      courseId: r.course_moodle_id,
      ...(r.source_course_id !== null && r.source_course_id !== undefined
        ? { sourceCourseId: r.source_course_id }
        : {}),
      sectionNumber: r.section_number,
      summaryHtml: r.summary_html ?? undefined,
      parentSectionId: r.parent_section_id ?? null,
      isSubsectionModule: Boolean(r.is_subsection_module),
      sectionUrl: r.section_url || '',
    }));
  } catch (e) {
    console.error('getCourseSections error:', e);
    return [];
  }
}

export function getCourseFolders(courseMoodleId?: number): any[] {
  try {
    let rows: any[];
    if (isMemoryFallbackActive()) {
      rows =
        courseMoodleId !== undefined
          ? memTables.course_folders.filter((f) => f.course_moodle_id === courseMoodleId)
          : memTables.course_folders;
    } else {
      const db = getDb();
      rows =
        courseMoodleId !== undefined
          ? db.getAllSync<any>('SELECT * FROM course_folders WHERE course_moodle_id = ?', [courseMoodleId])
          : db.getAllSync<any>('SELECT * FROM course_folders');
    }
    return rows.map((r) => ({
      ...r,
      instanceId: r.instance_id ?? 0,
      courseId: r.course_moodle_id,
      ...(r.source_course_id !== null && r.source_course_id !== undefined
        ? { sourceCourseId: r.source_course_id }
        : {}),
      courseName: r.course_name || '',
      sectionId: r.section_id ?? 0,
      sectionName: r.section_name || '',
      descriptionHtml: r.description_html ?? undefined,
      moodleUrl: r.moodle_url || '',
      files: safeJsonParse(r.files_json, []),
      totalSize: r.total_size ?? 0,
    }));
  } catch (e) {
    console.error('getCourseFolders error:', e);
    return [];
  }
}

export function getCourseLinks(courseMoodleId?: number): any[] {
  try {
    let rows: any[];
    if (isMemoryFallbackActive()) {
      rows =
        courseMoodleId !== undefined
          ? memTables.course_links.filter((l) => l.course_moodle_id === courseMoodleId)
          : memTables.course_links;
    } else {
      const db = getDb();
      rows =
        courseMoodleId !== undefined
          ? db.getAllSync<any>('SELECT * FROM course_links WHERE course_moodle_id = ?', [courseMoodleId])
          : db.getAllSync<any>('SELECT * FROM course_links');
    }
    return rows.map((r) => ({
      ...r,
      courseId: r.course_moodle_id,
      ...(r.source_course_id !== null && r.source_course_id !== undefined
        ? { sourceCourseId: r.source_course_id }
        : {}),
      courseName: r.course_name || '',
      sectionId: r.section_id ?? 0,
      sectionName: r.section_name || '',
      targetUrl: r.target_url || '',
      moodleUrl: r.moodle_url || '',
      linkKind: r.link_kind || 'external',
    }));
  } catch (e) {
    console.error('getCourseLinks error:', e);
    return [];
  }
}

export function getCourseAnnouncements(courseMoodleId?: number): any[] {
  try {
    let rows: any[];
    if (isMemoryFallbackActive()) {
      rows = (
        courseMoodleId !== undefined
          ? memTables.course_announcements.filter((a) => a.course_id === courseMoodleId)
          : memTables.course_announcements
      )
        .slice()
        .sort((a, b) => a.id - b.id);
    } else {
      const db = getDb();
      rows =
        courseMoodleId !== undefined
          ? db.getAllSync<any>(
              'SELECT * FROM course_announcements WHERE course_id = ? ORDER BY id ASC;',
              [courseMoodleId]
            )
          : db.getAllSync<any>('SELECT * FROM course_announcements ORDER BY id ASC;');
    }
    return rows.map((r) => ({
      ...r,
      courseId: r.course_id,
      moodleUrl: r.moodle_url,
    }));
  } catch (e) {
    console.error('getCourseAnnouncements error:', e);
    return [];
  }
}

export function getRecordings(courseMoodleId?: number): PanoptoRecording[] {
  try {
    if (isMemoryFallbackActive()) {
      const rows =
        courseMoodleId !== undefined
          ? memTables.recordings.filter((r) => r.course_id === courseMoodleId)
          : memTables.recordings;
      return rows.map(mapRecordingRow);
    }
    const db = getDb();
    const rows =
      courseMoodleId !== undefined
        ? db.getAllSync<any>('SELECT * FROM recordings WHERE course_id = ?', [courseMoodleId])
        : db.getAllSync<any>('SELECT * FROM recordings');
    return rows.map(mapRecordingRow);
  } catch (e) {
    console.error('getRecordings error:', e);
    return [];
  }
}

export function getCourseStaffMap(): Record<number, CourseStaffMember[]> {
  try {
    const rows = isMemoryFallbackActive()
      ? memTables.course_staff
      : getDb().getAllSync<any>('SELECT * FROM course_staff');
    const map: Record<number, CourseStaffMember[]> = {};
    for (const r of rows) {
      map[Number(r.course_id)] = safeJsonParse<CourseStaffMember[]>(r.members_json, []);
    }
    return map;
  } catch (e) {
    console.error('getCourseStaffMap error:', e);
    return {};
  }
}

export function getGradeSummaries(): Record<number, CourseGradeSummary> {
  try {
    const rows = isMemoryFallbackActive()
      ? memTables.grade_summaries
      : getDb().getAllSync<any>('SELECT * FROM grade_summaries');
    const map: Record<number, CourseGradeSummary> = {};
    for (const r of rows) {
      const cid = Number(r.course_id);
      map[cid] = {
        courseId: cid,
        courseTotalFormatted: r.course_total_formatted ?? null,
        courseTotalRaw: r.course_total_raw ?? null,
        courseTotalMax: r.course_total_max ?? null,
        hasCourseTotal: Boolean(r.has_course_total),
        items: safeJsonParse(r.items_json, []),
      };
    }
    return map;
  } catch (e) {
    console.error('getGradeSummaries error:', e);
    return {};
  }
}

function getSyncedCourses(): MoodleCourse[] {
  try {
    const rows = isMemoryFallbackActive()
      ? memTables.courses
      : getDb().getAllSync<any>('SELECT * FROM courses');
    return rows.map((r) => ({
      id: r.id,
      courseId: r.course_id || '',
      shortname: r.shortname || '',
      fullname: r.fullname,
      ...(r.idnumber ? { idnumber: r.idnumber } : {}),
      semester: r.semester || 'Other',
      year: r.year || '',
      ...(r.visible !== null && r.visible !== undefined ? { visible: r.visible } : {}),
      ...(r.startdate !== null && r.startdate !== undefined ? { startdate: r.startdate } : {}),
      ...(r.enddate !== null && r.enddate !== undefined ? { enddate: r.enddate } : {}),
      ...(r.summary ? { summary: r.summary } : {}),
      ...(r.courseimage ? { courseimage: r.courseimage } : {}),
      ...(r.base_url ? { baseUrl: r.base_url } : {}),
      ...(r.format ? { format: r.format } : {}),
      ...(r.coursecategory ? { coursecategory: r.coursecategory } : {}),
    }));
  } catch (e) {
    console.error('getSyncedCourses error:', e);
    return [];
  }
}

export function loadSyncResultFromDatabase(): SyncResult {
  const courses = getSyncedCourses();
  const sections: CourseSection[] = getCourseSections().map((s) => ({
    id: s.id,
    courseId: s.courseId,
    ...(s.sourceCourseId !== undefined ? { sourceCourseId: s.sourceCourseId } : {}),
    sectionNumber: s.sectionNumber,
    name: s.name,
    ...(s.summaryHtml ? { summaryHtml: s.summaryHtml } : {}),
    parentSectionId: s.parentSectionId ?? null,
    level: s.level === 1 ? 1 : 0,
    isSubsectionModule: Boolean(s.isSubsectionModule),
    sectionUrl: s.sectionUrl || '',
    visible: Boolean(s.visible),
  }));
  const folders: CourseFolder[] = getCourseFolders().map((f) => ({
    id: f.id,
    instanceId: f.instanceId ?? 0,
    courseId: f.courseId,
    ...(f.sourceCourseId !== undefined ? { sourceCourseId: f.sourceCourseId } : {}),
    courseName: f.courseName || '',
    sectionId: f.sectionId ?? 0,
    sectionName: f.sectionName || '',
    name: f.name,
    ...(f.descriptionHtml ? { descriptionHtml: f.descriptionHtml } : {}),
    moodleUrl: f.moodleUrl || '',
    files: f.files || [],
    totalSize: f.totalSize ?? 0,
  }));
  const links: CourseLink[] = getCourseLinks().map((l) => ({
    id: l.id,
    courseId: l.courseId,
    ...(l.sourceCourseId !== undefined ? { sourceCourseId: l.sourceCourseId } : {}),
    courseName: l.courseName || '',
    sectionId: l.sectionId ?? 0,
    sectionName: l.sectionName || '',
    name: l.name,
    targetUrl: l.targetUrl || '',
    moodleUrl: l.moodleUrl || '',
    linkKind: l.linkKind || 'external',
  }));
  const announcements: CourseAnnouncement[] = getCourseAnnouncements().map((a) => ({
    id: a.id,
    courseId: a.courseId,
    name: a.name,
    moodleUrl: a.moodleUrl,
  }));
  const assignments = getAssignments();
  const files = getFiles();
  const meetings = getMeetings();
  const recordings = getRecordings();
  const courseStaff = getCourseStaffMap();
  const gradeSummaries = getGradeSummaries();
  const errors = safeJsonParse<SyncError[]>(getPreference('last_sync_errors'), []);
  const syncedAt = getPreference('last_synced_at') || '';

  return {
    courses,
    sections,
    folders,
    links,
    announcements,
    gradeSummaries,
    assignments,
    files,
    meetings,
    recordings,
    courseStaff,
    errors,
    syncedAt,
  };
}

export function clearUserTablesOnLogout(): void {
  try {
    if (isMemoryFallbackActive()) {
      (Object.keys(memTables) as (keyof MemTables)[]).forEach((tbl) => {
        memTables[tbl] = [];
      });
      for (const k of Object.keys(memPrefs)) {
        if (!PRESERVED_UI_PREFS.has(k)) {
          deleteMemPref(k);
        }
      }
      const ls = getWebLocalStorage();
      if (ls) {
        try {
          const toDelete: string[] = [];
          for (let i = 0; i < ls.length; i++) {
            const k = ls.key(i);
            if (k && k.startsWith(WEB_PREF_PREFIX)) {
              const prefKey = k.slice(WEB_PREF_PREFIX.length);
              if (!PRESERVED_UI_PREFS.has(prefKey)) {
                toDelete.push(k);
              }
            }
          }
          toDelete.forEach((k) => ls.removeItem(k));
        } catch {
          // Ignore
        }
      }
      return;
    }

    const db = getDb();
    runInTransaction(() => {
      db.execSync(`
        DELETE FROM tracked_courses;
        DELETE FROM courses;
        DELETE FROM assignments;
        DELETE FROM files;
        DELETE FROM meetings;
        DELETE FROM course_sections;
        DELETE FROM course_folders;
        DELETE FROM course_links;
        DELETE FROM course_announcements;
        DELETE FROM recordings;
        DELETE FROM course_staff;
        DELETE FROM grade_summaries;
      `);
      db.runSync(
        `DELETE FROM preferences WHERE key NOT IN ('theme', 'language', 'theme_time_day_start', 'theme_time_day_end')`
      );
    });
  } catch (e) {
    console.error('clearUserTablesOnLogout error:', e);
  }
}
