/**
 * Rebuild Task Manager
 * 
 * Manages async rebuild tasks with progress tracking.
 * Uses in-memory storage (tasks are lost on restart).
 */

import { v4 as uuidv4 } from "uuid";

export type RebuildTaskStatus = "pending" | "running" | "completed" | "failed";

export type RebuildTask = {
  id: string;
  projectKey: string;
  status: RebuildTaskStatus;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ docId: string; error: string }>;
  startedAt: string;
  finishedAt?: string;
  error?: string;
};

// In-memory task storage (keyed by project to ensure one task per project)
const tasksByProject = new Map<string, RebuildTask>();
const tasksById = new Map<string, RebuildTask>();

// Clean up old completed tasks after 5 minutes
const TASK_RETENTION_MS = 5 * 60 * 1000;

function cleanupOldTasks() {
  const now = Date.now();
  for (const [id, task] of tasksById) {
    if (task.finishedAt) {
      const finishedTime = new Date(task.finishedAt).getTime();
      if (now - finishedTime > TASK_RETENTION_MS) {
        tasksById.delete(id);
        if (tasksByProject.get(task.projectKey)?.id === id) {
          tasksByProject.delete(task.projectKey);
        }
      }
    }
  }
}

// Run cleanup periodically
setInterval(cleanupOldTasks, 60000);

export const rebuildTaskManager = {
  /**
   * Check if a rebuild is already running for a project
   */
  isRunning(projectKey: string): boolean {
    const task = tasksByProject.get(projectKey);
    return task?.status === "pending" || task?.status === "running";
  },

  /**
   * Get active task for a project
   */
  getActiveTask(projectKey: string): RebuildTask | null {
    const task = tasksByProject.get(projectKey);
    if (!task) return null;
    return task;
  },

  /**
   * Get task by ID
   */
  getById(taskId: string): RebuildTask | null {
    return tasksById.get(taskId) || null;
  },

  /**
   * Create a new rebuild task
   */
  create(projectKey: string, totalDocs: number): RebuildTask {
    // Cancel any existing task for this project
    const existing = tasksByProject.get(projectKey);
    if (existing && (existing.status === "pending" || existing.status === "running")) {
      throw new Error("A rebuild is already in progress for this project");
    }

    const task: RebuildTask = {
      id: uuidv4(),
      projectKey,
      status: "pending",
      total: totalDocs,
      processed: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
      startedAt: new Date().toISOString(),
    };

    tasksById.set(task.id, task);
    tasksByProject.set(projectKey, task);

    return task;
  },

  /**
   * Update task progress
   */
  updateProgress(
    taskId: string, 
    update: { 
      processed?: number; 
      succeeded?: number; 
      failed?: number;
      error?: { docId: string; error: string };
    }
  ): void {
    const task = tasksById.get(taskId);
    if (!task) return;

    if (task.status === "pending") {
      task.status = "running";
    }

    if (update.processed !== undefined) {
      task.processed = update.processed;
    }
    if (update.succeeded !== undefined) {
      task.succeeded = update.succeeded;
    }
    if (update.failed !== undefined) {
      task.failed = update.failed;
    }
    if (update.error) {
      task.errors.push(update.error);
    }
  },

  /**
   * Mark task as completed
   */
  complete(taskId: string): void {
    const task = tasksById.get(taskId);
    if (!task) return;

    task.status = "completed";
    task.finishedAt = new Date().toISOString();
  },

  /**
   * Mark task as failed
   */
  fail(taskId: string, error: string): void {
    const task = tasksById.get(taskId);
    if (!task) return;

    task.status = "failed";
    task.error = error;
    task.finishedAt = new Date().toISOString();
  },
};
