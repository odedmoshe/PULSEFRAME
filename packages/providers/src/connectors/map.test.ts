/**
 * The pure mappings of map.ts over the research's example answers (sources-research.md A2, read 2026-11-26) and hand-written
 * extmetadata in the shape https://www.mediawiki.org/wiki/API:Imageinfo documents. No service is called.
 */
import { describe, expect, it } from 'vitest';
import { canonicalLink, commonsLicence, creditText, htmlToText, openverseLicence } from './map.ts';

describe('openverseLicence', () => {
  it('maps the CC codes with their version to exact ids, cc0 and pdm to their ids, and keeps anything else verbatim as unknown', () => {
    expect(openverseLicence('by-nc-sa', '3.0', 'https://creativecommons.org/licenses/by-nc-sa/3.0/')).toEqual({ id: 'CC-BY-NC-SA-3.0', name: 'CC BY-NC-SA 3.0', url: 'https://creativecommons.org/licenses/by-nc-sa/3.0/', from: 'item' });
    expect(openverseLicence('by', '4.0', null).id).toBe('CC-BY-4.0');
    expect(openverseLicence('by-nd', '4.0', null).id).toBe('CC-BY-ND-4.0');
    expect(openverseLicence('cc0', '1.0', null)).toMatchObject({ id: 'CC0-1.0', from: 'item' });
    expect(openverseLicence('pdm', '1.0', null)).toMatchObject({ id: 'PDM-1.0' });
    expect(openverseLicence('sampling+', '1.0', null)).toEqual({ id: 'unknown', name: 'sampling+ 1.0', url: null, from: 'item' });
    expect(openverseLicence('by', 'x', null).id).toBe('unknown'); // a version that is not N.N is not guessed
    expect(openverseLicence('', null, null)).toMatchObject({ id: 'unknown', from: 'none' });
    expect(openverseLicence('by', '4.0', 'javascript:alert(1)').url).toBeNull();
  });
});

describe('creditText', () => {
  const wish = '"Wish You Were Here" by The.madpix.project is licensed under CC BY-NC-SA 3.0. To view a copy of this license, visit https://creativecommons.org/licenses/by-nc-sa/3.0/.';
  it('Openverse: the research example attribution verbatim, due', () => {
    expect(creditText('openverse', { title: 'Wish You Were Here', author: 'The.madpix.project', attribution: wish, licenceName: 'CC BY-NC-SA 3.0', pageUrl: null }, 'en')).toEqual({ text: wish, due: true });
  });
  it('Openverse: an attribution over 500 characters is rebuilt keeping the title (cut first), the author and the licence', () => {
    const title = 'T'.repeat(800);
    const r = creditText('openverse', { title, author: 'Ann Author', attribution: `"${title}" by Ann Author is licensed under CC BY 4.0.`, licenceName: 'CC BY 4.0', pageUrl: null }, 'en')!;
    expect(r.text.length).toBeLessThanOrEqual(500);
    expect(r.text).toContain('by Ann Author');
    expect(r.text).toContain('CC BY 4.0');
    expect(r.text.startsWith('"TTT')).toBe(true);
    expect(r.due).toBe(true);
  });
  it('Pixabay: a courtesy line in the asked language, not due; none without a user', () => {
    expect(creditText('pixabay', { title: 'x', author: 'Monika', licenceName: '', pageUrl: null }, 'he')).toEqual({ text: 'Monika מ־Pixabay', due: false });
    expect(creditText('pixabay', { title: 'x', author: 'Monika', licenceName: '', pageUrl: null }, 'en')).toEqual({ text: 'Monika on Pixabay', due: false });
    expect(creditText('pixabay', { title: 'x', author: null, licenceName: '', pageUrl: null }, 'en')).toBeNull();
  });
  it('Commons: author, title, licence and page', () => {
    expect(creditText('wikimedia', { title: 'File:A.jpg', author: 'Ann', licenceName: 'CC BY-SA 4.0', pageUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg' }, 'en'))
      .toEqual({ text: 'Ann, File:A.jpg, CC BY-SA 4.0, https://commons.wikimedia.org/wiki/File:A.jpg', due: true });
  });
});

describe('commonsLicence', () => {
  it('reads the short name, the URL, strips the Artist HTML to text and marks the credit due when AttributionRequired is "true"', () => {
    const r = commonsLicence({
      LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
      Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Ann" title="User:Ann">Ann &amp; Bob</a><script>x</script>' }, AttributionRequired: { value: 'true' },
      UsageTerms: { value: 'Creative Commons Attribution-Share Alike 4.0' },
    });
    expect(r).toMatchObject({ id: 'CC-BY-SA-4.0', name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0', from: 'item', author: 'Ann & Bob x' });
    expect(r.credit).toEqual({ text: 'Ann & Bob x, CC BY-SA 4.0', due: true });
    expect(r.author).not.toMatch(/[<>]/);
  });
  it('CC0 and an unmatched name ("Public domain") stay what they are; nothing stated is from none', () => {
    expect(commonsLicence({ LicenseShortName: { value: 'CC0' }, AttributionRequired: { value: 'false' } })).toMatchObject({ id: 'CC0-1.0', credit: null });
    expect(commonsLicence({ LicenseShortName: { value: 'Public domain' } })).toMatchObject({ id: 'unknown', name: 'Public domain', from: 'item' });
    expect(commonsLicence({})).toMatchObject({ id: 'unknown', name: '', from: 'none', credit: null, author: null });
  });
  it('a CC BY file always gets a due credit even if AttributionRequired is missing (the record must not be weaker than its id)', () => {
    expect(commonsLicence({ LicenseShortName: { value: 'CC BY 2.0' }, Artist: { value: 'Ann' } }).credit).toEqual({ text: 'Ann, CC BY 2.0', due: true });
  });
  it('htmlToText decodes the common entities and never keeps a tag', () => {
    expect(htmlToText('<b>a</b>&nbsp;&lt;b&gt; &#39;q&#39; &#1488;')).toBe("a <b> 'q' א");
  });
});

describe('canonicalLink', () => {
  it('http(s) only', () => {
    for (const bad of ['ftp://x/a.mp4', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url']) expect(() => canonicalLink(bad)).toThrow();
  });
  it('lower-cases the host, drops the fragment, the user info and every query parameter outside the allow-list; the request keeps the query', () => {
    const r = canonicalLink('https://User:pw@CDN.Example.com:8443/v/a.mp4?X-Amz-Signature=abc&token=t#frag');
    expect(r).toEqual({ canonical: 'https://cdn.example.com:8443/v/a.mp4', host: 'cdn.example.com', requestUrl: 'https://User:pw@cdn.example.com:8443/v/a.mp4?X-Amz-Signature=abc&token=t', pageUrl: 'https://cdn.example.com:8443/v/a.mp4' });
    expect(canonicalLink('https://drive.google.com/uc?export=download&id=ABC').canonical).toBe('https://drive.google.com/uc?id=ABC');
  });
  it('Dropbox: dl=0 becomes dl=1 for the request only; pageUrl keeps it out', () => {
    const r = canonicalLink('https://www.dropbox.com/scl/fi/xyz/clip.mp4?rlkey=secret&dl=0');
    expect(r.requestUrl).toBe('https://www.dropbox.com/scl/fi/xyz/clip.mp4?rlkey=secret&dl=1');
    expect(r.pageUrl).toBe('https://www.dropbox.com/scl/fi/xyz/clip.mp4');
    expect(r.pageUrl).not.toMatch(/dl=|rlkey/);
  });
});
