import * as SQLite from 'expo-sqlite';

let dbInstance: SQLite.SQLiteDatabase | null = null;

export function getDb(): SQLite.SQLiteDatabase {
  if (!dbInstance) {
    dbInstance = SQLite.openDatabaseSync('tautracker.db');
    initDb(dbInstance);
  }
  return dbInstance;
}

function initDb(db: SQLite.SQLiteDatabase) {
  db.execSync(`
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

    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      moodle_assign_id INTEGER UNIQUE NOT NULL,
      cmid INTEGER,
      course_moodle_id INTEGER NOT NULL,
      course_name TEXT,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'Assigned',
      deadline TEXT,
      opened TEXT,
      link TEXT,
      grade REAL,
      grade_max REAL,
      last_synced TEXT
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_moodle_id INTEGER NOT NULL,
      course_name TEXT,
      section_name TEXT,
      file_name TEXT NOT NULL,
      file_url TEXT UNIQUE NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      last_synced TEXT
    );

    CREATE TABLE IF NOT EXISTS meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_moodle_id INTEGER NOT NULL,
      course_name TEXT,
      title TEXT,
      meeting_url TEXT UNIQUE NOT NULL,
      section_name TEXT,
      last_synced TEXT
    );

    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

// Preference Helpers
export function getPreference(key: string): string | null {
  try {
    const db = getDb();
    const result = db.getFirstSync<{ value: string }>('SELECT value FROM preferences WHERE key = ?', [key]);
    return result ? result.value : null;
  } catch (e) {
    console.error('getPreference error:', e);
    return null;
  }
}

export function setPreference(key: string, value: string): void {
  try {
    const db = getDb();
    db.runSync('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)', [key, value]);
  } catch (e) {
    console.error('setPreference error:', e);
  }
}

export function removePreference(key: string): void {
  try {
    const db = getDb();
    db.runSync('DELETE FROM preferences WHERE key = ?', [key]);
  } catch (e) {
    console.error('removePreference error:', e);
  }
}

export function saveSyncResultToDatabase(result: any): void {
  try {
    const db = getDb();
    const nowStr = new Date().toISOString();

    db.withTransactionSync(() => {
      // 1. Sync assignments
      for (const a of result.assignments) {
        db.runSync(
          `INSERT OR REPLACE INTO assignments 
          (moodle_assign_id, cmid, course_moodle_id, course_name, name, status, deadline, opened, link, grade, grade_max, last_synced)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [a.id, a.cmid, a.courseId, a.courseName, a.name, a.status, a.deadline, a.opened, a.link, a.grade, a.gradeMax, nowStr]
        );
      }

      // 2. Sync files
      for (const f of result.files) {
        db.runSync(
          `INSERT OR REPLACE INTO files 
          (course_moodle_id, course_name, section_name, file_name, file_url, file_size, mime_type, last_synced)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [f.courseId, f.courseName, f.sectionName, f.fileName, f.fileUrl, f.fileSize, f.mimeType, nowStr]
        );
      }

      // 3. Sync meetings
      for (const m of result.meetings) {
        db.runSync(
          `INSERT OR REPLACE INTO meetings 
          (course_moodle_id, course_name, title, meeting_url, section_name, last_synced)
          VALUES (?, ?, ?, ?, ?, ?)`,
          [m.courseId, m.courseName, m.title, m.meetingUrl, m.sectionName, nowStr]
        );
      }
    });
  } catch (e) {
    console.error('saveSyncResultToDatabase error:', e);
  }
}
