const svg = (viewBox, body) => `<svg viewBox="${viewBox}" aria-hidden="true">${body}</svg>`;

export const WEAPON_ICONS = {
  pistol: svg('0 0 100 40', '<path d="M18 8H80V19H73V22H47L42 36H29L33 22H27L18 19Z"/><path class="dk" d="M50 22h8l-2 7h-6z"/>'),
  rifle: svg('0 0 100 40', '<path d="M3 15L22 12H29V8H37V12H70V15H95V20H70V23H62L60 31H53L55 23H48L43 36H35L38 23H30L22 27L3 25Z"/>'),
  shotgun: svg('0 0 100 40', '<path d="M3 17L26 13H60V11H97V17H62V22H44L40 32H32L35 22H26L3 26Z"/><path d="M63 18H86V25H63Z"/>'),
  sniper: svg('0 0 100 40', '<path d="M2 15L23 12H40V9H45V5H71V9H65V12H98V17H57V21H51V28H44V21H37L33 32H25L28 21L2 23Z"/>'),
};

export const ICONS = {
  heart: svg('0 0 32 32', '<path d="M16 28C6 21 2 16 2 10.5 2 6.4 5.2 3 9.2 3c2.7 0 5 1.5 6.8 4 1.8-2.5 4.1-4 6.8-4C26.8 3 30 6.4 30 10.5 30 16 26 21 16 28Z"/><path class="hl" d="M7 9.5c0-2 1.3-3.4 3-3.6"/>'),
  bullet: svg('0 0 16 40', '<path d="M3 16C3 8 8 2 8 2s5 6 5 14v4H3Z" class="tip"/><path d="M2 20H14V37H2Z"/>'),
  clock: svg('0 0 32 32', '<circle cx="16" cy="17" r="12"/><path class="dk" d="M15 9h3v8h6v3h-9Z"/>'),
  skull: svg('0 0 32 32', '<path d="M16 3C8.8 3 4 8 4 14.5c0 4 1.8 6.6 4 8V28h16v-5.5c2.2-1.4 4-4 4-8C28 8 23.2 3 16 3Z"/><circle class="dk" cx="11" cy="15" r="3.4"/><circle class="dk" cx="21" cy="15" r="3.4"/><path class="dk" d="M14.5 22h3l-1.5-3Z"/>'),
  head: svg('0 0 32 32', '<circle cx="16" cy="16" r="12"/><circle class="dk" cx="16" cy="16" r="6"/><circle cx="16" cy="16" r="2.5"/>'),
};
