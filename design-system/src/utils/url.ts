/**
 * Returns the trimmed URL when it is an absolute http(s) link, otherwise
 * undefined. Every external href in the library goes through this so a
 * `javascript:`/`data:` value in candidate or race data never becomes a link.
 */
export function safeExternalUrl(url: string | null | undefined): string | undefined {
  const trimmed = url?.trim();
  return trimmed && /^https?:\/\/[^\s]+$/i.test(trimmed) ? trimmed : undefined;
}
