/**
 * Headshot URL for display. Candidate images are hotlinked; Wikimedia ones
 * point at full-size originals (often 1.5–8 MB) that we render at 20–128 px.
 * Rewrite those to a Wikimedia thumbnail. 250 px is one of Wikimedia's
 * standard thumbnail widths (non-standard widths are rate limited) and covers
 * a 128 px avatar at 2x. Every other host is returned unchanged.
 */
const WIKIMEDIA_ORIGINAL =
  /^https:\/\/upload\.wikimedia\.org\/wikipedia\/(commons|en)\/([0-9a-f])\/([0-9a-f]{2})\/([^/?#]+)$/;

export const AVATAR_THUMB_WIDTH = 250;

export function avatarSrc(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const match = url.match(WIKIMEDIA_ORIGINAL);
  if (!match) return url;
  const [, project, a, ab, file] = match;
  // Vector originals are thumbnailed to PNG.
  const thumbFile = /\.svg$/i.test(file) ? `${file}.png` : file;
  return `https://upload.wikimedia.org/wikipedia/${project}/thumb/${a}/${ab}/${file}/${AVATAR_THUMB_WIDTH}px-${thumbFile}`;
}
