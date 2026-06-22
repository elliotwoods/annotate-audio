// Content hash of an audio file's bytes — the IndexedDB cache key (spec §8.1 / §13.2).
// Uses SubtleCrypto SHA-256 when available (secure contexts), falling back to a fast
// non-cryptographic 64-bit FNV-1a hash otherwise. Either is fine: we only need a
// stable content-addressed key, not a security guarantee.

export async function hashArrayBuffer(buf: ArrayBuffer): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', buf);
      const bytes = new Uint8Array(digest);
      let hex = '';
      for (const b of bytes) hex += b.toString(16).padStart(2, '0');
      return `sha256-${hex}`;
    } catch {
      // fall through to FNV
    }
  }
  return fnv1a64(new Uint8Array(buf));
}

function fnv1a64(bytes: Uint8Array): string {
  // 64-bit FNV-1a using BigInt for correctness across large buffers.
  const PRIME = 1099511628211n;
  const MASK = (1n << 64n) - 1n;
  let hash = 14695981039346656037n;
  // Sample for very large buffers to keep it fast, but include length to disambiguate.
  const step = bytes.length > 4_000_000 ? Math.ceil(bytes.length / 4_000_000) : 1;
  for (let i = 0; i < bytes.length; i += step) {
    hash = ((hash ^ BigInt(bytes[i])) * PRIME) & MASK;
  }
  hash = ((hash ^ BigInt(bytes.length)) * PRIME) & MASK;
  return `fnv-${hash.toString(16)}-${bytes.length}`;
}
