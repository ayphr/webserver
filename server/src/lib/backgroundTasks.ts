import { createLogger } from './logger';
import { backgroundTaskFailuresTotal, backgroundTaskRunsTotal, backgroundTaskInFlight } from './metrics';

const log = createLogger('background-task');

export async function runBackgroundTask(
  name: string,
  task: () => Promise<void>,
): Promise<void> {
  backgroundTaskInFlight.inc({ task: name });
  try {
    await task();
    backgroundTaskRunsTotal.inc({ task: name, result: 'success' });
  } catch (error) {
    backgroundTaskFailuresTotal.inc({ task: name });
    backgroundTaskRunsTotal.inc({ task: name, result: 'failure' });
    log.error({ error, task: name }, 'background task failed');
  } finally {
    backgroundTaskInFlight.dec({ task: name });
  }
}

export function scheduleBackgroundTask(
  name: string,
  intervalMs: number,
  task: () => Promise<void>,
): NodeJS.Timeout {
  const timer = setInterval(() => void runBackgroundTask(name, task), intervalMs);
  timer.unref?.();
  return timer;
}
