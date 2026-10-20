import { Assignment } from './types.js';

/**
 * Resolves the Google Tasks list by name, creating it if it doesn't exist.
 * Returns the task list ID.
 */
export async function getOrCreateTaskList(
  accessToken: string,
  listName: string,
  errorCallback?: (err: string) => void
): Promise<string> {
  try {
    // 1. List existing task lists
    const response = await fetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      let errMsg = `Google API returned status ${response.status}: ${response.statusText}`;
      try {
        const errJson = await response.json() as any;
        if (errJson?.error?.message) {
          errMsg += ` - ${errJson.error.message}`;
        }
      } catch {}
      throw new Error(errMsg);
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
    const createResponse = await fetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: listName }),
    });

    if (!createResponse.ok) {
      let errMsg = `Failed to create tasklist: ${createResponse.statusText}`;
      try {
        const errJson = await createResponse.json() as any;
        if (errJson?.error?.message) {
          errMsg += ` - ${errJson.error.message}`;
        }
      } catch {}
      throw new Error(errMsg);
    }

    const newList = (await createResponse.json()) as { id: string };
    return newList.id;
  } catch (error: any) {
    const errMsg = `Could not resolve tasklist '${listName}': ${error.message}`;
    console.error(errMsg);
    if (errorCallback) {
      errorCallback(errMsg);
    }
    throw new Error(errMsg);
  }
}

interface GoogleTask {
  id: string;
  title: string;
  notes?: string;
  status: 'needsAction' | 'completed';
  due?: string;
  hidden?: boolean;
}

export interface GoogleTasksSyncOptions {
  hiddenAssignmentIds?: number[] | Set<number>;
  completedAssignmentIds?: number[] | Set<number>;
  uncompletedAssignmentIds?: number[] | Set<number>;
  syncWithoutDeadline?: boolean;
}

/**
 * Syncs assignments to the specified Google Tasks list.
 * - Hidden tasks must not be synced to Google Tasks.
 * - If a task is set as hidden or marked as done, it is deleted from Google Tasks.
 */
