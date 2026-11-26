import { describe, expect, it } from 'vitest';
import { crowdedNext } from './rideRoom.ts';

describe('room for the ride bar', () => {
  it('crowds the toolbar when even the icons-only bar is wider than the room between its ends', () => {
    expect(crowdedNext({ crowded: false, need: 375, room: 444, gained: null })).toBe(false);
    expect(crowdedNext({ crowded: false, need: 520, room: 444, gained: null })).toBe(true);
  });
  it('stays crowded while the room without the gain would not hold it, and lets go when it would (no back and forth)', () => {
    // crowding gained 400 px: 844 of room now, 444 without the gain
    expect(crowdedNext({ crowded: true, need: 520, room: 844, gained: 400 })).toBe(true);
    expect(crowdedNext({ crowded: true, need: 375, room: 844, gained: 400 })).toBe(false); // the selection changed to one clip
    expect(crowdedNext({ crowded: true, need: 520, room: 999, gained: null })).toBe(true); // the gain is not measured yet
  });
});
