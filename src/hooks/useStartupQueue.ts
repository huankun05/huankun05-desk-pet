import { useCallback, useEffect, useRef } from 'react';

type Task = () => void | (() => void) | Promise<void>;
type Phase = 0 | 1 | 2 | 3;

interface TaskDef {
  phase: Phase;
  label: string;
  run: Task;
}

let taskId = 0;
const tasks: TaskDef[] = [];
let scheduled = false;

function schedule() {
  if (scheduled) return;
  scheduled = true;

  const runPhase = (phase: Phase) => {
    const batch = tasks.filter((t) => t.phase === phase);
    for (const t of batch) {
      const id = taskId++;
      const start = performance.now();
      let cleanup: void | (() => void) | undefined;
      const result = t.run();

      const isPromise = result && typeof result === 'object' && typeof result.then === 'function';
      if (isPromise) {
        (result as Promise<void>).then(
          () =>
            console.debug(
              `[StartupQueue] ${t.label} done (${(performance.now() - start).toFixed(0)}ms)`,
            ),
          (err: unknown) => console.warn(`[StartupQueue] ${t.label} failed:`, err),
        );
      } else if (typeof result === 'function') {
        cleanup = result;
        console.debug(
          `[StartupQueue] ${t.label} scheduled (${(performance.now() - start).toFixed(0)}ms)`,
        );
      } else {
        console.debug(
          `[StartupQueue] ${t.label} done (${(performance.now() - start).toFixed(0)}ms)`,
        );
      }
    }
  };

  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(
      () => {
        runPhase(0);
        setTimeout(() => runPhase(1), 0);
        setTimeout(() => runPhase(2), 0);
        setTimeout(() => runPhase(3), 0);
        tasks.length = 0;
        scheduled = false;
      },
      { timeout: 3000 },
    );
  } else {
    setTimeout(() => {
      runPhase(0);
      setTimeout(() => runPhase(1), 0);
      setTimeout(() => runPhase(2), 0);
      setTimeout(() => runPhase(3), 0);
      tasks.length = 0;
      scheduled = false;
    }, 0);
  }
}

export function useStartupQueue() {
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const add = useCallback((phase: Phase, label: string, run: Task) => {
    if (!mountedRef.current) return;
    tasks.push({ phase, label, run });
    schedule();
  }, []);

  return { add };
}
