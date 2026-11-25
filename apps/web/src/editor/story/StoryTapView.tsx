/**
 * The tap-along (W3): the «סיפור» tab of the perform workspace, shown while editor state storyDraft exists (PerformView mounts it).
 * Its own TapCapture (perform/capture.ts) on the player's clock; «התחילו» (R) blurs, seeks to the narration's first frame, sets
 * recording and setPerformRecording(true), plays; «התמונה הבאה» on pointerdown, Enter through a synthetic pointer id, digits 1–8;
 * Space stops; «המשיכו מכאן» / «מההתחלה»; the live picture through core storyLiveDocument at most once per animation frame; the
 * review ghost planned in the browser with the plan view's context; «אישור» applies at the plan's revision; the proof hook
 * window.__pfStory only under __pfStoryProof. LEAD PRE-PASS stub: renders nothing until W3 builds it.
 */
export function StoryTapView(_props: { lang: 'he' | 'en'; /** Back to the workspace the owner came from. */ onDone: () => void }) { return null; }
