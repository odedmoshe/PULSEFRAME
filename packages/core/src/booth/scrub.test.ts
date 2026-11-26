/**
 * scrubNote and namesInNote (wave 8 booth; verify C4b, decisions L2). The strings are the shapes a Windows laptop really produces:
 * C:\Users\<name>\…, the forward-slash form, folders with spaces, OneDrive - <family> folders, UNC shares, %USERPROFILE%, file URLs.
 * What the scrub does NOT catch is pinned at the end, so a change that starts catching it is seen too.
 */
import { describe, expect, it } from 'vitest';
import { BOOTH_SCRUB_MARK as M, namesInNote, scrubNote } from '../index.ts';

const ctx = { literals: ['dana', 'C:\\Users\\dana', 'DANA-LAPTOP'] };
const clean = (t: string) => scrubNote(t, ctx);
/** No trace of any of these may survive. */
const leaks = (out: string, ...bits: string[]) => bits.filter((b) => out.toLowerCase().includes(b.toLowerCase()));

describe('scrubNote: the literals first (user name, home folder, host name)', () => {
  it('replaces them case-insensitively in both slash directions; a short name only as a whole word', () => {
    expect(clean('Dana heard it on DANA-laptop')).toBe(`${M} heard it on ${M}`);
    expect(clean('see c:/users/DANA/x')).not.toMatch(/dana/i);
    expect(scrubNote('annual ann', { literals: ['ann'] })).toBe(`annual ${M}`);
    expect(scrubNote('x', { literals: ['x'] })).toBe('x'); // one letter is not replaced (it would cut every word)
    expect(scrubNote('בדקה דנה', { literals: ['דנה'] })).toBe(`בדקה ${M}`);
  });
  it('the home folder goes before the user name inside it', () => {
    expect(clean('C:\\Users\\dana\\Videos')).toBe(M);
  });
});

describe('scrubNote: Windows paths', () => {
  const cases: [string, string[]][] = [
    ['בקובץ C:\\Users\\yossi\\Videos\\גן 2026\\נועה.mp4 יש הבהוב', ['yossi', 'נועה', 'Videos', 'גן 2026']],
    ['C:/Users/yossi/Desktop/סרט משפחה/a.mov', ['yossi', 'Desktop', 'סרט משפחה']],
    ['path C:\\Users\\yossi\\OneDrive - Cohen Family\\Pictures\\Camera Roll\\IMG_0001.HEIC', ['yossi', 'Cohen', 'Family', 'Camera Roll', 'IMG_0001']],
    ['ב-D:\\My Videos\\Bar Mitzvah 2025\\clip.mp4', ['My Videos', 'Bar Mitzvah', 'clip']],
    ['e:/library/סבתא רחל/x.wav', ['library', 'סבתא רחל']],
    ['spawn C:\\Users\\yossi\\PULSEFRAME\\.venv\\Scripts\\python.exe ENOENT', ['yossi', 'python', 'PULSEFRAME']],
    ['UNC \\\\FAMILY-NAS\\photos\\Cohen 2024\\a.jpg', ['FAMILY-NAS', 'photos', 'Cohen']],
    ['share //nas.local/home movies/b.mp4', ['nas.local', 'home movies']],
    ['%USERPROFILE%\\OneDrive\\x', ['USERPROFILE', 'OneDrive']],
    ['file:///C:/Users/yossi/a%20b.mp4', ['yossi', 'a%20b']],
  ];
  for (const [input, secrets] of cases) {
    it(input, () => {
      const out = clean(input);
      expect({ out, leaks: leaks(out, ...secrets) }).toEqual({ out, leaks: [] });
      expect(out).toContain(M);
    });
  }
  it('a path takes the rest of its line, not the next line', () => {
    expect(clean('C:\\a b\\c\nשורה שנייה')).toBe(`${M}\nשורה שנייה`);
  });
});

describe('scrubNote: the other patterns', () => {
  const cases: [string, string[]][] = [
    ['/home/yossi/videos/a.mp4 and /Users/yossi/Movies', ['yossi']],
    ['~/Videos/x and ~\\Pictures and ~yossi', ['Videos', 'Pictures', 'yossi']],
    ['write to yossi.cohen@gmail.com or יוסי@דוגמה.ישראל', ['yossi', 'gmail', 'יוסי']],
    ['https://photos.google.com/share/AF1Qip and www.cohen-family.co.il/x', ['photos.google', 'AF1Qip', 'cohen-family']],
    ['127.0.0.1:8787 and 192.168.1.23 and 10.0.0.7', ['127.0.0.1', '192.168', '10.0.0.7']],
    ['fe80::1c2b:3cff:fe4d:5e6f%12 and ::1 and 2001:db8:0:0:0:0:2:1', ['fe80', '3cff', '2001:db8']],
    ['phone 050-123-4567, id 012345678, +972 50 123 4567', ['4567', '012345678']],
    ['the file נועה-גן-2026.mp4 and IMG_2231.JPG and Movies/kid.mov', ['נועה-גן', 'IMG_2231', 'kid']],
  ];
  for (const [input, secrets] of cases) {
    it(input, () => {
      const out = clean(input);
      expect({ out, leaks: leaks(out, ...secrets) }).toEqual({ out, leaks: [] });
    });
  }
  it('keeps ordinary words, a date, a time and short numbers', () => {
    const t = 'הבהוב באמצע, 2026-11-27 בשעה 10:30, בתיבה 3 מתוך 8; too loud at 0:12';
    expect(clean(t)).toBe(t);
  });
  it('is idempotent', () => {
    const once = clean('C:\\Users\\yossi\\a.mp4 x@y.z 127.0.0.1');
    expect(clean(once)).toBe(once);
  });
});

describe('scrubNote: what it does NOT catch (pinned so the report can say so)', () => {
  it('names written as words, relative names without a slash or a file ending, a family name alone, a street address, a date of birth', () => {
    for (const t of ['נועה בכתה בסוף', 'the folder Cohen Family', 'רחוב הרצל 12 חולון', 'born 3.4.2019', 'Videos folder', 'קובץ בשם גן נועה']) {
      expect(clean(t)).toBe(t);
    }
  });
});

describe('namesInNote (L2: warn, never replace)', () => {
  const names = ['נועה', 'Ari', 'Ben David'];
  it('finds a name as a whole word, with Hebrew prefixes, case-insensitive, each once', () => {
    expect(namesInNote('ולנועה היה קשה; נועה שוב', names)).toEqual(['נועה']);
    expect(namesInNote('ARI liked it', names)).toEqual(['Ari']);
    expect(namesInNote('with ben david', names)).toEqual(['Ben David']);
    expect(namesInNote('שנועה ראתה', names)).toEqual(['נועה']);
  });
  it('never inside another word', () => {
    expect(namesInNote('Ariel and Safari and נועהלה', names)).toEqual([]);
    expect(namesInNote('', names)).toEqual([]);
    expect(namesInNote('x', [' ', 'x'])).toEqual([]); // a one-letter name is not looked for
  });
});