export async function syncAssignmentsToGoogleTasks(
  accessToken: string,
  taskListId: string,
  assignments: Assignment[],
  options?: GoogleTasksSyncOptions
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
    const match = notes.match(/(?:tautracker|Noodle):assignId:(\d+)/i);
    return match ? parseInt(match[1], 10) : null;
  };

  const hiddenIds = new Set<number>(
    Array.isArray(options?.hiddenAssignmentIds)
      ? options.hiddenAssignmentIds
      : options?.hiddenAssignmentIds instanceof Set
      ? Array.from(options.hiddenAssignmentIds)
      : []
  );

  const completedIds = new Set<number>(
    Array.isArray(options?.completedAssignmentIds)
      ? options.completedAssignmentIds
      : options?.completedAssignmentIds instanceof Set
      ? Array.from(options.completedAssignmentIds)
      : []
  );

  const uncompletedIds = new Set<number>(
    Array.isArray(options?.uncompletedAssignmentIds)
      ? options.uncompletedAssignmentIds
      : options?.uncompletedAssignmentIds instanceof Set
      ? Array.from(options.uncompletedAssignmentIds)
      : []
  );

  // Helper to check if an assignment is considered completed / marked as done
  const isAssignmentDone = (assign: Assignment): boolean => {
    if (uncompletedIds.has(assign.id)) return false;
    if (completedIds.has(assign.id) || assign.isCompleted === true) return true;
    return assign.status === 'Submitted';
  };

  // Helper to check if an assignment is hidden
  const isAssignmentHidden = (assign: Assignment): boolean => {
    return hiddenIds.has(assign.id) || assign.isHidden === true;
  };

  const deletedTaskIds = new Set<string>();
  const CONCURRENCY_LIMIT = 5;

  async function runWithConcurrency<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
    for (let i = 0; i < items.length; i += CONCURRENCY_LIMIT) {
      const chunk = items.slice(i, i + CONCURRENCY_LIMIT);
      await Promise.all(chunk.map((item) => worker(item)));
    }
  }

  // 2. Process assignments with bounded concurrency
  await runWithConcurrency(assignments, async (assign) => {
    try {
      const taskTitle = `[${assign.courseName}] ${assign.name}`;
      const isHidden = isAssignmentHidden(assign);
      const isDone = isAssignmentDone(assign);
      const isExcludedNoDeadline = !options?.syncWithoutDeadline && !assign.deadline;

      // Find all existing tasks that match this assignment (by assignId or title)
      const matchedTasks = existingTasks.filter(
        (t) =>
          !deletedTaskIds.has(t.id) &&
          (getMoodleAssignIdFromNotes(t.notes) === assign.id || t.title.trim() === taskTitle.trim())
      );

      // RULE: Hidden tasks, completed tasks, or tasks without deadline (when syncWithoutDeadline is off) must not be synced.
      // If such a task exists in Google Tasks, delete it!
      if (isHidden || isDone || isExcludedNoDeadline) {
        for (const task of matchedTasks) {
          if (deletedTaskIds.has(task.id)) continue;
          deletedTaskIds.add(task.id);
          try {
            const deleteResponse = await fetch(
              `https://tasks.googleapis.com/tasks/v1/lists/${taskListId}/tasks/${task.id}`,
              {
                method: 'DELETE',
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              }
            );
            if (!deleteResponse.ok && deleteResponse.status !== 404) {
              deletedTaskIds.delete(task.id);
              throw new Error(`Failed to delete task: ${deleteResponse.statusText}`);
            }
          } catch (delErr: any) {
            errors.push(`Failed to delete hidden/completed/no-deadline task "${task.title}": ${delErr.message}`);
          }
        }
        // Do not create or update hidden, completed, or no-deadline tasks
        return;
      }

      // Active assignment (not hidden, not done):
      const notes = `Course: ${assign.courseName}\nLink: ${assign.link}\nSource: Moodle (Noodle)\nNoodle:assignId:${assign.id}`;

      let dueIso: string | undefined = undefined;
      if (assign.deadline) {
        dueIso = new Date(assign.deadline).toISOString();
      }

      const matchedTask = matchedTasks[0];

      if (matchedTask) {
        // If task was marked completed in Google Tasks, delete it as done!
        if (matchedTask.status === 'completed') {
          deletedTaskIds.add(matchedTask.id);
          try {
            const deleteResponse = await fetch(
              `https://tasks.googleapis.com/tasks/v1/lists/${taskListId}/tasks/${matchedTask.id}`,
              {
                method: 'DELETE',
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              }
            );
            if (!deleteResponse.ok && deleteResponse.status !== 404) {
              deletedTaskIds.delete(matchedTask.id);
              throw new Error(`Failed to delete task: ${deleteResponse.statusText}`);
            }
          } catch (delErr: any) {
            errors.push(`Failed to delete completed task "${matchedTask.title}": ${delErr.message}`);
          }
          return;
        }

        // Update active task if needed
        const patchBody: Partial<GoogleTask> = {};
        if (matchedTask.status !== 'needsAction') {
          patchBody.status = 'needsAction';
        }

        if (dueIso) {
          const matchedDue = matchedTask.due ? matchedTask.due.substring(0, 10) : '';
          const targetDue = dueIso.substring(0, 10);
          if (matchedDue !== targetDue) {
            patchBody.due = dueIso;
          }
        }

        if (matchedTask.title.trim() !== taskTitle.trim()) {
          patchBody.title = taskTitle;
        }

        if (
          !matchedTask.notes ||
          (!matchedTask.notes.includes(`Noodle:assignId:${assign.id}`) &&
            !matchedTask.notes.includes(`tautracker:assignId:${assign.id}`))
        ) {
          patchBody.notes = notes;
        }

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
        // Create new active task
        const body: Record<string, any> = {
          title: taskTitle,
          notes: notes,
          status: 'needsAction',
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
  });

  // 3. Delete orphaned tasks or completed tasks in Google Tasks
  const activeAssignIds = new Set(
    assignments
      .filter((a) => !isAssignmentHidden(a) && !isAssignmentDone(a) && (options?.syncWithoutDeadline || !!a.deadline))
      .map((a) => a.id)
  );

  const tasksToDelete = existingTasks.filter((task) => {
    if (deletedTaskIds.has(task.id)) return false;
    const taskId = getMoodleAssignIdFromNotes(task.notes);
    if (taskId === null) return false;
    const isStillActive = activeAssignIds.has(taskId);
    const isCompletedInGoogle = task.status === 'completed';
    const isHiddenInGoogle = task.hidden === true;
    return !isStillActive || isCompletedInGoogle || isHiddenInGoogle;
  });

  await runWithConcurrency(tasksToDelete, async (task) => {
    if (deletedTaskIds.has(task.id)) return;
    deletedTaskIds.add(task.id);
    try {
      const deleteResponse = await fetch(
        `https://tasks.googleapis.com/tasks/v1/lists/${taskListId}/tasks/${task.id}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      if (!deleteResponse.ok && deleteResponse.status !== 404) {
        deletedTaskIds.delete(task.id);
        throw new Error(`Failed to delete orphaned/completed task: ${deleteResponse.statusText}`);
      }
    } catch (error: any) {
      errors.push(`Failed to delete task "${task.title}": ${error.message}`);
    }
  });

  return { syncedCount, errors };
}
