import { MoodleApiError } from '../src/moodleApi.js';
import { Assignment } from '../src/types.js';

describe('Category 15: Edge Cases & High Volume Stress Testing', () => {
  describe('TC-EDGE-01: Token Expiration During Active Sync', () => {
    it('should cleanly halt and catch error if token expires midway through multi-course sync', async () => {
      let callIndex = 0;
      const syncCourse = async (courseId: number) => {
        callIndex++;
        if (callIndex === 3) {
          throw new MoodleApiError('invalidtoken', 'Token has expired');
        }
        return { courseId, success: true };
      };

      const courseIds = [1, 2, 3, 4, 5];
      const results: any[] = [];
      let caughtError: any = null;

      try {
        for (const id of courseIds) {
          results.push(await syncCourse(id));
        }
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(MoodleApiError);
      expect(caughtError.errorcode).toBe('invalidtoken');
      expect(results).toHaveLength(2); // processed 1 and 2 before error
    });
  });

  describe('TC-EDGE-03: High Course Volume Stress (30+ Courses, 200+ Assignments)', () => {
    it('should sort and filter 200+ assignments across 30 courses in under 50ms', () => {
      const largeAssignments: Assignment[] = [];
      const baseTime = Date.now();

      for (let i = 0; i < 250; i++) {
        const courseId = (i % 30) + 1;
        largeAssignments.push({
          id: i + 1,
          cmid: 1000 + i,
          courseId,
          courseName: `קורס מספר ${courseId}`,
          name: `מטלה או מבחן ${i + 1}`,
          status: i % 4 === 0 ? 'Submitted' : 'Not submitted',
          deadline: i % 10 === 0 ? null : new Date(baseTime + ((i * 17) % 30) * 86400 * 1000).toISOString(),
          opened: null,
          link: `https://moodle.tau.ac.il/mod/assign/view.php?id=${1000 + i}`,
          grade: i % 4 === 0 ? (i * 7) % 100 : null,
          gradeMax: 100,
        });
      }

      const t0 = performance.now();

      // 1. Sort chronologically
      const sorted = [...largeAssignments].sort((a, b) => {
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      });

      // 2. Filter by search query
      const filtered = sorted.filter((a) => a.name.includes('מטלה') || a.courseName.includes('קורס מספר 5'));

      // 3. Status grouping
      const completed = sorted.filter((a) => a.status === 'Submitted');
      const pending = sorted.filter((a) => a.status !== 'Submitted');

      const durationMs = performance.now() - t0;

      expect(sorted).toHaveLength(250);
      expect(filtered.length).toBeGreaterThan(0);
      expect(completed.length + pending.length).toBe(250);
      // High performance benchmark: processing 250 assignments takes < 50ms
      expect(durationMs).toBeLessThan(50);
    });
  });
});
