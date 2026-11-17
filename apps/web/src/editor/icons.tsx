import { createElement, type ComponentType, type SVGProps } from 'react';
import {
  Captions, ClipboardCheck, ClipboardPaste, Columns2, Copy, CopyPlus, Crosshair, Download, Eye, EyeOff, FolderOpen,
  AudioWaveform, Clock, LayoutList, Languages, Lock, LockOpen, Mic, Pause, Pencil, Play, Redo2, Repeat, Scissors, Search, Send,
  SlidersHorizontal, StepBack, StepForward, Trash2, Undo2, Volume2, VolumeX, WandSparkles, AudioLines, X,
  type LucideProps,
} from 'lucide-react';
import './icons.css';

/** One place for the editor's icons (lucide-react, ISC). They are decorative: the button keeps its own text or aria-label.
 *  House defaults: 16px, 1.75 stroke, currentColor, hidden from assistive technology. */
function wrap(Icon: ComponentType<LucideProps>) {
  return function PfIcon({ className, ...rest }: LucideProps) {
    return createElement(Icon, { size: 16, strokeWidth: 1.75, 'aria-hidden': 'true', focusable: 'false', ...rest, className: `pf-ico${className ? ` ${className}` : ''}` });
  };
}

/** Icons that must NOT mirror in right-to-left: media direction, time and waveform direction follow the timeline, which is LTR in
 *  every language (UX_REDESIGN §4.16). They carry data-pf-dir="fixed"; a test pins the list. Everything else that points
 *  somewhere mirrors by opting in with the `pf-ico-flip` class (icons.css). */
function fixed(Icon: ComponentType<LucideProps>) {
  return function PfFixedIcon({ className, ...rest }: LucideProps) {
    return createElement(Icon, { size: 16, strokeWidth: 1.75, 'aria-hidden': 'true', focusable: 'false', 'data-pf-dir': 'fixed', ...rest, className: `pf-ico pf-ico-fixed${className ? ` ${className}` : ''}` });
  };
}

export const IconProjects = wrap(FolderOpen);
export const IconUndo = wrap(Undo2);
export const IconRedo = wrap(Redo2);
export const IconCompare = wrap(Columns2);
export const IconSearch = wrap(Search);
export const IconLanguage = wrap(Languages);
export const IconExport = wrap(Download);
export const IconPrevFrame = fixed(StepBack);
export const IconNextFrame = fixed(StepForward);
export const IconPlay = fixed(Play);
export const IconPause = wrap(Pause);
export const IconLoop = wrap(Repeat);
export const IconTimecode = fixed(Clock);
export const IconWaveform = fixed(AudioWaveform);
export const IconSplit = wrap(Scissors);
export const IconDelete = wrap(Trash2);
export const IconDuplicate = wrap(CopyPlus);
export const IconCopy = wrap(Copy);
export const IconPaste = wrap(ClipboardPaste);
export const IconCut = wrap(Scissors);
export const IconRename = wrap(Pencil);
export const IconLock = wrap(Lock);
export const IconUnlock = wrap(LockOpen);
export const IconMute = wrap(VolumeX);
export const IconSound = wrap(Volume2);
export const IconHide = wrap(EyeOff);
export const IconShow = wrap(Eye);
export const IconTarget = wrap(Crosshair);
export const IconClose = wrap(X);
export const IconTabClip = wrap(SlidersHorizontal);
export const IconTabSpeech = wrap(Mic);
export const IconTabCaptions = wrap(Captions);
export const IconTabSound = wrap(AudioLines);
export const IconTabDeliver = wrap(Send);
export const IconTabRecipes = wrap(WandSparkles);
export const IconTabReview = wrap(ClipboardCheck);
export const IconTabAll = wrap(LayoutList);

/** Clip action icons by command id, shared by the edit bar and the clip menu. */
export const BAR_ICON_COMPONENTS: Record<string, ComponentType<LucideProps>> = {
  'edit.split': IconSplit, 'edit.delete': IconDelete, 'edit.duplicate': IconDuplicate, 'edit.copy': IconCopy, 'edit.paste': IconPaste, 'edit.cut': IconCut,
};
export const TAB_ICON_COMPONENTS: Record<string, ComponentType<LucideProps>> = {
  clip: IconTabClip, speech: IconTabSpeech, captions: IconTabCaptions, sound: IconTabSound, deliver: IconTabDeliver, recipes: IconTabRecipes, review: IconTabReview, all: IconTabAll,
};

/* ---- PULSEFRAME glyphs (UX_REDESIGN §3.4): the same 24 grid, 1.75 stroke, round caps and joins as the lucide set, drawn here. ----
 * One path set per glyph so a test can check the grid. `dir` says what happens in right-to-left. */
