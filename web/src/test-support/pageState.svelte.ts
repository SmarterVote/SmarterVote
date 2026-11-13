// Test double for `$app/state`'s `page`. Kit 3 removed `$app/stores`; page
// state is now a reactive object, so tests drive it by assigning fields.
export const testPage = $state({
  url: new URL("https://smarter.vote/"),
  params: {} as Record<string, string>,
  route: { id: null as string | null },
  status: 200,
  error: null as { message: string } | null,
  data: {} as Record<string, unknown>,
  state: {} as Record<string, unknown>,
  form: null as unknown,
});
