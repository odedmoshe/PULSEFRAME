/* The phone upload page (ADR-0023). ES2017 only, no imports, no external request: it talks to the door that served it (same origin).
   Wire: POST /hello {token|pin}, POST /status, POST /upload (Bearer session, x-filename), POST /bye. The first half is pure logic
   (no DOM) and is what dropPage.test.ts runs in node:vm; the second half is the page. */
(function (root) {
  'use strict';

  var STR = {
    he: {
      title: 'העלאה מהטלפון', langBtn: 'English',
      pickMedia: 'בחירת סרטונים ותמונות', pickOriginal: 'סרטונים באיכות מקורית',
      pickHint: 'בחלק מהטלפונים הגלריה מכווצת סרטונים. כדי לשמור על האיכות המקורית, בחרו מ"קבצים".',
      pinLabel: 'הקוד בן 6 הספרות שמופיע במחשב', pinGo: 'התחברות',
      connecting: 'מתחבר למחשב…', connected: 'מחובר למחשב. אפשר לבחור קבצים.', total: '{done} מתוך {all}',
      fWaiting: 'ממתין', fUploading: 'עולה {pct}%', fSaved: 'נשמר במחשב ✓', fFailed: 'נכשל', fRetrying: 'החיבור נקטע, מנסים שוב ({n} מתוך 3)',
      fWaitServer: 'המחשב ביקש להמתין רגע…', fNotSent: 'לא נשלח', retry: 'נסו שוב',
      savedNote: 'הקובץ נשמר במחשב. ההמרה לעריכה ממשיכה שם, אפשר לסגור את הדף כשהכול נשמר.',
      keepOpen: 'השאירו את הדף פתוח והמסך דולק', done: 'סיימתי', closed: 'סיימנו. הקוד נסגר ואפשר לסגור את הדף.',
      announceSaved: '{name} נשמר במחשב', announceFailed: '{name} נכשל: {why}', allDone: 'כל הקבצים נשמרו במחשב',
      'e.invalid_request': 'הבקשה לא תקינה.', 'e.code_invalid': 'הקוד לא נכון. בדקו שהקלדתם את הקוד שמופיע במחשב.',
      'e.code_already_used': 'הקוד כבר נוצל במכשיר אחר. בקשו קוד חדש מהמחשב.', 'e.code_expired': 'הקוד פג. בקשו קוד חדש מהמחשב.',
      'e.rate_limited': 'יותר מדי בקשות. ממתינים רגע.', 'e.session_invalid': 'החיבור למחשב נותק. סרקו שוב את הקוד שבמחשב.',
      'e.code_closed': 'הקוד נסגר במחשב. בקשו קוד חדש.', 'e.length_required': 'הדפדפן לא שלח את גודל הקובץ.',
      'e.upload_too_large': 'הקובץ גדול מדי להעלאה.', 'e.code_budget': 'הקוד הזה הגיע למגבלת ההעלאה שלו. בקשו קוד חדש מהמחשב.',
      'e.storage_quota_exceeded': 'אין עוד מקום באחסון של הפרויקט במחשב.', 'e.disk_full': 'אין מספיק מקום פנוי בדיסק של המחשב.',
      'e.upload_incomplete': 'הקובץ לא הגיע בשלמותו.', 'e.empty_upload': 'הקובץ ריק.', 'e.invalid_filename': 'שם הקובץ לא נקרא כראוי.',
      'e.internal_error': 'תקלה במחשב. אפשר לנסות שוב.',
      'e.network': 'החיבור נקטע. בדקו שהטלפון והמחשב על אותה רשת Wi-Fi.', 'e.unknown': 'משהו השתבש.'
    },
    en: {
      title: 'Upload from the phone', langBtn: 'עברית',
      pickMedia: 'Choose videos and pictures', pickOriginal: 'Videos in original quality',
      pickHint: 'Some phones shrink videos in the gallery. To keep the original quality, choose from "Files".',
      pinLabel: 'The 6-digit code shown on the computer', pinGo: 'Connect',
      connecting: 'Connecting to the computer…', connected: 'Connected to the computer. You can choose files.', total: '{done} of {all}',
      fWaiting: 'Waiting', fUploading: 'Uploading {pct}%', fSaved: 'Saved on the computer ✓', fFailed: 'Failed', fRetrying: 'Connection lost, trying again ({n} of 3)',
      fWaitServer: 'The computer asked to wait a moment…', fNotSent: 'Not sent', retry: 'Try again',
      savedNote: 'The file is saved on the computer. Converting it for editing continues there; you can close this page when everything is saved.',
      keepOpen: 'Keep this page open and the screen on', done: 'I am done', closed: 'All done. The code is closed and you can close this page.',
      announceSaved: '{name} saved on the computer', announceFailed: '{name} failed: {why}', allDone: 'All files are saved on the computer',
      'e.invalid_request': 'The request was not valid.', 'e.code_invalid': 'The code is not right. Check the code shown on the computer.',
      'e.code_already_used': 'The code was already used on another device. Ask the computer for a new one.', 'e.code_expired': 'The code expired. Ask the computer for a new one.',
      'e.rate_limited': 'Too many requests. Waiting a moment.', 'e.session_invalid': 'The connection to the computer was lost. Scan the code on the computer again.',
      'e.code_closed': 'The code was closed on the computer. Ask for a new one.', 'e.length_required': 'The browser did not send the size of the file.',
      'e.upload_too_large': 'The file is too large to upload.', 'e.code_budget': 'This code reached its upload limit. Ask the computer for a new one.',
      'e.storage_quota_exceeded': 'The project has no more storage room on the computer.', 'e.disk_full': 'The computer\'s disk does not have enough free space.',
      'e.upload_incomplete': 'The file did not arrive complete.', 'e.empty_upload': 'The file is empty.', 'e.invalid_filename': 'The file name could not be read.',
      'e.internal_error': 'A fault on the computer. You can try again.',
      'e.network': 'The connection was lost. Check that the phone and the computer are on the same Wi-Fi.', 'e.unknown': 'Something went wrong.'
    }
  };

  var BACKOFF = [2000, 4000, 8000];
  var MAX_WAITS = 30;
  var MAX_WAIT_MS = 60000;

  /* The same cut as core's cutUploadName (importView.ts): at most max UTF-16 units and maxBytes once percent-encoded,
     the extension (up to 10 characters) kept, no code point split, a lone surrogate becomes U+FFFD. */
  function cost(cp) {
    if (cp < 128) return /[A-Za-z0-9\-_.!~*'()]/.test(String.fromCharCode(cp)) ? 1 : 3;
    return cp < 2048 ? 6 : cp < 65536 ? 9 : 12;
  }
  function cutName(name, max, maxBytes) {
    max = max || 256; maxBytes = maxBytes || 2048;
    var pts = Array.from(String(name)).map(function (c) { var u = c.charCodeAt(0); return c.length === 1 && u >= 55296 && u <= 57343 ? '�' : c; });
    var clean = pts.join('');
    var total = function (a) { return a.reduce(function (n, c) { return n + cost(c.codePointAt(0)); }, 0); };
    if (clean.length <= max && total(pts) <= maxBytes) return clean;
    var dot = clean.lastIndexOf('.');
    var ext = dot > 0 && clean.length - dot <= 10 ? Array.from(clean.slice(dot)) : [];
    var chars = max - ext.join('').length;
    var bytes = maxBytes - total(ext);
    if (chars <= 0 || bytes <= 0) { ext = []; chars = max; bytes = maxBytes; }
    var head = pts.slice(0, dot > 0 && ext.length ? Array.from(clean.slice(0, dot)).length : pts.length);
    var out = '';
    for (var i = 0; i < head.length; i++) {
      var c = head[i], b = cost(c.codePointAt(0));
      if (c.length > chars || b > bytes) break;
      out += c; chars -= c.length; bytes -= b;
    }
    return out + ext.join('');
  }

  /* What an answer means. 'wait': wait Retry-After and resend without spending a retry. 'retry': a lost connection or a fault on
     the computer: up to 3 more tries after 2, 4 and 8 s. 'fatal': the session or the code is over, nothing more can be sent.
     'file': this file was refused for its own reason; it is never resent unchanged. */
  function classify(status, code) {
    if (status === 0) return 'retry';
    if (status === 429 || code === 'rate_limited') return 'wait';
    if (code === 'session_invalid' || code === 'code_closed' || code === 'code_expired' || status === 401 || status === 410) return 'fatal';
    if (code === 'upload_incomplete' || code === 'internal_error') return 'retry';
    if (status >= 500 && code !== 'storage_quota_exceeded' && code !== 'disk_full') return 'retry';
    return 'file';
  }
  /* Checked before a byte is sent, against the numbers /hello, /status and /upload gave: null, or the refusal's code. */
  function precheck(file, lim) {
    if (!file.size) return 'empty_upload';
    if (lim.maxFileBytes != null && file.size > lim.maxFileBytes) return 'upload_too_large';
    if (lim.filesLeft != null && lim.filesLeft <= 0) return 'code_budget';
    if (lim.remainingBytes != null && file.size > lim.remainingBytes) return 'code_budget';
    return null;
  }
  function fill(s, vars) { return s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] == null ? '' : String(vars[k]); }); }
  function errText(lang, code) { var t = STR[lang]; return t['e.' + code] || t['e.unknown']; }
  function sizeText(n) {
    if (n < 1048576) return Math.max(1, Math.round(n / 1024)) + ' KB';
    if (n < 1073741824) return Math.round(n / 1048576) + ' MB';
    return (n / 1073741824).toFixed(1) + ' GB';
  }

  /* The upload queue: one file at a time, in the order chosen. deps (all promises, so a test can drive them):
       status() -> {status, body, code}      POST /status
       upload(file, onProgress) -> {status, body, code, retryAfter}   POST /upload (status 0 = the connection broke)
       rehello() -> boolean                  a new session from the original token (a reloaded tab); false when there is none
       sleep(ms) -> Promise
       onItem(item)  called on every change of an item;  onLimits(lim);  onFatal(code) */
  function createUploader(deps, lim) {
    var items = [];
    var running = false;
    var fatal = null;
    function emit(it) { deps.onItem(it); }
    function setState(it, state, extra) {
      it.state = state;
      if (extra) for (var k in extra) it[k] = extra[k];
      emit(it);
    }
    function takeLimits(body) {
      if (!body) return;
      if (typeof body.maxFileBytes === 'number') lim.maxFileBytes = body.maxFileBytes;
      if (typeof body.remainingBytes === 'number') lim.remainingBytes = body.remainingBytes;
      if (typeof body.filesLeft === 'number') lim.filesLeft = body.filesLeft;
      deps.onLimits(lim);
    }
    async function sendOne(it) {
      var spent = 0, waits = 0, rehelloTried = false, needStatus = true;
      for (;;) {
        if (needStatus) {
          var st = await deps.status();
          if (st.status === 200) { takeLimits(st.body); needStatus = false; }
          else {
            var sc = classify(st.status, st.code);
            if (sc === 'fatal' && st.code === 'session_invalid' && !rehelloTried) {
              rehelloTried = true;
              if (await deps.rehello()) continue;
            }
            if (sc === 'fatal') return { ok: false, code: st.code || 'session_invalid', fatal: true };
            if (sc === 'wait' && waits < MAX_WAITS) { waits++; setState(it, 'waiting-server'); await deps.sleep(Math.min(MAX_WAIT_MS, Math.max(1, st.retryAfter || 1) * 1000)); continue; }
            if (sc === 'retry' || sc === 'wait') {
              if (spent >= BACKOFF.length) return { ok: false, code: st.status === 0 ? 'network' : (st.code || 'internal_error') };
              setState(it, 'retrying', { tries: spent + 1 });
              await deps.sleep(BACKOFF[spent]); spent++;
              continue;
            }
            return { ok: false, code: st.code || 'unknown' };
          }
        }
        var pre = precheck(it.file, lim);
        if (pre) return { ok: false, code: pre };
        setState(it, 'uploading', { pct: 0 });
        var r = await deps.upload(it.file, function (pct) { if (pct !== it.pct) { it.pct = pct; emit(it); } });
        if (r.status === 201) { takeLimits(r.body); return { ok: true }; }
        var c = classify(r.status, r.code);
        if (c === 'wait') {
          if (waits >= MAX_WAITS) return { ok: false, code: 'rate_limited' };
          waits++; setState(it, 'waiting-server');
          await deps.sleep(Math.min(MAX_WAIT_MS, Math.max(1, r.retryAfter || 1) * 1000));
          continue; /* resend; no retry spent */
        }
        if (c === 'retry') {
          if (spent >= BACKOFF.length) return { ok: false, code: r.status === 0 ? 'network' : (r.code || 'internal_error') };
          setState(it, 'retrying', { tries: spent + 1 });
          await deps.sleep(BACKOFF[spent]); spent++;
          needStatus = true; /* after any network error the numbers and the session are checked before resending */
          continue;
        }
        if (c === 'fatal') {
          if (r.code === 'session_invalid' && !rehelloTried) { rehelloTried = true; if (await deps.rehello()) { needStatus = true; continue; } }
          return { ok: false, code: r.code || 'session_invalid', fatal: true };
        }
        return { ok: false, code: r.code || 'unknown' };
      }
    }
    async function drain() {
      if (running) return;
      running = true;
      try {
        for (;;) {
          var next = null;
          for (var i = 0; i < items.length; i++) if (items[i].state === 'waiting') { next = items[i]; break; }
          if (!next) break;
          if (fatal) { setState(next, 'failed', { code: fatal, notSent: true }); continue; }
          var res = await sendOne(next);
          if (res.ok) setState(next, 'saved', { pct: 100, code: null });
          else {
            setState(next, 'failed', { code: res.code });
            if (res.fatal) { fatal = res.code; deps.onFatal(res.code); }
          }
        }
      } finally { running = false; }
    }
    return {
      items: items,
      add: function (files) {
        for (var i = 0; i < files.length; i++) { var it = { file: files[i], state: 'waiting', pct: 0, code: null, tries: 0, notSent: false }; items.push(it); emit(it); }
        return drain();
      },
      retry: function (it) { if (it.state !== 'failed' || fatal) return drain(); setState(it, 'waiting', { code: null, pct: 0, tries: 0, notSent: false }); return drain(); },
      idle: function () { return !running; },
      get fatal() { return fatal; }
    };
  }

  var api = { STR: STR, BACKOFF: BACKOFF, cutName: cutName, classify: classify, precheck: precheck, fill: fill, errText: errText, sizeText: sizeText, createUploader: createUploader };
  if (typeof document === 'undefined') { root.__pfDrop = api; return; }

  /* ---- the page ---- */
  var doc = document;
  var $ = function (id) { return doc.getElementById(id); };
  var lang = 'he';
  try { var nl = (navigator.language || 'he').toLowerCase(); lang = nl.indexOf('he') === 0 || nl.indexOf('iw') === 0 ? 'he' : (nl.indexOf('en') === 0 ? 'en' : 'he'); } catch (e) { lang = 'he'; }
  var session = null;
  var token = '';
  var statusKey = null, statusParams = null, statusErr = false;
  var closed = false;
  var T = function (k, p) { return fill(STR[lang][k] || '', p || {}); };

  try { token = decodeURIComponent((location.hash || '').replace(/^#/, '')); } catch (e) { token = ''; }
  try { session = sessionStorage.getItem('pfdrop.s'); } catch (e) { session = null; }
  function keepSession(s) { session = s; try { if (s) sessionStorage.setItem('pfdrop.s', s); else sessionStorage.removeItem('pfdrop.s'); } catch (e) { /* private mode: the token in the address bar still re-claims */ } }

  function say(key, params, isErr) { statusKey = key; statusParams = params || null; statusErr = !!isErr; paintStatus(); }
  function sayCode(code) { say('e.' + (STR.he['e.' + code] ? code : 'unknown'), null, true); }
  function paintStatus() {
    var el = $('status');
    el.textContent = statusKey ? T(statusKey, statusParams) : '';
    el.className = 'status' + (statusErr ? ' err' : '');
  }
  function show(id, on) { $(id).hidden = !on; }

  function post(path, body, auth) {
    return new Promise(function (resolve) {
      var x = new XMLHttpRequest();
      x.open('POST', path);
      if (auth) x.setRequestHeader('authorization', 'Bearer ' + auth);
      if (body) x.setRequestHeader('content-type', 'application/json');
      x.onload = function () {
        var b = null; try { b = JSON.parse(x.responseText); } catch (e) { b = null; }
        var ra = parseInt(x.getResponseHeader('retry-after') || '', 10);
        resolve({ status: x.status, body: b, code: b && b.error ? b.error.code : null, retryAfter: isNaN(ra) ? 0 : ra });
      };
      x.onerror = x.onabort = x.ontimeout = function () { resolve({ status: 0, body: null, code: null, retryAfter: 0 }); };
      x.send(body ? JSON.stringify(body) : null);
    });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function hello(payload) {
    for (var tries = 0; tries < 6; tries++) {
      var r = await post('/hello', payload);
      if (r.status === 429) { await sleep(Math.min(MAX_WAIT_MS, Math.max(1, r.retryAfter) * 1000)); continue; }
      return r;
    }
    return { status: 429, code: 'rate_limited', body: null };
  }
  function adopt(r) {
    keepSession(r.body.session);
    lim.maxFileBytes = r.body.maxFileBytes; lim.remainingBytes = r.body.remainingBytes; lim.filesLeft = r.body.filesLeft;
    show('pinbox', false); show('picker', true);
    say('connected');
  }

  var lim = { maxFileBytes: null, remainingBytes: null, filesLeft: null };
  var rows = [];
  var uploader = createUploader({
    status: function () { return post('/status', null, session); },
    upload: function (file, onProgress) {
      return new Promise(function (resolve) {
        var x = new XMLHttpRequest();
        x.open('POST', '/upload');
        x.setRequestHeader('authorization', 'Bearer ' + session);
        x.setRequestHeader('x-filename', encodeURIComponent(cutName(file.name || 'file', 256, 2048)));
        if (file.lastModified > 0) x.setRequestHeader('x-pf-last-modified', String(Math.floor(file.lastModified)));
        x.setRequestHeader('content-type', 'application/octet-stream');
        x.upload.onprogress = function (e) { if (e.lengthComputable && e.total > 0) onProgress(Math.min(99, Math.floor(e.loaded * 100 / e.total))); };
        x.onload = function () {
          var b = null; try { b = JSON.parse(x.responseText); } catch (e) { b = null; }
          var ra = parseInt(x.getResponseHeader('retry-after') || '', 10);
          resolve({ status: x.status, body: b, code: b && b.error ? b.error.code : null, retryAfter: isNaN(ra) ? 0 : ra });
        };
        x.onerror = x.onabort = x.ontimeout = function () { resolve({ status: 0, body: null, code: null, retryAfter: 0 }); };
        x.send(file);
      });
    },
    rehello: async function () {
      if (!token) return false;
      var r = await hello({ token: token });
      if (r.status === 200) { keepSession(r.body.session); return true; }
      return false;
    },
    sleep: sleep,
    onItem: function (it) { paintItem(it); paintTotal(); announce(it); },
    onLimits: function () { /* the numbers are used before each file */ },
    onFatal: function (code) { sayCode(code); }
  }, lim);

  function paintItem(it) {
    var i = uploader.items.indexOf(it);
    var li = rows[i];
    if (!li) {
      li = doc.createElement('li');
      li.setAttribute('data-testid', 'drop-file-' + i);
      li.innerHTML = '<bdi class="n" dir="auto"></bdi><span class="sz"></span><span class="st" data-testid="drop-file-state"></span><progress max="100" value="0" data-testid="drop-file-progress"></progress>';
      $('files').appendChild(li); rows[i] = li;
    }
    var st = li.querySelector('.st'), pr = li.querySelector('progress');
    li.querySelector('.n').textContent = it.file.name || '';
    li.querySelector('.sz').textContent = sizeText(it.file.size || 0);
    pr.value = it.state === 'saved' ? 100 : it.pct;
    pr.setAttribute('aria-label', it.file.name || '');
    var old = li.querySelector('button'); if (old) li.removeChild(old);
    li.className = it.state === 'saved' ? 'saved' : it.state === 'failed' ? 'failed' : '';
    var text;
    if (it.state === 'waiting') text = T('fWaiting');
    else if (it.state === 'uploading') text = T('fUploading', { pct: it.pct });
    else if (it.state === 'retrying') text = T('fRetrying', { n: it.tries });
    else if (it.state === 'waiting-server') text = T('fWaitServer');
    else if (it.state === 'saved') text = T('fSaved');
    else text = T('fFailed') + ' · ' + (it.notSent ? T('fNotSent') : errText(lang, it.code));
    st.textContent = text;
    if (it.state === 'failed' && !uploader.fatal) {
      var b = doc.createElement('button'); b.type = 'button'; b.textContent = T('retry');
      b.onclick = function () { uploader.retry(it); };
      li.appendChild(b);
    }
  }
  function paintTotal() {
    var n = 0, all = uploader.items.length;
    for (var i = 0; i < all; i++) if (uploader.items[i].state === 'saved') n++;
    $('total').textContent = T('total', { done: n, all: all });
    return n;
  }
  /* Live announcements: only a file that is saved or failed, and the end of the batch; never a percent. */
  function announce(it) {
    if (it.state === 'saved') {
      var n = paintTotal();
      if (n === uploader.items.length) say('allDone'); else say('announceSaved', { name: it.file.name || '' });
    } else if (it.state === 'failed' && !it.notSent) say('announceFailed', { name: it.file.name || '', why: errText(lang, it.code) }, true);
  }
  function choose(ev) {
    var fs = Array.prototype.slice.call(ev.target.files || []);
    ev.target.value = '';
    if (!fs.length || closed) return;
    show('list', true);
    uploader.add(fs);
  }
  function paintStatic() {
    doc.documentElement.lang = lang; doc.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
    doc.title = T('title');
    var els = doc.querySelectorAll('[data-i]');
    for (var i = 0; i < els.length; i++) els[i].textContent = T(els[i].getAttribute('data-i'));
    $('lang').textContent = T('langBtn');
    $('lang').setAttribute('lang', lang === 'he' ? 'en' : 'he');
    paintStatus();
    for (var j = 0; j < uploader.items.length; j++) paintItem(uploader.items[j]);
    paintTotal();
  }
  $('lang').onclick = function () { lang = lang === 'he' ? 'en' : 'he'; paintStatic(); };
  $('pickMedia').onchange = choose;
  $('pickOriginal').onchange = choose;
  $('done').onclick = async function () {
    closed = true;
    $('done').disabled = true;
    if (session) await post('/bye', null, session);
    keepSession(null);
    show('picker', false);
    say('closed');
  };
  async function submitPin() {
    var pin = $('pin').value.replace(/\D/g, '');
    if (pin.length !== 6) { sayCode('code_invalid'); return; }
    say('connecting');
    var r = await hello({ pin: pin });
    if (r.status === 200) adopt(r); else sayCode(r.code || 'unknown');
  }
  $('pingo').onclick = submitPin;
  $('pin').onkeydown = function (e) { if (e.key === 'Enter') submitPin(); };

  async function start() {
    paintStatic();
    say('connecting');
    if (session) { /* a reloaded tab: the old session may still be good */
      var s = await post('/status', null, session);
      if (s.status === 200) { lim.maxFileBytes = s.body.maxFileBytes; lim.remainingBytes = s.body.remainingBytes; lim.filesLeft = s.body.filesLeft; show('picker', true); say('connected'); return; }
    }
    if (token) {
      var r = await hello({ token: token });
      if (r.status === 200) { adopt(r); return; }
      sayCode(r.code || 'unknown');
      if (r.code === 'code_invalid') show('pinbox', true);
      return;
    }
    say('connecting'); statusKey = null; paintStatus();
    show('pinbox', true);
  }
  start();
})(this);
