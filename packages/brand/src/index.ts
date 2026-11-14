/** Single place for public branding (SPEC §2). Internal ids stay stable if the public name changes. */
export const BRAND = { name: 'PULSEFRAME Studio', shortName: 'PULSEFRAME', internalId: 'pulseframe' } as const;

/** Original mark: a frame whose lower edge breaks into a pulse. Uses currentColor + the accent token. */
export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" role="img" aria-label="${BRAND.name}">
<rect x="3" y="5" width="26" height="22" rx="5" stroke="currentColor" stroke-width="2.2"/>
<path d="M7 18h4.2l2.3-6.2 3.6 10.4 2.6-7 1.5 2.8H25" stroke="var(--pf-accent, #3DE0C8)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

/** Design tokens as data, mirrored by tokens.css. */
export const TOKENS = {
  color: { bg: '#0E1013', surface: '#16191E', surfaceRaised: '#1D2128', border: '#2A2F38', text: '#E8EAEE', textMuted: '#9AA2AE', accent: '#3DE0C8', accent2: '#4CC2FF', accent3: '#9B8CFF', danger: '#FF6B6B', warn: '#F5B84B' },
  radius: { sm: 4, md: 8, lg: 12 },
  space: [0, 4, 8, 12, 16, 24, 32],
} as const;
