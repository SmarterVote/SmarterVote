/** True when the user asked the OS/browser to minimise motion. Safe during SSR. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Svelte transition duration that collapses to 0 under reduced motion. */
export function motionDuration(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}

/** ScrollBehavior honoring reduced motion. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}
