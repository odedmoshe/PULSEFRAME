/**
 * «מי בקליפ?» in a library card's ⋯ menu (wave 7 pearls track). BUILDER C builds it: a menu item (role menuitem, id
 * PEARLS_TESTIDS.whoInClip) opening a dialog with a box per person; saving commits ONE add_source_range {assetId, kind: 'presence',
 * people} or update_source_range of the file's presence range (people [] removes it with remove_source_range). The owner's session
 * only: for any other credential the server refuses (human_tag_required) and the dialog says so. MediaLibrary.tsx mounts it while
 * PEARLS_UI_BUILT; `close` closes the card menu.
 */
import type { Asset } from '@pulseframe/core';

export function WhoInClipItem({ asset, close }: { asset: Asset; close: () => void }) {
  void asset; void close;
  return null;
}
