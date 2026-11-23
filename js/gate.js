// Client-side password gate (replaces Webflow's site password).
// GitHub Pages is static, so this only keeps casual visitors out: the page HTML
// and assets remain publicly fetchable. Only a SHA-256 hash is stored here.
(function () {
  var HASH = 'd9fb92e3bbe65be1f1aad4a82eef4567f7a1ebe2cd110c8049b9698be7a70c88';
  var KEY = 'jb-unlocked';

  try { if (localStorage.getItem(KEY) === HASH) return; } catch (e) { /* storage blocked: fall through to prompt */ }

  var doc = document.documentElement;
  var style = document.createElement('style');
  style.textContent =
    'html.jb-locked{overflow:hidden}' +
    'html.jb-locked body>*:not(#jb-gate){visibility:hidden!important}' +
    '#jb-gate{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:#fff;font-family:Inter,DM Sans,sans-serif;color:#111}' +
    '#jb-gate form{display:flex;flex-direction:column;align-items:flex-start;gap:12px;width:min(640px,86vw);text-align:left}' +
    '#jb-gate h1{margin:0 0 4px;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:22px;font-weight:500}' +
    '#jb-gate p{margin:0 0 4px;font-size:14px;color:#555}' +
    // The "*" glyphs stand in for password dots; the real value lives in JS.
    '#jb-gate input{box-sizing:border-box;width:100%;margin-top:24px;padding:0 0 4px;border:0;border-bottom:2px solid #000;border-radius:0;background:transparent;outline:0;caret-color:#000;color:#111;font-family:Georgia,"Times New Roman",serif;font-style:italic;font-weight:700;font-size:clamp(24px,4vw,36px);line-height:1.1;letter-spacing:.02em}' +
    '#jb-gate button{padding:4px 0;border:0;background:none;color:#888;font:inherit;font-size:16px;cursor:pointer}' +
    '#jb-gate button:hover,#jb-gate button:focus-visible{color:#111}' +
    '#jb-gate [role=alert]{min-height:1.2em;margin:0;font-size:14px;color:#b00020}';
  document.head.appendChild(style);
  doc.classList.add('jb-locked');

  async function sha256(text) {
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function build() {
    var gate = document.createElement('div');
    gate.id = 'jb-gate';
    gate.innerHTML =
      '<form novalidate>' +
        '<h1>This site is password protected</h1>' +
        '<p>Enter the password to continue.</p>' +
        '<label for="jb-pw" style="position:absolute;left:-9999px">Password</label>' +
        // Plain text input (not type=password) so it can display "*" per character.
        '<input id="jb-pw" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-describedby="jb-pw-hint">' +
        '<span id="jb-pw-hint" style="position:absolute;left:-9999px">Characters are hidden and shown as asterisks.</span>' +
        '<button type="submit">enter</button>' +
        '<p role="alert"></p>' +
      '</form>';
    document.body.appendChild(gate);
    var input = gate.querySelector('input');
    var alertEl = gate.querySelector('[role=alert]');
    var real = '';

    function show() { input.value = '*'.repeat(real.length); }

    // Display length always equals real length, so selection offsets map 1:1.
    input.addEventListener('beforeinput', function (e) {
      var start = input.selectionStart, end = input.selectionEnd;
      var type = e.inputType, text = null;
      if (type === 'insertText' || type === 'insertReplacementText') text = e.data || '';
      else if (type === 'insertFromPaste' || type === 'insertFromDrop') text = (e.dataTransfer && e.dataTransfer.getData('text')) || '';
      if (text !== null) {
        real = real.slice(0, start) + text + real.slice(end);
        start += text.length;
      } else if (type.indexOf('delete') === 0) {
        if (start === end) {
          if (type.indexOf('Forward') > -1) end = Math.min(real.length, end + 1);
          else start = Math.max(0, start - 1);
        }
        real = real.slice(0, start) + real.slice(end);
      } else { return; }
      e.preventDefault();
      show();
      input.setSelectionRange(start, start);
    });

    // Fallback for input that skipped beforeinput (autofill, some mobile keyboards).
    input.addEventListener('input', function () {
      if (input.value !== '*'.repeat(real.length)) { real = input.value; show(); }
    });

    input.focus();
    gate.querySelector('form').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (await sha256(real) === HASH) {
        try { localStorage.setItem(KEY, HASH); } catch (err) { /* storage blocked: the prompt will reappear on reload */ }
        // Reload so the page's scripts initialise against a visible layout.
        location.reload();
      } else {
        alertEl.textContent = 'Incorrect password.';
        input.select();
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
