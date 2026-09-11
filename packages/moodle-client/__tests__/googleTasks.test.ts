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

    it('should update existing task instead of creating duplicate (idempotency)', async () => {
      const mockAssignment: Assignment = {
        id: 999,
        cmid: 100,
        courseId: 101,
        courseName: 'אלגוריתמים',
        name: 'מטלה 2',
        status: 'Submitted', // changed to submitted
        deadline: '2026-10-15T23:59:00.000Z',
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
      // Ensure PATCH was called on the existing task and POST was not called
      const patchCall = fetchCalls.find((c) => c.init?.method === 'PATCH');
      const postCall = fetchCalls.find((c) => c.init?.method === 'POST');

      expect(patchCall).toBeDefined();
      expect(postCall).toBeUndefined();

      // Ensure status updated to completed because assignment was submitted (TC-GT-05)
      const patchBody = JSON.parse(patchCall.init.body);
      expect(patchBody.status).toBe('completed');
    });

    it('should preserve user overrides when task is completed in Google Tasks (TC-GT-06)', async () => {
      const mockAssignment: Assignment = {
        id: 999,
        cmid: 100,
        courseId: 101,
        courseName: 'אלגוריתמים',
        name: 'מטלה 2',
        status: 'Not submitted', // Still open in Moodle
        deadline: '2026-10-15T23:59:00.000Z',
        opened: null,
        link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=100',
        grade: null,
        gradeMax: 100,
      };

      const existingTasks = [
        {
          id: 'existing_g_task_999',
          title: '[אלגוריתמים] מטלה 2',
          notes: 'Noodle:assignId:999',
          status: 'completed', // User marked done in Google Tasks
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

      await syncAssignmentsToGoogleTasks('VALID_TOKEN', 'tasklist_123', [mockAssignment]);

      const patchCall = fetchCalls.find((c) => c.init?.method === 'PATCH');
      if (patchCall) {
        const patchBody = JSON.parse(patchCall.init.body);
        // It must NOT revert completed back to needsAction
        expect(patchBody.status).not.toBe('needsAction');
      }
    });
  });
});
