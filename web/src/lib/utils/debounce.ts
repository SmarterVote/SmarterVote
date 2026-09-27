/**
 * Simple debounce utility to limit the rate at which a function is invoked.
 * `cancel()` drops a pending call, e.g. when the value it would apply is stale.
 */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delay: number,
): ((...args: Args) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout>;
  const debounced = (...args: Args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}
