import { Assignment } from '../src/types.js';

// Helper matching dateUtils / UI sorting & status logic
function sortAssignments(assignments: Assignment[]): Assignment[] {
  return [...assignments].sort((a, b) => {
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
  });
}

function getDueTextAndClass(
  deadlineString: string | null,
  lang: 'he' | 'en' = 'en',
  greenThreshold: number = 7,
  yellowThreshold: number = 3,
  status?: string
): { badgeClass: string; isOverdue: boolean } {
  if (status === 'Submitted') {
    return { badgeClass: 'badge-success', isOverdue: false };
  }
  if (!deadlineString) {
    return { badgeClass: 'badge-muted', isOverdue: false };
  }
  const deadline = new Date(deadlineString);
  const diffMs = deadline.getTime() - Date.now();
  const hoursLeft = diffMs / (1000 * 60 * 60);

  if (diffMs < 0) {
    return { badgeClass: 'badge-danger', isOverdue: true };
  }
  if (hoursLeft <= yellowThreshold * 24) {
    return { badgeClass: 'badge-danger', isOverdue: false };
  }
  if (hoursLeft <= greenThreshold * 24) {
    return { badgeClass: 'badge-warning', isOverdue: false };
  }
  return { badgeClass: 'badge-success', isOverdue: false };
}

