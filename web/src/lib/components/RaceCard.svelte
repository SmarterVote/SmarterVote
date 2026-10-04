<script lang="ts">
  import type { RaceSummary } from "$lib/types";
  import { partyAbbr, partyRing } from "$lib/utils/party";
  import { raceShortLabel } from "$lib/utils/forecastPresentation";
  import { formatElectionDate } from "$lib/utils/electionDate";
  import { raceDisplayTitle } from "$lib/utils/raceTitle";
  import {
    candidateInitials,
    neutralCandidateOrder,
  } from "$lib/utils/candidates";
  import { avatarSrc } from "$lib/utils/avatar";
  import { headshotFallback } from "$lib/utils/racePageImage";

  export let race: RaceSummary;

  function formatDate(dateString: string): string {
    return formatElectionDate(dateString, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  /** Office badge text; one calm neutral style for every office. */
  function getOfficeBadge(office: string | null | undefined): string {
    if (!office) return "Race";
    const o = office.toLowerCase();
    if (o.includes("senate")) return "Senate";
    if (o.includes("governor") || o.includes("gubernatorial"))
      return "Governor";
    if (o.includes("house") || o.includes("representative")) return "House";
    if (o.includes("secretary")) return "Sec. of State";
    if (o.includes("attorney")) return "Atty. General";
    // Truncate long office names
    return office.length > 22 ? office.slice(0, 22) + "…" : office;
  }

  $: badge = getOfficeBadge(race.office);
  $: location = raceShortLabel(race);

  $: candidates = neutralCandidateOrder(race.candidates);

  let imageErrors: Set<string> = new Set();
  function handleImageError(name: string) {
    imageErrors = new Set([...imageErrors, name]);
  }
</script>

<a
  href="/races/{race.id}/"
  class="card group flex h-full flex-col overflow-hidden transition-all duration-200 hover:border-primary-400 hover:shadow-md dark:hover:border-primary-500"
>
  <!-- Card header: office + compact location (one row, even for House) -->
  <div class="flex items-center gap-2 px-4 pb-3 pt-4">
    <span
      class="inline-flex items-center rounded-full bg-surface-alt px-2.5 py-0.5 text-xs font-semibold text-content-muted"
    >
      {badge}
    </span>
    {#if location}
      <span
        class="inline-flex items-center rounded-full border border-stroke px-2.5 py-0.5 text-xs font-medium tabular-nums text-content-muted"
        data-testid="race-location"
        title={race.jurisdiction || undefined}
      >
        {location}
      </span>
    {/if}
  </div>

  <!-- Race title -->
  <div class="px-4 pb-3">
    <h3
      class="text-sm font-semibold leading-snug text-content transition-colors line-clamp-2 group-hover:text-primary-700 dark:group-hover:text-primary-300"
    >
      {raceDisplayTitle(race)}
    </h3>
  </div>

  <!-- Candidate avatars + names -->
  <div class="px-4 pb-4">
    <ul class="grid grid-cols-2 gap-3">
      {#each candidates as candidate}
        <li class="flex min-w-0 items-center gap-2">
          <!-- Avatar -->
          <div class="relative flex-shrink-0">
            {#if avatarSrc(candidate.image_url) && !imageErrors.has(candidate.name)}
              <!-- headshotFallback also catches images that failed before
                   hydration, so a broken headshot still shows initials. -->
              <img
                src={avatarSrc(candidate.image_url)}
                alt=""
                class="h-9 w-9 rounded-full object-cover ring-2 {partyRing(
                  candidate.party,
                )}"
                loading="lazy"
                decoding="async"
                referrerpolicy="no-referrer"
                width="36"
                height="36"
                use:headshotFallback={() => handleImageError(candidate.name)}
              />
            {:else}
              <!-- Same initials placeholder as the compare and candidate pages. -->
              <div
                class="flex h-9 w-9 items-center justify-center rounded-full bg-surface-alt text-xs font-bold text-content-muted ring-2 {partyRing(
                  candidate.party,
                )}"
                aria-hidden="true"
              >
                {candidateInitials(candidate.name ?? "") || "?"}
              </div>
            {/if}
          </div>
          <!-- Name + party -->
          <div class="min-w-0">
            <p class="text-xs font-medium leading-4 text-content line-clamp-2">
              {candidate.name}
            </p>
            {#if candidate.party}
              <p class="text-xs text-content-subtle">
                {partyAbbr(candidate.party)}
              </p>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  </div>

  <!-- Footer: date + view race, pinned to the bottom so rows align -->
  <div
    class="mt-auto flex items-center justify-between gap-2 border-t border-stroke px-4 py-2.5 text-xs"
  >
    <span class="text-content-subtle">{formatDate(race.election_date)}</span>
    <span
      class="inline-flex items-center gap-1 font-medium text-primary-700 dark:text-primary-300"
    >
      View race
      <svg
        class="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2.5"
          d="M9 5l7 7-7 7"
        />
      </svg>
    </span>
  </div>
</a>
