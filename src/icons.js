const svg = (viewBox, body) => `<svg viewBox="${viewBox}" aria-hidden="true">${body}</svg>`;

export const WEAPON_ICONS = {
  pistol: svg('0 0 100 40', '<path d="M18 8H80V19H73V22H47L42 36H29L33 22H27L18 19Z"/><path class="dk" d="M50 22h8l-2 7h-6z"/>'),
  rifle: svg('0 0 100 40', '<path d="M3 15L22 12H29V8H37V12H70V15H95V20H70V23H62L60 31H53L55 23H48L43 36H35L38 23H30L22 27L3 25Z"/>'),
  shotgun: svg('0 0 100 40', '<path d="M3 17L26 13H60V11H97V17H62V22H44L40 32H32L35 22H26L3 26Z"/><path d="M63 18H86V25H63Z"/>'),
  sniper: svg('0 0 100 40', '<path d="M2 15L23 12H40V9H45V5H71V9H65V12H98V17H57V21H51V28H44V21H37L33 32H25L28 21L2 23Z"/>'),
  rpg: svg('0 0 100 40', '<path d="M2 9L13 14H24V11H54V14H66V12H71V15L75 15L80 11H88L93 14L99 20L93 26L88 29H80L75 25H71V26H60L58 32H52L53 26H44L40 36H32L35 26H24V25H13L2 31Z"/><path d="M64 14V7H68V14Z"/><path d="M34 11V6H40V11Z"/><path class="dk" d="M79 12h3v16h-3z"/><path class="dk" d="M30 17h2v6h-2zM46 17h2v6h-2z"/>'),
  minigun: svg('0 0 100 40', '<path d="M44 10H97V15H44ZM44 17H97V22H44ZM44 24H97V29H44Z"/><path d="M58 7H63V32H58ZM88 7H93V32H88Z"/><path d="M8 13Q8 8 14 8H42Q48 8 48 14V24Q48 29 42 29H22L17 38H8L12 29Q8 27 8 24Z"/><path d="M15 8V3H41V8H37V6H19V8Z"/><path d="M26 25H47V38H26Z"/><path class="dk" d="M12 14H44V17H12ZM26 29H47V31H26Z"/>'),
  laser: svg('0 0 100 40', '<path d="M2 12L20 14H30Q34 8 40 8H66Q72 8 74 13H84V11H92L97 15V23L92 27H84V25H70L66 27H54L51 33H43L46 26H40L35 36H27L30 26L20 26L2 30Z"/><path d="M44 8V4H56V8Z"/><path class="dk" d="M36 15H70V18H36Z"/><path class="dk" d="M90 16h4v6h-4z"/><path class="dk" d="M8 17h8v8h-8z"/>'),
  knife: svg('0 0 100 40', '<path d="M38 15H76Q86 15 98 21Q86 28 70 28H38Z"/><path d="M33 7H39V33H33Z"/><path d="M4 17Q4 14 7 14H33V27H7Q4 27 4 24Z"/><path class="dk" d="M42 18H72V20H42Z"/><path class="dk" d="M12 14h2v13h-2zM20 14h2v13h-2z"/>'),
  grenade: svg('0 0 40 40', '<path d="M20 11C28 11 32 17 32 24C32 32 27 38 20 38C13 38 8 32 8 24C8 17 12 11 20 11Z"/><path d="M15 12V7H25V12Z"/><path d="M23 6H29L30 18H27Z"/><path fill-rule="evenodd" d="M7 9a5 5 0 1 0 10 0a5 5 0 1 0-10 0ZM9.5 9a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0Z"/><path class="dk" d="M19 12.5H21V37.5H19ZM13.5 14Q9 25 13.5 36.5L15.2 35.6Q11.2 25 15.2 14.8ZM26.5 14Q31 25 26.5 36.5L24.8 35.6Q28.8 25 24.8 14.8ZM9.2 19.5Q20 17.5 30.8 19.5L31.2 21.6Q20 19.6 8.8 21.6ZM8.4 26.5Q20 24.5 31.6 26.5L31.4 28.6Q20 26.6 8.6 28.6Z"/>'),
};

export const ICONS = {
  clock: svg('0 0 32 32', '<circle cx="16" cy="17" r="12"/><path class="dk" d="M15 9h3v8h6v3h-9Z"/>'),
  skull: svg('0 0 32 32', '<path d="M16 3C8.8 3 4 8 4 14.5c0 4 1.8 6.6 4 8V28h16v-5.5c2.2-1.4 4-4 4-8C28 8 23.2 3 16 3Z"/><circle class="dk" cx="11" cy="15" r="3.4"/><circle class="dk" cx="21" cy="15" r="3.4"/><path class="dk" d="M14.5 22h3l-1.5-3Z"/>'),
  head: svg('0 0 32 32', '<circle cx="16" cy="16" r="12"/><circle class="dk" cx="16" cy="16" r="6"/><circle cx="16" cy="16" r="2.5"/>'),
};
