import { TimeoutError } from "./errors.js";

export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  message: string,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const signal =
    parentSignal === undefined
      ? controller.signal
      : AbortSignal.any([parentSignal, controller.signal]);
  const timeout = setTimeout(() => {
    controller.abort(new TimeoutError(message, { timeoutMs }));
  }, timeoutMs);
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () =>
      reject(signal.reason instanceof Error ? signal.reason : new Error("Operacion cancelada"));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([
      aborted,
      Promise.resolve().then(() => {
        signal.throwIfAborted();
        return operation(signal);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
  }
}
