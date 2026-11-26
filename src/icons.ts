// One small icon set, drawn in a single style (24px grid, 1.75px round strokes),
// so every control in the app looks like it belongs to the same family.

const PATHS: Record<string, string> = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  forward: '<path d="M9 5l7 7-7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  settings:
    '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  volume: '<path d="M4 10v4h3l5 4V6L7 10H4z"/><path d="M16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11"/>',
  play: '<path d="M8 5.5v13l10.5-6.5L8 5.5z" fill="currentColor"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="2.5"/>',
  prev: '<path d="M18 6l-8 6 8 6V6z" fill="currentColor"/><path d="M7 6v12"/>',
  next: '<path d="M6 6l8 6-8 6V6z" fill="currentColor"/><path d="M17 6v12"/>',
  repeat: '<path d="M4 12a8 8 0 0113.7-5.7L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 01-13.7 5.7L4 15.5M4 20v-4.5h4.5"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M5 17l4.5-4.5 3.5 3.5 2.5-2.5L20 17"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
};

export type IconName = keyof typeof PATHS;

export function icon(name: string, size = 20): string {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ""}</svg>`;
}
