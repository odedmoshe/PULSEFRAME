/** The server mode's type alone (autonomy.ts holds the rest), so config.ts imports nothing heavier. */
export const SERVER_MODES = ['open', 'guarded'] as const;
export type ServerMode = (typeof SERVER_MODES)[number];
export const DEFAULT_SERVER_MODE: ServerMode = 'open';
export const parseMode = (v: unknown): ServerMode | undefined => (v === 'open' || v === 'guarded' ? v : undefined);
