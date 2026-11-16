import { createElement, type ComponentType } from 'react';
import {
  Captions, ClipboardCheck, ClipboardPaste, Columns2, Copy, CopyPlus, Crosshair, Download, Eye, EyeOff, FolderOpen,
  LayoutList, Languages, Lock, LockOpen, Mic, Pause, Pencil, Play, Redo2, Repeat, Scissors, Search, Send,
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

export const IconProjects = wrap(FolderOpen);
export const IconUndo = wrap(Undo2);
export const IconRedo = wrap(Redo2);
export const IconCompare = wrap(Columns2);
export const IconSearch = wrap(Search);
export const IconLanguage = wrap(Languages);
export const IconExport = wrap(Download);
export const IconPrevFrame = wrap(StepBack);
export const IconNextFrame = wrap(StepForward);
export const IconPlay = wrap(Play);
export const IconPause = wrap(Pause);
export const IconLoop = wrap(Repeat);
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
