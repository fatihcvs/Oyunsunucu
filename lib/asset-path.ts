/**
 * Resolves a request path to a file inside the build output.
 *
 * Kept separate from the server so the traversal rules can be tested without
 * opening a socket. Every rejection returns null rather than throwing: a
 * malformed path is a 404, never a 500.
 */
export type AssetPathResolver = {
  root: string;
  separator: string;
  join: (...parts: string[]) => string;
  normalize: (value: string) => string;
};

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

export function resolveAssetPath(pathname: string, resolver: AssetPathResolver) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // `%` without valid hex digits is a client error, not a server error.
    return null;
  }

  // A NUL byte can truncate the path inside the filesystem layer, so a request
  // for `app.css` plus NUL plus `.png` would read something else entirely.
  if (hasControlCharacter(decoded)) return null;

  const candidate = resolver.normalize(resolver.join(resolver.root, decoded));
  if (!candidate.startsWith(resolver.root)) return null;
  if (candidate.endsWith(resolver.separator)) return null;

  return candidate;
}
