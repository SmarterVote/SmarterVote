<script lang="ts">
  import { formatNet } from "$lib/utils/forecast";
  import { oneDecimal, partyClass } from "$lib/utils/forecastPresentation";

  export let label: string;
  export let controlParty: "Democratic" | "Republican" | "Other";
  export let threshold: number;
  export let projectedSeats: Record<string, number>;
  export let totalExpected: number;
  export let expectedSeats: Record<string, number> | undefined;
  export let netChange: Record<string, number>;

  // Joined in script so the template never leaves a stray space before a comma.
  $: expectedSeatsText = expectedSeats
    ? [
        `D ${oneDecimal(expectedSeats.Democratic)}`,
        `R ${oneDecimal(expectedSeats.Republican)}`,
        ...(expectedSeats.Other
          ? [`Other ${oneDecimal(expectedSeats.Other)}`]
          : []),
      ].join(", ")
    : "";
  $: hasOther = Boolean(
    projectedSeats.Other || expectedSeats?.Other || netChange.Other,
  );

  const controlParties: ("Democratic" | "Republican" | "Other")[] = [
    "Democratic",
    "Republican",
    "Other",
  ];
</script>

<!-- Projection Summary Stat Card -->
<div class="card p-4 sm:p-6">
  <p class="eyebrow text-content-subtle">
    {label} Projected Seats
  </p>

  <h3 class="mt-2 text-2xl font-bold text-content flex items-baseline gap-2">
    <span class={partyClass(controlParty)}>
      {controlParty === "Other"
        ? "No Clear Control"
        : `${controlParty} Control`}
    </span>
  </h3>

  <p class="mt-1 text-xs text-content-subtle font-medium">
    {threshold} seats needed for majority
  </p>

  <!-- Seat Distribution Bar Chart -->
  <div class="mt-6 space-y-1.5">
    <div
      class="flex items-center justify-between text-sm font-bold tabular-nums"
    >
      <span class="text-blue-700 dark:text-blue-300"
        >Democratic {projectedSeats.Democratic ?? 0}</span
      >
      <span class="text-red-700 dark:text-red-300"
        >Republican {projectedSeats.Republican ?? 0}</span
      >
    </div>

    <div
      class="h-6 rounded-full overflow-hidden bg-surface-alt flex border border-stroke/60"
    >
      <div
        class="bg-blue-600 dark:bg-blue-500 transition-all duration-500 flex items-center justify-center text-xs font-bold text-white shadow-inner"
        style={`width: ${Math.min(
          100,
          ((projectedSeats.Democratic ?? 0) / totalExpected) * 100,
        )}%`}
        title="Democratic projected seats"
      >
        {#if (projectedSeats.Democratic ?? 0) > 20}
          {projectedSeats.Democratic}
        {/if}
      </div>
      {#if projectedSeats.Other}
        <div
          class="bg-slate-400 dark:bg-slate-500 transition-all duration-500 flex items-center justify-center text-xs font-bold text-white shadow-inner"
          style={`width: ${Math.min(
            100,
            ((projectedSeats.Other ?? 0) / totalExpected) * 100,
          )}%`}
          title="Other (independents and third parties) projected seats"
        >
          {#if (projectedSeats.Other ?? 0) > totalExpected * 0.05}
            {projectedSeats.Other}
          {/if}
        </div>
      {/if}
      <div
        class="bg-red-600 dark:bg-red-500 transition-all duration-500 flex items-center justify-center text-xs font-bold text-white shadow-inner ml-auto"
        style={`width: ${Math.min(
          100,
          ((projectedSeats.Republican ?? 0) / totalExpected) * 100,
        )}%`}
        title="Republican projected seats"
      >
        {#if (projectedSeats.Republican ?? 0) > 20}
          {projectedSeats.Republican}
        {/if}
      </div>
    </div>

    <div class="flex justify-between text-xs text-content-subtle px-1">
      <span>Total: {totalExpected}</span>
      <span>Majority line: {threshold}</span>
    </div>
    {#if expectedSeats}
      <p class="mt-3 text-xs text-content-subtle">
        Expected seats: {expectedSeatsText}
      </p>
    {/if}
  </div>

  <!-- Net Seats Change Grid -->
  <div class="mt-6 pt-5 border-t border-stroke/40 grid grid-cols-3 gap-3">
    {#each controlParties as party}
      <div
        class="rounded-xl border border-stroke bg-surface-alt/40 px-2 py-2 text-center"
      >
        <div
          class="text-xs font-semibold text-content-subtle"
          title={party === "Other"
            ? "Independents and third-party candidates"
            : undefined}
        >
          {party === "Other" ? "Other*" : party}
        </div>
        <div class={`text-xl font-bold tabular-nums mt-1 ${partyClass(party)}`}>
          {projectedSeats[party] ?? 0}
        </div>
        <div
          class="text-xs text-content-subtle font-semibold tabular-nums mt-0.5"
        >
          {formatNet(netChange[party] ?? 0)} net
        </div>
      </div>
    {/each}
  </div>
  <p class="mt-3 text-xs text-content-subtle">
    * Other counts independents and third-party candidates{hasOther
      ? ""
      : "; none are projected to win"}.
  </p>
</div>
