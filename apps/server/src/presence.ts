/**
 * Presence (SPEC §5, §21): transient session state — where each participant's playhead and selection
 * are. Never written to the project document or the op log; lost on restart by design.
 */
import { EventEmitter } from 'node:events';

export interface PresenceEntry { sessionId: string; actor: string; kind: 'user' | 'agent'; frame: number | null; selection: string[]; label: string | null; at: string }
const TTL_MS = 30_000;

export class Presence {
  readonly events = new EventEmitter();
  private byProject = new Map<string, Map<string, PresenceEntry & { expires: number }>>();

  update(projectId: string, entry: Omit<PresenceEntry, 'at'>): PresenceEntry {
    let m = this.byProject.get(projectId);
    if (!m) this.byProject.set(projectId, (m = new Map()));
    const key = `${entry.actor}\u0000${entry.sessionId}`;
    const prev = m.get(key);
    const next = { ...entry, frame: entry.frame ?? prev?.frame ?? null, at: new Date().toISOString(), expires: Date.now() + TTL_MS };
    m.set(key, next);
    const { expires: _e, ...pub } = next;
    this.events.emit('presence', { projectId, ...pub });
    return pub;
  }
  leave(projectId: string, actor: string, sessionId: string) {
    if (this.byProject.get(projectId)?.delete(`${actor}\u0000${sessionId}`)) this.events.emit('presence', { projectId, sessionId, actor, gone: true });
  }
  list(projectId: string): PresenceEntry[] {
    const m = this.byProject.get(projectId);
    if (!m) return [];
    const now = Date.now();
    for (const [k, v] of m) if (v.expires < now) m.delete(k);
    return [...m.values()].map(({ expires: _e, ...p }) => p);
  }
}
