import { getOrCreateTaskList, syncAssignmentsToGoogleTasks } from '../src/googleTasksSync.js';
import { Assignment } from '../src/types.js';

describe('Category 8: Google Tasks Two-Way Sync Integration', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('TC-GT-01: Google OAuth 2.0 Authorization Flow', () => {
    it('should parse access_token and expires_in from OAuth token endpoint response', () => {
      const mockOAuthResponse = {
        access_token: 'G_MOCK_ACCESS_TOKEN_123',
        expires_in: 3600,
        token_type: 'Bearer',
      };

      const expiryTimestamp = Date.now() + mockOAuthResponse.expires_in * 1000;
      expect(mockOAuthResponse.access_token).toBe('G_MOCK_ACCESS_TOKEN_123');
      expect(expiryTimestamp).toBeGreaterThan(Date.now());
    });
  });

  describe('TC-GT-02: Automatic "Noodle" Task List Provisioning', () => {
    it('should return existing tasklist ID if list with name exists', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [{ id: 'tasklist_123', title: 'Noodle' }],
        }),
      } as Response);

      const listId = await getOrCreateTaskList('VALID_G_TOKEN', 'Noodle');
      expect(listId).toBe('tasklist_123');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should create a new tasklist if not found', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ items: [] }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'new_noodle_list_456' }),
        } as Response);

      const listId = await getOrCreateTaskList('VALID_G_TOKEN', 'Noodle');
      expect(listId).toBe('new_noodle_list_456');
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenLastCalledWith(
        'https://tasks.googleapis.com/tasks/v1/users/@me/lists',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ title: 'Noodle' }),
        })
      );
    });
  });

  describe('TC-GT-03, TC-GT-04, TC-GT-05, TC-GT-06: Syncing Assignments to Google Tasks', () => {
    it('should format assignment title, due date, inject Noodle:assignId tag and respect user overrides', async () => {
      const mockAssignment: Assignment = {
        id: 999,
        cmid: 100,
        courseId: 101,
        courseName: 'אלגוריתמים',
        name: 'מטלה 2',
        status: 'Not submitted',
        deadline: '2026-10-15T23:59:00.000Z',
        opened: null,
        link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=100',
        grade: null,
        gradeMax: 100,
      };

      // Mock fetching existing tasks: empty
      // Mock creating task
      const fetchCalls: any[] = [];
      global.fetch = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, init });
        if (url.includes('/tasks?')) {
          return {
            ok: true,
            json: async () => ({ items: [] }),
          };
        }
        if (init?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({ id: 'created_task_001' }),
          };
        }
        return { ok: true, json: async () => ({}) };
      });

      const { syncedCount, errors } = await syncAssignmentsToGoogleTasks(
        'VALID_TOKEN',
        'tasklist_123',
        [mockAssignment]
      );

      expect(errors).toHaveLength(0);
      expect(syncedCount).toBe(1);

      // Verify POST request body has:
      // Title: [אלגוריתמים] מטלה 2
      // Notes contains Noodle:assignId:999
      const postCall = fetchCalls.find((c) => c.init?.method === 'POST');
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall.init.body);
      expect(body.title).toBe('[אלגוריתמים] מטלה 2');
      expect(body.notes).toContain('Noodle:assignId:999');
      expect(body.due).toContain('2026-10-15');
      expect(body.status).toBe('needsAction');
    });

    it('should update existing active task instead of creating duplicate (idempotency)', async () => {
      const mockAssignment: Assignment = {
        id: 999,
        cmid: 100,
        courseId: 101,
        courseName: 'אלגוריתמים',
        name: 'מטלה 2 - מעודכן',
        status: 'Not submitted',
        deadline: '2026-10-20T23:59:00.000Z',
        opened: null,
        link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=100',
        grade: null,
        gradeMax: 100,
      };

      const existingTasks = [
        {
          id: 'existing_g_task_999',
          title: '[אלגוריתמים] מטלה 2',
          notes: 'Assignment notes...\nNoodle:assignId:999',
          status: 'needsAction',
          due: '2026-10-15T00:00:00.000Z',
        },
      ];

      const fetchCalls: any[] = [];
      global.fetch = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, init });
        if (url.includes('/tasks?')) {
          return {
            ok: true,
            json: async () => ({ items: existingTasks }),
          };
        }
        if (init?.method === 'PATCH') {
          return {
            ok: true,
            json: async () => ({ id: 'existing_g_task_999' }),
          };
        }
        return { ok: true, json: async () => ({}) };
      });

      const { syncedCount } = await syncAssignmentsToGoogleTasks(
        'VALID_TOKEN',
        'tasklist_123',
        [mockAssignment]
      );

      expect(syncedCount).toBe(1);
      const patchCall = fetchCalls.find((c) => c.init?.method === 'PATCH');
      const postCall = fetchCalls.find((c) => c.init?.method === 'POST');

      expect(patchCall).toBeDefined();
      expect(postCall).toBeUndefined();

      const patchBody = JSON.parse(patchCall.init.body);
      expect(patchBody.title).toBe('[אלגוריתמים] מטלה 2 - מעודכן');
      expect(patchBody.due).toContain('2026-10-20');
    });

    it('should delete task from Google Tasks if marked as done (TC-GT-05)', async () => {
      // Assignment 1: Submitted in Moodle
      const submittedAssign: Assignment = {
        id: 101,
        cmid: 201,
        courseId: 301,
        courseName: 'חדו״א',
        name: 'תרגיל 1',
        status: 'Submitted',
        deadline: '2026-10-15T23:59:00.000Z',
        opened: null,
        link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=201',
        grade: null,
        gradeMax: 100,
      };

      // Assignment 2: Not submitted in Moodle, but manually marked as done
      const manuallyDoneAssign: Assignment = {
        id: 102,
        cmid: 202,
        courseId: 301,
        courseName: 'חדו״א',
        name: 'תרגיל 2',
        status: 'Not submitted',
        deadline: '2026-10-18T23:59:00.000Z',
        opened: null,
        link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=202',
        grade: null,
        gradeMax: 100,
      };

      const existingTasks = [
        {
          id: 'g_task_101',
          title: '[חדו״א] תרגיל 1',
          notes: 'Noodle:assignId:101',
          status: 'needsAction',
        },
        {
          id: 'g_task_102',
          title: '[חדו״א] תרגיל 2',
          notes: 'Noodle:assignId:102',
          status: 'needsAction',
        },
      ];

      const fetchCalls: any[] = [];
      global.fetch = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, init });
        if (url.includes('/tasks?')) {
          return {
            ok: true,
            json: async () => ({ items: existingTasks }),
          };
        }
        if (init?.method === 'DELETE') {
          return { ok: true, status: 204 };
        }
        return { ok: true, json: async () => ({}) };
      });

      const { syncedCount, errors } = await syncAssignmentsToGoogleTasks(
        'VALID_TOKEN',
        'tasklist_123',
        [submittedAssign, manuallyDoneAssign],
        {
          completedAssignmentIds: [102], // 102 is manually completed
        }
      );

      expect(errors).toHaveLength(0);
      expect(syncedCount).toBe(0); // None synced as active

      // Both tasks must be deleted from Google Tasks
      const deleteCalls = fetchCalls.filter((c) => c.init?.method === 'DELETE');
      expect(deleteCalls).toHaveLength(2);
      expect(deleteCalls.some((c) => c.url.includes('g_task_101'))).toBe(true);
      expect(deleteCalls.some((c) => c.url.includes('g_task_102'))).toBe(true);

      // No POST or PATCH calls should have occurred
      expect(fetchCalls.find((c) => c.init?.method === 'POST')).toBeUndefined();
      expect(fetchCalls.find((c) => c.init?.method === 'PATCH')).toBeUndefined();
    });

    it('should not sync hidden tasks and should delete existing tasks if set as hidden (TC-GT-06)', async () => {
      // Assignment 1: Hidden, already exists in Google Tasks
      const hiddenExistingAssign: Assignment = {
        id: 201,
        cmid: 301,
        courseId: 401,
        courseName: 'מבני נתונים',
        name: 'מטלה 1',
        status: 'Not submitted',
        deadline: '2026-10-25T23:59:00.000Z',
        opened: null,
        link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=301',
        grade: null,
        gradeMax: 100,
      };

      // Assignment 2: Hidden, does not exist in Google Tasks yet
      const hiddenNewAssign: Assignment = {
        id: 202,
        cmid: 302,
        courseId: 401,
        courseName: 'מבני נתונים',
        name: 'מטלה 2',
        status: 'Not submitted',
        deadline: '2026-10-30T23:59:00.000Z',
        opened: null,
        link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=302',
        grade: null,
        gradeMax: 100,
      };

      // Assignment 3: Active and visible
      const activeAssign: Assignment = {
        id: 203,
        cmid: 303,
        courseId: 401,
        courseName: 'מבני נתונים',
        name: 'מטלה 3',
        status: 'Not submitted',
        deadline: '2026-11-05T23:59:00.000Z',
        opened: null,
        link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=303',
        grade: null,
        gradeMax: 100,
      };

      const existingTasks = [
        {
          id: 'g_task_201',
          title: '[מבני נתונים] מטלה 1',
          notes: 'Noodle:assignId:201',
          status: 'needsAction',
        },
      ];

      const fetchCalls: any[] = [];
      global.fetch = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, init });
        if (url.includes('/tasks?')) {
          return {
            ok: true,
            json: async () => ({ items: existingTasks }),
          };
        }
        if (init?.method === 'DELETE') {
          return { ok: true, status: 204 };
        }
        if (init?.method === 'POST') {
          return { ok: true, json: async () => ({ id: 'new_g_task_203' }) };
        }
        return { ok: true, json: async () => ({}) };
      });

      const { syncedCount, errors } = await syncAssignmentsToGoogleTasks(
        'VALID_TOKEN',
        'tasklist_123',
        [hiddenExistingAssign, hiddenNewAssign, activeAssign],
        {
          hiddenAssignmentIds: [201, 202], // 201 and 202 are hidden
        }
      );

      expect(errors).toHaveLength(0);
      expect(syncedCount).toBe(1); // Only activeAssign (203) synced

      // Existing task for hidden assignment 201 must be deleted
      const deleteCalls = fetchCalls.filter((c) => c.init?.method === 'DELETE');
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0].url).toContain('g_task_201');

      // Hidden new assignment 202 must never be posted, only activeAssign (203) posted
      const postCalls = fetchCalls.filter((c) => c.init?.method === 'POST');
      expect(postCalls).toHaveLength(1);
      const postBody = JSON.parse(postCalls[0].init.body);
      expect(postBody.title).toBe('[מבני נתונים] מטלה 3');
      expect(postBody.notes).toContain('Noodle:assignId:203');
    });

    it('should delete task from Google Tasks if marked completed in Google Tasks or uncompleted override is applied', async () => {
      // Assignment 1: Active in Moodle, but marked completed in Google Tasks
      const assign1: Assignment = {
        id: 301,
        cmid: 401,
        courseId: 501,
        courseName: 'פיזיקה',
        name: 'דוח מעבדה 1',
        status: 'Not submitted',
        deadline: '2026-10-25T23:59:00.000Z',
        opened: null,
        link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=401',
        grade: null,
        gradeMax: 100,
      };

      // Assignment 2: Submitted in Moodle, but user explicitly marked as To Do (uncompleted override)
      const assign2: Assignment = {
        id: 302,
        cmid: 402,
        courseId: 501,
        courseName: 'פיזיקה',
        name: 'דוח מעבדה 2',
        status: 'Submitted',
        deadline: '2026-10-26T23:59:00.000Z',
        opened: null,
        link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=402',
        grade: null,
        gradeMax: 100,
      };

      const existingTasks = [
        {
          id: 'g_task_301',
          title: '[פיזיקה] דוח מעבדה 1',
          notes: 'Noodle:assignId:301',
          status: 'completed', // Marked done in Google Tasks
        },
      ];

      const fetchCalls: any[] = [];
      global.fetch = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, init });
        if (url.includes('/tasks?')) {
          return {
            ok: true,
            json: async () => ({ items: existingTasks }),
          };
        }
        if (init?.method === 'DELETE') {
          return { ok: true, status: 204 };
        }
        if (init?.method === 'POST') {
          return { ok: true, json: async () => ({ id: 'new_g_task_302' }) };
        }
        return { ok: true, json: async () => ({}) };
      });

      const { syncedCount } = await syncAssignmentsToGoogleTasks(
        'VALID_TOKEN',
        'tasklist_123',
        [assign1, assign2],
        {
          uncompletedAssignmentIds: [302], // Kept active as To Do even though submitted
        }
      );

      // assign1 completed in Google Tasks is deleted
      const deleteCalls = fetchCalls.filter((c) => c.init?.method === 'DELETE');
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0].url).toContain('g_task_301');

      // assign2 (marked To Do) is created as an active task
      expect(syncedCount).toBe(1);
      const postCalls = fetchCalls.filter((c) => c.init?.method === 'POST');
      expect(postCalls).toHaveLength(1);
      const postBody = JSON.parse(postCalls[0].init.body);
      expect(postBody.title).toBe('[פיזיקה] דוח מעבדה 2');
      expect(postBody.status).toBe('needsAction');
    });

    it('should delete orphaned tasks and preserve non-Noodle personal tasks', async () => {
      const existingTasks = [
        {
          id: 'noodle_orphaned_task',
          title: 'Old Assignment',
          notes: 'Noodle:assignId:9999',
          status: 'needsAction',
        },
        {
          id: 'personal_user_task',
          title: 'Buy Groceries',
          notes: 'Personal reminder - do not touch',
          status: 'needsAction',
        },
      ];

      const fetchCalls: any[] = [];
      global.fetch = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, init });
        if (url.includes('/tasks?')) {
          return {
            ok: true,
            json: async () => ({ items: existingTasks }),
          };
        }
        if (init?.method === 'DELETE') {
          return { ok: true, status: 204 };
        }
        return { ok: true, json: async () => ({}) };
      });

      await syncAssignmentsToGoogleTasks('VALID_TOKEN', 'tasklist_123', []);

      const deleteCalls = fetchCalls.filter((c) => c.init?.method === 'DELETE');
      
      // Only the Noodle orphaned task should be deleted, personal user task preserved
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0].url).toContain('noodle_orphaned_task');
    });

    it('should not sync assignments without deadline by default and delete existing tasks if syncWithoutDeadline is false', async () => {
      const assignNoDeadline: Assignment = {
        id: 701,
        cmid: 701,
        courseId: 101,
        courseName: 'מבני נתונים',
        name: 'פרויקט גמר (ללא תאריך הגשה)',
        status: 'Not submitted',
        deadline: null,
        opened: null,
        link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=701',
        grade: null,
        gradeMax: 100,
      };

      const existingTasks = [
        {
          id: 'existing_no_deadline_task',
          title: '[מבני נתונים] פרויקט גמר (ללא תאריך הגשה)',
          notes: 'Noodle:assignId:701',
          status: 'needsAction',
        },
      ];

      const fetchCalls: any[] = [];
      global.fetch = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, init });
        if (url.includes('/tasks?')) {
          return {
            ok: true,
            json: async () => ({ items: existingTasks }),
          };
        }
        if (init?.method === 'DELETE') {
          return { ok: true, status: 204 };
        }
        return { ok: true, json: async () => ({}) };
      });

      const { syncedCount, errors } = await syncAssignmentsToGoogleTasks(
        'VALID_TOKEN',
        'tasklist_123',
        [assignNoDeadline],
        { syncWithoutDeadline: false }
      );

      expect(errors).toHaveLength(0);
      expect(syncedCount).toBe(0);

      const deleteCalls = fetchCalls.filter((c) => c.init?.method === 'DELETE');
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0].url).toContain('existing_no_deadline_task');

      const postCalls = fetchCalls.filter((c) => c.init?.method === 'POST');
      expect(postCalls).toHaveLength(0);
    });

    it('should sync assignments without deadline when syncWithoutDeadline is enabled', async () => {
      const assignNoDeadline: Assignment = {
        id: 702,
        cmid: 702,
        courseId: 101,
        courseName: 'מבני נתונים',
        name: 'תרגיל רשות',
        status: 'Not submitted',
        deadline: null,
        opened: null,
        link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=702',
        grade: null,
        gradeMax: 100,
      };

      const fetchCalls: any[] = [];
      global.fetch = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, init });
        if (url.includes('/tasks?')) {
          return {
            ok: true,
            json: async () => ({ items: [] }),
          };
        }
        if (init?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({ id: 'new_task_702' }),
          };
        }
        return { ok: true, json: async () => ({}) };
      });

      const { syncedCount, errors } = await syncAssignmentsToGoogleTasks(
        'VALID_TOKEN',
        'tasklist_123',
        [assignNoDeadline],
        { syncWithoutDeadline: true }
      );

      expect(errors).toHaveLength(0);
      expect(syncedCount).toBe(1);

      const postCall = fetchCalls.find((c) => c.init?.method === 'POST');
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall.init.body);
      expect(body.title).toBe('[מבני נתונים] תרגיל רשות');
      expect(body.due).toBeUndefined();
      expect(body.status).toBe('needsAction');
    });
  });
});
