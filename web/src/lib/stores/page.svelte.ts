import { page as pageState, type Page } from "$app/state";
import { readable, type Readable } from "svelte/store";

/**
 * Store view of `$app/state`'s `page`, for legacy (non-runes) components.
 *
 * SvelteKit 3 removed `$app/stores`. Its replacement, `page`, is a reactive
 * object, but a legacy `$: x = page.url...` statement only tracks the
 * identifier `page`, not the properties read through it, so it would never
 * re-run on navigation. Wrapping the object in a store keeps `$page.*` in
 * `$:` statements reactive. Components that read `page` only in the template
 * or in event handlers import `$app/state` directly.
 */
export const page: Readable<Page> = {
  // `$app/state` is context-bound during SSR, so read it per subscription (a
  // component's `$page` auto-subscribe runs at init) rather than at import.
  subscribe: (run, invalidate) =>
    readable<Page>(pageSnapshot(), (set) =>
      $effect.root(() => {
        $effect.pre(() => set(pageSnapshot()));
      }),
    ).subscribe(run, invalidate),
};

function pageSnapshot(): Page {
  return {
    url: pageState.url,
    params: pageState.params,
    route: pageState.route,
    status: pageState.status,
    error: pageState.error,
    data: pageState.data,
    state: pageState.state,
    form: pageState.form,
    shallow: pageState.shallow,
  };
}