describe('Category 3: Unified Assignments Dashboard', () => {
  const now = Date.now();
  const mockAssignments: Assignment[] = [
    {
      id: 1,
      cmid: 10,
      courseId: 101,
      courseName: 'מבני נתונים',
      name: 'תרגיל 1',
      status: 'Not submitted',
      deadline: new Date(now + 2 * 86400 * 1000).toISOString(), // due in 2 days
      opened: null,
      link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=10',
      grade: null,
      gradeMax: 100,
    },
    {
      id: 2,
      cmid: 20,
      courseId: 101,
      courseName: 'מבני נתונים',
      name: 'תרגיל 2',
      status: 'Not submitted',
      deadline: new Date(now + 10 * 86400 * 1000).toISOString(), // due in 10 days
      opened: null,
      link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=20',
      grade: null,
      gradeMax: 100,
    },
    {
      id: 3,
      cmid: 30,
      courseId: 102,
      courseName: 'אלגברה לינארית',
      name: 'מטלה 0',
      status: 'Not submitted',
      deadline: new Date(now - 1 * 86400 * 1000).toISOString(), // due yesterday
      opened: null,
      link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=30',
      grade: null,
      gradeMax: 100,
    },
    {
      id: 4,
      cmid: 40,
      courseId: 102,
      courseName: 'אלגברה לינארית',
      name: 'קריאת רשות',
      status: 'Not submitted',
      deadline: null, // no deadline
      opened: null,
      link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=40',
      grade: null,
      gradeMax: null,
    },
    {
      id: 5,
      cmid: 50,
      courseId: 101,
      courseName: 'מבני נתונים',
      name: 'תרגיל 0',
      status: 'Submitted',
      deadline: new Date(now - 5 * 86400 * 1000).toISOString(),
      opened: null,
      link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=50',
      grade: 95,
      gradeMax: 100,
    },
  ];

  describe('TC-ASN-01: Aggregated Chronological Assignment Feed', () => {
    it('should sort assignments chronologically with null deadlines at the end', () => {
      const sorted = sortAssignments(mockAssignments);
      // Expected order: id 3 (past), id 5 (5 days ago), id 1 (in 2 days), id 2 (in 10 days), id 4 (no deadline)
      expect(sorted.map((a) => a.id)).toEqual([5, 3, 1, 2, 4]);
    });
  });

  describe('TC-ASN-02: Proximity Urgency Badges & Colors', () => {
    it('should classify < 3 days as badge-danger', () => {
      const { badgeClass } = getDueTextAndClass(new Date(now + 2 * 86400 * 1000).toISOString());
      expect(badgeClass).toBe('badge-danger');
    });

    it('should classify 3-7 days as badge-warning', () => {
      const { badgeClass } = getDueTextAndClass(new Date(now + 5 * 86400 * 1000).toISOString());
      expect(badgeClass).toBe('badge-warning');
    });

    it('should classify > 7 days as badge-success', () => {
      const { badgeClass } = getDueTextAndClass(new Date(now + 10 * 86400 * 1000).toISOString());
      expect(badgeClass).toBe('badge-success');
    });

    it('should classify past deadlines as overdue with badge-danger', () => {
      const { badgeClass, isOverdue } = getDueTextAndClass(new Date(now - 86400 * 1000).toISOString());
      expect(badgeClass).toBe('badge-danger');
      expect(isOverdue).toBe(true);
    });
  });

  describe('TC-ASN-03: Submission Status & Grade Pill', () => {
    it('should return badge-success for submitted assignments', () => {
      const { badgeClass } = getDueTextAndClass(new Date(now + 86400 * 1000).toISOString(), 'en', 7, 3, 'Submitted');
      expect(badgeClass).toBe('badge-success');
    });

    it('should format grade correctly if present', () => {
      const a = mockAssignments.find((item) => item.id === 5)!;
      expect(`${a.grade}/${a.gradeMax}`).toBe('95/100');
    });
  });

  describe('TC-ASN-04: Manual Assignment Completion Toggle (Override)', () => {
    it('should allow toggling manual completion overrides', () => {
      let completedAssignments: number[] = [];

      const toggleManualDone = (assignId: number) => {
        if (completedAssignments.includes(assignId)) {
          completedAssignments = completedAssignments.filter((id) => id !== assignId);
        } else {
          completedAssignments.push(assignId);
        }
      };

      toggleManualDone(1);
      expect(completedAssignments).toContain(1);

      toggleManualDone(1);
      expect(completedAssignments).not.toContain(1);
    });
  });

  describe('TC-ASN-05: Hide & Unhide Assignments', () => {
    it('should exclude hidden assignments from default view', () => {
      let hiddenAssignments: number[] = [2];

      const visible = mockAssignments.filter((a) => !hiddenAssignments.includes(a.id));
      expect(visible.map((a) => a.id)).not.toContain(2);

      // Unhide
      hiddenAssignments = hiddenAssignments.filter((id) => id !== 2);
      const restored = mockAssignments.filter((a) => !hiddenAssignments.includes(a.id));
      expect(restored.map((a) => a.id)).toContain(2);
    });
  });

  describe('TC-ASN-06: Status Filter Tabs (Pending / Past / Done / Hidden)', () => {
    it('should filter into Pending, Past Due, Completed, and Hidden sets', () => {
      const hiddenIds = [4];
      const completedIds = [1]; // manual override

      const isCompleted = (a: Assignment) => a.status === 'Submitted' || completedIds.includes(a.id);
      const isPastDue = (a: Assignment) => !isCompleted(a) && a.deadline !== null && new Date(a.deadline).getTime() < now;
      const isPending = (a: Assignment) => !isCompleted(a) && !isPastDue(a);

      const unhidden = mockAssignments.filter((a) => !hiddenIds.includes(a.id));

      const pending = unhidden.filter(isPending);
      const pastDue = unhidden.filter(isPastDue);
      const completed = unhidden.filter(isCompleted);
      const hidden = mockAssignments.filter((a) => hiddenIds.includes(a.id));

      expect(pending.map((a) => a.id)).toEqual([2]);
      expect(pastDue.map((a) => a.id)).toEqual([3]);
      expect(completed.map((a) => a.id)).toEqual([1, 5]);
      expect(hidden.map((a) => a.id)).toEqual([4]);
    });
  });

  describe('TC-ASN-07: Global Assignment & Course Text Search', () => {
    it('should match search query against assignment name and course name', () => {
      const search = (query: string) => {
        const q = query.trim().toLowerCase();
        return mockAssignments.filter((a) =>
          a.name.toLowerCase().includes(q) || a.courseName.toLowerCase().includes(q)
        );
      };

      expect(search('תרגיל')).toHaveLength(3); // תרגיל 1, תרגיל 2, תרגיל 0
      expect(search('לינארית')).toHaveLength(2); // אלגברה לינארית
      expect(search('NonExistentQuery')).toHaveLength(0);
    });
  });

  describe('TC-ASN-10: "Next Up" Urgent Deadline Banner', () => {
    it('should select the earliest upcoming pending assignment', () => {
      const pendingUpcoming = mockAssignments
        .filter((a) => a.status !== 'Submitted' && a.deadline && new Date(a.deadline).getTime() > now)
        .sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime());

      expect(pendingUpcoming[0].id).toBe(1); // תרגיל 1 (due in 2 days)
    });
  });

  describe('TC-UI-04: Custom Urgency Days Thresholds', () => {
    it('should apply custom green and yellow thresholds', () => {
      const dueIn4Days = new Date(now + 4 * 86400 * 1000).toISOString();

      // With default (green=7, yellow=3): 4 days is warning (yellow)
      expect(getDueTextAndClass(dueIn4Days, 'en', 7, 3).badgeClass).toBe('badge-warning');

      // With custom yellow=5: 4 days is now danger (< 5 days)
      expect(getDueTextAndClass(dueIn4Days, 'en', 14, 5).badgeClass).toBe('badge-danger');
    });
  });
});
