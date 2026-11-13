import {
  constructTable,
  type RowData,
  type Table,
  type TableFeatures,
  type TableOptions,
} from "@tanstack/table-core";
import { derived, type Readable } from "svelte/store";

/**
 * Minimal Svelte store adapter for TanStack Table core (v9). Controlled state
 * is passed through `options.state` and updated by the caller's `on*Change`
 * callbacks; uncontrolled slices stay inside the table.
 */
export function createSvelteTable<
  TFeatures extends TableFeatures,
  TData extends RowData,
>(
  options: Readable<TableOptions<TFeatures, TData>>,
): Readable<Table<TFeatures, TData>> {
  const table = constructTable<TFeatures, TData>(getInitialOptions(options));

  return derived(options, ($options) => {
    table.setOptions((previous) => ({
      ...previous,
      ...$options,
    }));
    return table;
  });
}

function getInitialOptions<
  TFeatures extends TableFeatures,
  TData extends RowData,
>(
  options: Readable<TableOptions<TFeatures, TData>>,
): TableOptions<TFeatures, TData> {
  let initial!: TableOptions<TFeatures, TData>;
  const unsubscribe = options.subscribe((value) => (initial = value));
  unsubscribe();
  return initial;
}
