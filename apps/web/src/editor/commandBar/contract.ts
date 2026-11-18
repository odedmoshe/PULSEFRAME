/**
 * How the command bar sits inside the palette (ADR-0027; plan §6 "Mount"). LEAD: CommandPalette.tsx and SettingsDialog.tsx
 * mount the bar through these shapes; W3 fills useBarSlot (useBarResult.ts), BarSection, AssistantRow and AssistantSettings
 * and does not change the shapes. The palette keeps ONE listbox and ONE cursor: the bar's option keys come first (the
 * result row 'bar' is active by default, so Enter acts on it), then the ranked commands, the catalogue and the media.
 */
import type { Lang } from '@pulseframe/i18n';

/** What the palette gives the bar. */
export interface BarPaletteHost {
  lang: Lang;
  /** Closes the palette; focus returns to what had it (the header button), as for every palette action. */
  close(): void;
}
/** What the bar gives the palette, for the current query. */
export interface BarPaletteSlot {
  /** The bar's option keys in display order (commandBar.testids.ts BAR_KEYS): [] while the query is empty or the bar shows nothing. The same array object while it does not change (the palette memoises on it). */
  keys: readonly string[];
  /** Enter or a click on one of `keys`. The bar decides (the rendered-plan gate, commitExact, an action) and closes the palette itself when done. */
  activate(key: string): void;
  /** The DOM id the input's aria-describedby names (BAR_DOM_IDS.preview) while a preview is shown, else null. */
  describedBy: string | null;
}
/** useBarSlot(query, host): called once per render of the palette dialog, unconditionally. */
export type UseBarSlot = (query: string, host: BarPaletteHost) => BarPaletteSlot;
export interface BarSectionProps {
  slot: BarPaletteSlot;
  query: string;
  /** The palette's active option key (one cursor over every row). */
  activeKey: string | null;
  onHover(key: string): void;
  /** The palette's option DOM id for a key (the result row: BAR_DOM_IDS.result). */
  optionDomId(key: string): string;
}
export interface AssistantRowProps { query: string; lang: Lang; optionDomId(key: string): string }
