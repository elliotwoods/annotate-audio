// Lucide icon resolution. Icon NAMES are stored in the data model as kebab-case
// (spec §4 "lucide icon name", e.g. "audio-lines"); lucide-react's `icons` map is
// keyed by PascalCase. This module bridges the two and exposes the searchable name set.

import { icons, type LucideIcon } from 'lucide-react';

const toPascal = (kebab: string): string =>
  kebab
    .split('-')
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');

const toKebab = (pascal: string): string =>
  pascal
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();

/** Resolve a kebab-case icon name to its lucide component (falls back to Circle). */
export function getIcon(name: string): LucideIcon {
  return icons[toPascal(name) as keyof typeof icons] ?? icons.Circle;
}

/** All available icon names, kebab-case, sorted — the icon picker's source list. */
export const ICON_NAMES: string[] = Object.keys(icons).map(toKebab).sort();

export { toPascal as iconNameToPascal };
