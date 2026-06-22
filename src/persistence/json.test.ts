import { describe, it, expect } from 'vitest';
import { validateProject } from './json';
import { makeProject } from '../model/defaults';
import type { Project } from '../model/types';

/** A structurally-valid project as plain JSON (what import would parse). */
function validRaw(): Project {
  const p = makeProject('Round Trip');
  return JSON.parse(JSON.stringify({ ...p, updatedAt: 123 }));
}

describe('validateProject', () => {
  it('accepts and round-trips a valid project', () => {
    const raw = validRaw();
    const out = validateProject(raw);
    expect(out.schemaVersion).toBe(1);
    expect(out.name).toBe('Round Trip');
    expect(out.rows.length).toBe(raw.rows.length);
    expect(out.updatedAt).toBe(123);
  });

  it('re-enforces row order invariants (track=0, section=1, cue >= 2)', () => {
    const raw = validRaw();
    // scramble orders: push track/section off the top, duplicate cue orders
    raw.rows = raw.rows.map((r) => {
      if (r.kind === 'track') return { ...r, order: 9 };
      if (r.kind === 'section') return { ...r, order: 7 };
      return { ...r, order: 7 };
    });
    const out = validateProject(raw);
    const track = out.rows.find((r) => r.kind === 'track')!;
    const section = out.rows.find((r) => r.kind === 'section')!;
    const cues = out.rows.filter((r) => r.kind === 'cue');
    expect(track.order).toBe(0);
    expect(section.order).toBe(1);
    cues.forEach((r) => expect(r.order).toBeGreaterThanOrEqual(2));
    expect(new Set(out.rows.map((r) => r.order)).size).toBe(out.rows.length); // unique
  });

  it('rejects a project with two track rows', () => {
    const raw = validRaw();
    raw.rows.push({ ...raw.rows[0], id: 'dup-track' });
    expect(() => validateProject(raw)).toThrow(/track/i);
  });

  it('rejects a block referencing a missing row', () => {
    const raw = validRaw();
    raw.blocks.push({ id: 'b1', rowId: 'nope', start: 0, end: 1, isPoint: false, label: '' });
    expect(() => validateProject(raw)).toThrow(/missing row/i);
  });

  it('rejects missing or unsupported schemaVersion', () => {
    const raw = validRaw() as unknown as Record<string, unknown>;
    delete raw.schemaVersion;
    expect(() => validateProject(raw)).toThrow(/schemaVersion/i);
    expect(() => validateProject({ ...validRaw(), schemaVersion: 2 })).toThrow(/schemaVersion/i);
  });

  it('rejects non-object input', () => {
    expect(() => validateProject(null)).toThrow();
    expect(() => validateProject('nope')).toThrow();
  });
});
