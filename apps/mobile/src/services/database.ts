import * as SQLite from 'expo-sqlite';

let dbInstance: SQLite.SQLiteDatabase | null = null;

export function getDb(): SQLite.SQLiteDatabase {
  if (!dbInstance) {
    dbInstance = SQLite.openDatabaseSync('noodle.db');
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
      last_synced TEXT,
      attachments TEXT
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
      meeting_url TEXT NOT NULL,
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
      course_name TEXT,
      section_id INTEGER,
      section_name TEXT,
      name TEXT NOT NULL,
      target_url TEXT,
      moodle_url TEXT,
      link_kind TEXT
    );  `);

  try {
    const row = db.getFirstSync<{ value: string }>("SELECT value FROM preferences WHERE key = 'migrated_zoom_unique_v2'");
    if (!row) {
      db.execSync('DROP TABLE IF EXISTS meetings;');
      db.execSync(`
        CREATE TABLE IF NOT EXISTS meetings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          course_moodle_id INTEGER NOT NULL,
          course_name TEXT,
          title TEXT,
          meeting_url TEXT NOT NULL,
          section_name TEXT,
          last_synced TEXT,
          start_time TEXT,
          meeting_number TEXT,
          password TEXT
        );
      `);
      db.runSync("INSERT OR REPLACE INTO preferences (key, value) VALUES ('migrated_zoom_unique_v2', '1')");
    }
  } catch (e) {
    // preferences table might not exist yet, or other error
  }

  try {
    db.execSync('ALTER TABLE assignments ADD COLUMN attachments TEXT;');
  } catch (e) {
    // Column might already exist
  }
  
  try {
    db.execSync('ALTER TABLE assignments ADD COLUMN submitted_files TEXT;');
  } catch (e) {
  }

  try {
    db.execSync('ALTER TABLE meetings ADD COLUMN start_time TEXT;');
  } catch (e) {}
  try {
    db.execSync('ALTER TABLE meetings ADD COLUMN meeting_number TEXT;');
  } catch (e) {}
  try {
    db.execSync('ALTER TABLE meetings ADD COLUMN password TEXT;');
  } catch (e) {}
  try { db.execSync('ALTER TABLE files ADD COLUMN section_id INTEGER;'); } catch (e) {}
  try { db.execSync('ALTER TABLE files ADD COLUMN section_number INTEGER;'); } catch (e) {}
  try { db.execSync('ALTER TABLE files ADD COLUMN folder_id INTEGER;'); } catch (e) {}
  try { db.execSync('ALTER TABLE files ADD COLUMN folder_name TEXT;'); } catch (e) {}
  try { db.execSync('ALTER TABLE files ADD COLUMN relative_path TEXT;'); } catch (e) {}
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
          (moodle_assign_id, cmid, course_moodle_id, course_name, name, status, deadline, opened, link, grade, grade_max, last_synced, attachments, submitted_files)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [a.id, a.cmid, a.courseId, a.courseName, a.name, a.status, a.deadline, a.opened, a.link, a.grade, a.gradeMax, nowStr, JSON.stringify(a.attachments || []), JSON.stringify(a.submittedFiles || [])]
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
      const courseIds = Array.from(new Set(result.meetings.map((m: any) => m.courseId))) as number[];
      for (const cid of courseIds) {
        db.runSync('DELETE FROM meetings WHERE course_moodle_id = ?', [cid]);
      }

      for (const m of result.meetings) {
        db.runSync(
          `INSERT OR REPLACE INTO meetings 
          (course_moodle_id, course_name, title, meeting_url, section_name, last_synced, start_time, meeting_number, password)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            m.courseId, 
            m.courseName, 
            m.title, 
            m.meetingUrl, 
            m.sectionName, 
            nowStr, 
            m.startTime || null, 
            m.meetingNumber || null, 
            m.password || null
          ]
        );
      }

      // 4. Sync sections (if present)
      if (Array.isArray(result.sections)) {
        for (const s of result.sections) {
          db.runSync(
            `INSERT OR REPLACE INTO course_sections 
            (id, course_moodle_id, section_number, name, summary_html, parent_section_id, level, is_subsection_module, section_url, visible)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              s.id,
              s.courseId,
              s.sectionNumber,
              s.name,
              s.summaryHtml || null,
              s.parentSectionId !== undefined ? s.parentSectionId : null,
              s.level ?? 0,
              s.isSubsectionModule ? 1 : 0,
              s.sectionUrl || null,
              s.visible ? 1 : 0
            ]
          );
        }
      }

      // 5. Sync folders (if present)
      if (Array.isArray(result.folders)) {
        for (const fld of result.folders) {
          db.runSync(
            `INSERT OR REPLACE INTO course_folders 
            (id, instance_id, course_moodle_id, course_name, section_id, section_name, name, description_html, moodle_url, files_json, total_size)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              fld.id,
              fld.instanceId || null,
              fld.courseId,
              fld.courseName || '',
              fld.sectionId || 0,
              fld.sectionName || '',
              fld.name,
              fld.descriptionHtml || null,
              fld.moodleUrl || null,
              JSON.stringify(fld.files || []),
              fld.totalSize || 0
            ]
          );
        }
      }

      // 6. Sync links (if present)
      if (Array.isArray(result.links)) {
        for (const lnk of result.links) {
          db.runSync(
            `INSERT OR REPLACE INTO course_links 
            (id, course_moodle_id, course_name, section_id, section_name, name, target_url, moodle_url, link_kind)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              lnk.id,
              lnk.courseId,
              lnk.courseName || '',
              lnk.sectionId || 0,
              lnk.sectionName || '',
              lnk.name,
              lnk.targetUrl,
              lnk.moodleUrl || null,
              lnk.linkKind || 'external'
            ]
          );
        }
      }
    });
  } catch (e) {
    console.error('saveSyncResultToDatabase error:', e);
  }
}

export function getCourseSections(courseMoodleId?: number): any[] {
  try {
    const db = getDb();
    if (courseMoodleId !== undefined) {
      return db.getAllSync<any>('SELECT * FROM course_sections WHERE course_moodle_id = ? ORDER BY section_number ASC', [courseMoodleId]);
    }
    return db.getAllSync<any>('SELECT * FROM course_sections ORDER BY course_moodle_id ASC, section_number ASC');
  } catch (e) {
    console.error('getCourseSections error:', e);
    return [];
  }
}

export function getCourseFolders(courseMoodleId?: number): any[] {
  try {
    const db = getDb();
    const rows = courseMoodleId !== undefined
      ? db.getAllSync<any>('SELECT * FROM course_folders WHERE course_moodle_id = ?', [courseMoodleId])
      : db.getAllSync<any>('SELECT * FROM course_folders');
    return rows.map((r) => ({
      ...r,
      files: r.files_json ? JSON.parse(r.files_json) : []
    }));
  } catch (e) {
    console.error('getCourseFolders error:', e);
    return [];
  }
}

export function getCourseLinks(courseMoodleId?: number): any[] {
  try {
    const db = getDb();
    if (courseMoodleId !== undefined) {
      return db.getAllSync<any>('SELECT * FROM course_links WHERE course_moodle_id = ?', [courseMoodleId]);
    }
    return db.getAllSync<any>('SELECT * FROM course_links');
  } catch (e) {
    console.error('getCourseLinks error:', e);
    return [];
  }
}
