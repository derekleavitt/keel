'use client';

import { useCallback, useRef, useTransition } from 'react';

/**
 * Run server-action mutations one at a time.
 *
 * Firing two mutations concurrently can silently drop one. Each completes, each triggers a
 * revalidation, and the later revalidation can render server state that was fetched before
 * the earlier write landed — so the first change reverts with no error anywhere. It looks
 * exactly like a checkbox that un-ticks itself a moment after you click it.
 *
 * Serialising removes the interleaving that causes it: a mutation does not begin until the
 * previous one has settled, so no revalidation can predate a completed write.
 *
 * The cost is that rapid clicks queue rather than overlap, which is the right trade — an
 * optimistic UI already shows the result immediately, so the queue is invisible until
 * something fails, and then it fails in order.
 *
 * `onSettled` runs once after the queue drains rather than after every mutation, so a
 * burst of clicks triggers one refresh instead of several. It is a callback rather than a
 * router import because this package must not depend on the framework — the app passes
 * `router.refresh`.
 *
 * ```tsx
 * const { enqueue, pending } = useSerialMutations({ onSettled: router.refresh });
 *
 * <input
 *   type="checkbox"
 *   onChange={(event) => {
 *     const done = event.target.checked;
 *     enqueue(async () => {
 *       applyOptimistic({ id, done });
 *       return setTodoDoneAction({ id, done });
 *     });
 *   }}
 * />
 * ```
 *
 * See .orchestration/lessons/L-021.md.
 */
export type MutationResult = { ok: boolean; error?: string };

export interface SerialMutations {
  /** Queue a mutation. Resolves with its result once every earlier mutation has settled. */
  enqueue: <T extends MutationResult>(run: () => Promise<T>) => Promise<T>;
  /** True while any mutation is queued or running. */
  pending: boolean;
}

export function useSerialMutations(options: {
  onSettled?: () => void;
  onError?: (message: string) => void;
}): SerialMutations {
  const { onSettled, onError } = options;
  const [pending, startTransition] = useTransition();

  // The tail of the queue: a promise that settles when the previous mutation finishes.
  const tail = useRef<Promise<void>>(Promise.resolve());
  const depth = useRef(0);

  return {
    pending,
    enqueue: useCallback(
      <T extends MutationResult>(run: () => Promise<T>): Promise<T> => {
        depth.current += 1;

        const previous = tail.current;
        let release: () => void = () => undefined;
        tail.current = new Promise<void>((resolve) => {
          release = resolve;
        });

        return new Promise<T>((resolve, reject) => {
          // `run` must execute INSIDE the transition. React 19 requires useOptimistic
          // updates to happen in a transition or action scope, and a queued callback that
          // awaits its turn outside one silently fails to apply — which is exactly the
          // symptom this hook exists to remove.
          startTransition(async () => {
            await previous;
            try {
              const settled = await run();
              if (!settled.ok && settled.error) onError?.(settled.error);
              resolve(settled);
            } catch (error) {
              onError?.(error instanceof Error ? error.message : 'Something went wrong');
              reject(error);
            } finally {
              release();
              depth.current -= 1;
              // Refresh once the queue has drained, not after every mutation — a burst of
              // clicks should cost one round trip, not one per click.
              if (depth.current === 0) onSettled?.();
            }
          });
        });
      },
      [onSettled, onError],
    ),
  };
}
