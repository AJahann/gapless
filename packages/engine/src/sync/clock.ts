import type { Clock, ClockTimer } from './types';

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }

  setTimeout(cb: () => void, ms: number): ClockTimer {
    const timer = setTimeout(cb, ms);
    return {
      cancel: () => clearTimeout(timer),
    };
  }
}

interface ScheduledTask {
  id: number;
  dueTime: number;
  cb: () => void;
  cancelled: boolean;
}

export class FakeClock implements Clock {
  private currentTime = 0;
  private nextTaskId = 1;
  private tasks = new Map<number, ScheduledTask>();

  constructor(initialTime = 1000000) {
    this.currentTime = initialTime;
  }

  now(): number {
    return this.currentTime;
  }

  setTimeout(cb: () => void, ms: number): ClockTimer {
    const id = this.nextTaskId;
    this.nextTaskId += 1;
    const task: ScheduledTask = {
      id,
      dueTime: this.currentTime + ms,
      cb,
      cancelled: false,
    };
    this.tasks.set(id, task);

    return {
      cancel: () => {
        task.cancelled = true;
        this.tasks.delete(id);
      },
    };
  }

  advanceTimeBy(ms: number): void {
    const targetTime = this.currentTime + ms;

    while (true) {
      let earliestTask: ScheduledTask | null = null;
      for (const task of this.tasks.values()) {
        if (task.cancelled) continue;
        if (task.dueTime <= targetTime) {
          if (!earliestTask || task.dueTime < earliestTask.dueTime) {
            earliestTask = task;
          }
        }
      }

      if (!earliestTask) {
        break;
      }

      this.currentTime = earliestTask.dueTime;
      this.tasks.delete(earliestTask.id);
      if (!earliestTask.cancelled) {
        earliestTask.cb();
      }
    }

    this.currentTime = targetTime;
  }
}
