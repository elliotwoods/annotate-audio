// Audio blob storage helpers. Blobs live at audio/{hash}, deduplicated across projects.

export function audioKey(hash: string): string {
  return `audio/${hash}`;
}

/**
 * Guard the hash before using it in an object key (prevents path traversal / junk keys).
 * The app hashes audio content to lowercase hex SHA-256, but accept any url-safe token of
 * a sane length for forward-compatibility.
 */
export function isValidHash(hash: string): boolean {
  return typeof hash === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(hash);
}
