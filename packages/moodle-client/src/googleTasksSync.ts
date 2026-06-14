import { Assignment } from './types.js';

/**
 * Resolves the Google Tasks list by name, creating it if it doesn't exist.
 * Returns the task list ID.
 */
export async function getOrCreateTaskList(
  accessToken: string,
  listName: string
): Promise<string> {
  try {
    // 1. List existing task lists
    const response = await fetch('https://tasks.googleapis.com/tasks/v1/users/@me/tasklists?maxResults=100', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Google API returned status ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as { items?: Array<{ id: string; title: string }> };
    const items = data.items || [];

    const targetList = items.find(
      (tl) => tl.title.trim().toLowerCase() === listName.trim().toLowerCase()
    );

    if (targetList) {
      return targetList.id;
    }

    // 2. Create the task list if not found
    const createResponse = await fetch('https://tasks.googleapis.com/tasks/v1/users/@me/tasklists', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: listName }),
    });

    if (!createResponse.ok) {
      throw new Error(`Failed to create tasklist: ${createResponse.statusText}`);
    }

    const newList = (await createResponse.json()) as { id: string };
    return newList.id;
  } catch (error: any) {
    console.warn(`Could not resolve tasklist '${listName}': ${error.message}. Falling back to @default.`);
    return '@default';
  }
}

interface GoogleTask {
  id: string;
  title: string;
  notes?: string;
  status: 'needsAction' | 'completed';
  due?: string;
}

/**
 * Syncs assignments to the specified Google Tasks list.
 */
export async function syncAssignmentsToGoogleTasks(
  accessToken: string,
  taskListId: string,
  assignments: Assignment[]
): Promise<{ syncedCount: number; errors: string[] }> {
  const errors: string[] = [];
  let syncedCount = 0;

  // 1. Fetch all existing tasks in the list (handle pagination)
  let existingTasks: GoogleTask[] = [];
  try {
    let pageToken: string | undefined = undefined;
    do {
      let url = `https://tasks.googleapis.com/tasks/v1/lists/${taskListId}/tasks?showHidden=true&maxResults=100`;
      if (pageToken) {
        url += `&pageToken=${pageToken}`;
      }
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Google Tasks API returned status ${response.status}`);
      }

      const data = (await response.json()) as { items?: GoogleTask[]; nextPageToken?: string };
      existingTasks.push(...(data.items || []));
      pageToken = data.nextPageToken;
    } while (pageToken);
  } catch (error: any) {
    return {
      syncedCount: 0,
      errors: [`Failed to retrieve existing Google Tasks: ${error.message}`],
    };
  }

  // Helper to extract assignment ID from notes
  const getMoodleAssignIdFromNotes = (notes?: string): number | null => {
    if (!notes) return null;
    const match = notes.match(/tautracker:assignId:(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  };

  // 2. Iterate through assignments and sync
  for (const assign of assignments) {
    try {
      const taskTitle = `[${assign.courseName}] ${assign.name}`;
      const targetStatus = assign.status === 'Submitted' ? 'completed' : 'needsAction';
      
      const notes = `Course: ${assign.courseName}\nLink: ${assign.link}\nSource: Moodle (TauTracker)\ntautracker:assignId:${assign.id}`;

      // Format deadline to Zulu ISO string for Google Tasks due field
      // Google Tasks expects UTC timestamp date. The time portion is discarded.
      let dueIso: string | undefined = undefined;
      if (assign.deadline) {
        dueIso = new Date(assign.deadline).toISOString();
      }

      // Find match
      let matchedTask = existingTasks.find(
        (t) => getMoodleAssignIdFromNotes(t.notes) === assign.id
      );

      // Fallback: match by exact title (migration path/compatibility)
      if (!matchedTask) {
        matchedTask = existingTasks.find(
          (t) => t.title.trim() === taskTitle.trim()
        );
      }

      if (matchedTask) {
        // Update existing task if needed
        const patchBody: Partial<GoogleTask> = {};

        // If manually completed in Google Tasks, don't revert to needsAction
        if (matchedTask.status === 'completed' && targetStatus === 'needsAction') {
          // Keep completed
        } else if (matchedTask.status !== targetStatus) {
          patchBody.status = targetStatus;
        }

        // Compare due dates (just YYYY-MM-DD to avoid time zone/formatting mismatches)
        if (dueIso) {
          const matchedDue = matchedTask.due ? matchedTask.due.substring(0, 10) : '';
          const targetDue = dueIso.substring(0, 10);
          if (matchedDue !== targetDue) {
            patchBody.due = dueIso;
          }
        }

        // Always update notes to contain the stable ID and information if missing or mismatched
        if (!matchedTask.notes || !matchedTask.notes.includes(`tautracker:assignId:${assign.id}`)) {
          patchBody.notes = notes;
        }

        // If there's anything to update
        if (Object.keys(patchBody).length > 0) {
          const updateResponse = await fetch(
            `https://tasks.googleapis.com/tasks/v1/lists/${taskListId}/tasks/${matchedTask.id}`,
            {
              method: 'PATCH',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(patchBody),
            }
          );

          if (!updateResponse.ok) {
            throw new Error(`Failed to update task: ${updateResponse.statusText}`);
          }
        }
      } else {
        // Create new task
        const body: Record<string, any> = {
          title: taskTitle,
          notes: notes,
          status: targetStatus,
        };

        if (dueIso) {
          body.due = dueIso;
        }

        const createResponse = await fetch(
          `https://tasks.googleapis.com/tasks/v1/lists/${taskListId}/tasks`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          }
        );

        if (!createResponse.ok) {
          throw new Error(`Failed to create task: ${createResponse.statusText}`);
        }
      }

      syncedCount++;
    } catch (error: any) {
      errors.push(`Assignment "${assign.name}": ${error.message}`);
    }
  }

  return { syncedCount, errors };
}
