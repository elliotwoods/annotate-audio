// Snapshot id generation: "{epochMs}-{rand}". The epoch prefix keeps lexical order ==
// chronological; the random suffix avoids collisions within the same millisecond.

import { randomBytes } from 'node:crypto';

export function newSnapId(timestampMs: number): string {
  return `${timestampMs}-${randomBytes(3).toString('hex')}`;
}
