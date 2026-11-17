import { AudioLines, Droplet, Eraser, Hourglass, Languages, Maximize2, MicOff, Plug, Sparkles, type LucideIcon } from 'lucide-react';

/** The glyph of an AI tool card, by what the tool does (decorative; the card carries the name). */
export function capIcon(id: string, task?: string | null): LucideIcon {
  if (task === 'translate') return Languages;
  if (task === 'voice-clean') return AudioLines;
  if (task === 'vocals-classic') return MicOff;
  if (id.includes('upscale')) return Maximize2;
  if (id.includes('slowmo')) return Hourglass;
  if (id.includes('enhance')) return Sparkles;
  if (id.includes('remove-background')) return Eraser;
  if (id.includes('blur')) return Droplet;
  if (id.includes('smoke')) return Plug;
  return Sparkles;
}
