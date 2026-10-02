/**
 * Svelte action for candidate headshots that fall back to initials when the
 * image cannot load.
 *
 * Prerendered pages ship the `<img>` in the HTML, so a failing image (a
 * Wikimedia 429, say) can fire `error` before hydration attaches `on:error`.
 * That event is gone for good and the alt text renders inside the avatar.
 * On mount this action therefore also checks whether the image has already
 * finished loading with no pixels, and reports the failure itself.
 */
export function isBrokenImage(node: HTMLImageElement): boolean {
  return !!node.getAttribute("src") && node.complete && node.naturalWidth === 0;
}

export function headshotFallback(
  node: HTMLImageElement,
  onFail: () => void,
): { update: (next: () => void) => void; destroy: () => void } {
  let callback = onFail;
  const handleError = () => callback();
  node.addEventListener("error", handleError);
  if (isBrokenImage(node)) queueMicrotask(() => callback());
  return {
    update(next) {
      callback = next;
    },
    destroy() {
      node.removeEventListener("error", handleError);
    },
  };
}