export interface GlyphSpec { body: string; dir: 'fixed' | 'mirror'; label: string }
export const PF_GLYPHS = {
  logo: { label: 'PULSEFRAME', dir: 'fixed', body: '<rect x="3" y="5" width="18" height="14" rx="3.5"/><path d="M5.5 13.5h2.6l1.5-4.2 2.6 7.2 1.8-4.8 1 1.8H18.5"/>' },
  beatLock: { label: 'Locked to the beat', dir: 'fixed', body: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path d="m9.5 15.3 1.8 1.8 3.2-3.4"/>' },
  mainMagnet: { label: 'Main track magnet', dir: 'fixed', body: '<path d="M6 4.5v7a6 6 0 0 0 12 0v-7"/><path d="M6 8.5h3.5M14.5 8.5H18M9.5 4.5v7a2.5 2.5 0 0 0 5 0v-7"/>' },
  cutPlus: { label: 'Add at the cut', dir: 'fixed', body: '<path d="M8.5 3.5v17"/><path d="M15.5 8.5v7M12 12h7"/>' },
  onBeat: { label: 'On the beat', dir: 'fixed', body: '<path d="M12 4.5 19.5 12 12 19.5 4.5 12z"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>' },
  flashShield: { label: 'Flash safety', dir: 'fixed', body: '<path d="M12 3.5 19 6v5.5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="m12.8 8-3 4.4h4.4l-3 4.4"/>' },
  agentNode: { label: 'Assistant', dir: 'fixed', body: '<circle cx="12" cy="12" r="3"/><circle cx="5" cy="6" r="1.6"/><circle cx="19" cy="6" r="1.6"/><circle cx="12" cy="20" r="1.6"/><path d="m6.3 7.1 3.5 3M17.7 7.1l-3.5 3M12 15v3.4"/>' },
  formatPrism: { label: 'Formats', dir: 'fixed', body: '<rect x="3.5" y="7" width="11" height="10" rx="1.5"/><rect x="16" y="4.5" width="4.5" height="15" rx="1.2"/>' },
  rippleDelete: { label: 'Delete and close the gap', dir: 'mirror', body: '<path d="M4 8h5M4 16h9M15 8h5M17 16h3"/><path d="m11.5 6-2 2 2 2M18 14l-2 2 2 2"/>' },
  keyframeHollow: { label: 'Keyframe, none here', dir: 'fixed', body: '<path d="M12 4.5 19.5 12 12 19.5 4.5 12z"/>' },
  keyframeHalf: { label: 'Keyframe, animated', dir: 'fixed', body: '<path d="M12 4.5 19.5 12 12 19.5 4.5 12z"/><path d="M12 4.5v15L4.5 12z" fill="currentColor"/>' },
  keyframeFull: { label: 'Keyframe at the playhead', dir: 'fixed', body: '<path d="M12 4.5 19.5 12 12 19.5 4.5 12z" fill="currentColor"/>' },
  keyframeGold: { label: 'Keyframe on a beat', dir: 'fixed', body: '<path d="M12 4.5 19.5 12 12 19.5 4.5 12z" fill="currentColor"/><path d="M12 1.8v1.4M12 20.8v1.4M1.8 12h1.4M20.8 12h1.4" stroke-width="1.5"/>' },
} as const satisfies Record<string, GlyphSpec>;
export type GlyphName = keyof typeof PF_GLYPHS;

function glyph(name: GlyphName) {
  const spec: GlyphSpec = PF_GLYPHS[name];
  return function PfGlyph({ className, size = 16, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
    const dir = spec.dir === 'fixed' ? 'pf-ico-fixed' : 'pf-ico-flip';
    return createElement('svg', {
      xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.75,
      strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false', 'data-pf-glyph': name, 'data-pf-dir': spec.dir,
      ...rest, className: `pf-ico ${dir}${className ? ` ${className}` : ''}`, dangerouslySetInnerHTML: { __html: spec.body },
    });
  };
}
export const IconPulseLogo = glyph('logo');
export const IconBeatLock = glyph('beatLock');
export const IconMainMagnet = glyph('mainMagnet');
export const IconCutPlus = glyph('cutPlus');
export const IconOnBeat = glyph('onBeat');
export const IconFlashShield = glyph('flashShield');
export const IconAgentNode = glyph('agentNode');
export const IconFormatPrism = glyph('formatPrism');
export const IconRippleDelete = glyph('rippleDelete');
export const IconKeyframeHollow = glyph('keyframeHollow');
export const IconKeyframeHalf = glyph('keyframeHalf');
export const IconKeyframeFull = glyph('keyframeFull');
export const IconKeyframeGold = glyph('keyframeGold');
export const PF_GLYPH_COMPONENTS: Record<GlyphName, ReturnType<typeof glyph>> = {
  logo: IconPulseLogo, beatLock: IconBeatLock, mainMagnet: IconMainMagnet, cutPlus: IconCutPlus, onBeat: IconOnBeat, flashShield: IconFlashShield, agentNode: IconAgentNode,
  formatPrism: IconFormatPrism, rippleDelete: IconRippleDelete, keyframeHollow: IconKeyframeHollow, keyframeHalf: IconKeyframeHalf, keyframeFull: IconKeyframeFull, keyframeGold: IconKeyframeGold,
};
/** Names (of the exports above) that never mirror. */
export const FIXED_DIRECTION_ICONS = ['IconPlay', 'IconPrevFrame', 'IconNextFrame', 'IconTimecode', 'IconWaveform'] as const;
