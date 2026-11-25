import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
  extractScriptBlocks,
  injectLivingPostSecurity,
  isTrustedLivingHtmlUrl,
  MAX_LIVING_POST_BYTES,
  parseLivingPostRecipe,
  validateLivingPostHtml,
} from '../src/lib/living/livingPostValidator.ts';
import { generateLivingPost, type LLMMessage } from '../src/lib/living/recursiveAgent.ts';
import { LIVING_STARTER_PROMPTS } from '../src/lib/living/starterPresets.ts';

const vmSyntaxCheck = (code: string) => {
  new vm.Script(code, { filename: 'test-living.js' });
};

const VALID_HTML = `<!DOCTYPE html>
<html>
<head><title>Spark</title></head>
<body>
<canvas id="c"></canvas>
<script>
(function(){
  const c = document.getElementById('c');
  const ctx = c.getContext('2d');
  c.addEventListener('pointerdown', function(){ ctx.fillRect(0, 0, 10, 10); });
})();
</script>
</body>
</html>`;

test('valid Living Post passes validation and vm.Script check', () => {
  const res = validateLivingPostHtml(VALID_HTML, vmSyntaxCheck);
  assert.equal(res.ok, true);
  assert.deepEqual(res.errors, []);
  assert.ok(res.byteSize > 0 && res.byteSize <= MAX_LIVING_POST_BYTES);
});

test('injectLivingPostSecurity adds strict CSP, watchdog, teardown, and conditional studio thumb helper', () => {
  const feedHtml = injectLivingPostSecurity(VALID_HTML, { studioPreview: false });
  assert.match(feedHtml, /http-equiv="Content-Security-Policy"/i);
  assert.match(feedHtml, /default-src 'none'/);
  assert.match(feedHtml, /VYBE_LIVING_READY/);
  assert.match(feedHtml, /VYBE_TEARDOWN/);
  assert.match(feedHtml, /WEBGL_lose_context/);
  assert.doesNotMatch(feedHtml, /preserveDrawingBuffer/);

  const feedValidation = validateLivingPostHtml(feedHtml, vmSyntaxCheck);
  assert.equal(feedValidation.ok, true, `Feed HTML failed: ${feedValidation.errors.join('; ')}`);

  const studioHtml = injectLivingPostSecurity(feedHtml, { studioPreview: true });
  assert.match(studioHtml, /preserveDrawingBuffer/);
  assert.match(studioHtml, /VYBE_CAPTURE_THUMB/);
  // Idempotent: re-injecting must not leave duplicate watchdogs
  assert.equal(studioHtml.match(/window\.__vybeWatchdog=1/g)?.length, 1);

  const studioValidation = validateLivingPostHtml(studioHtml, vmSyntaxCheck);
  assert.equal(studioValidation.ok, true, `Studio HTML failed: ${studioValidation.errors.join('; ')}`);
});

test('validator rejects size overflow, empty input, missing canvas, and missing script', () => {
  assert.equal(validateLivingPostHtml('').ok, false);
  assert.equal(validateLivingPostHtml('<html><body><div>hi</div><script>const x=1;</script></body></html>').ok, false);
  assert.equal(validateLivingPostHtml('<html><body><canvas></canvas></body></html>').ok, false);

  const hugePad = 'a'.repeat(MAX_LIVING_POST_BYTES + 100);
  const bigHtml = `<html><body><canvas></canvas><script>// ${hugePad}</script></body></html>`;
  const bigRes = validateLivingPostHtml(bigHtml);
  assert.equal(bigRes.ok, false);
  assert.ok(bigRes.errors.some((e) => e.includes('Payload too large')));
});

test('validator rejects banned APIs, external URLs, and ES modules', () => {
  const forbiddenSnippets = [
    `<canvas></canvas><script>fetch('https://evil.com');</script>`,
    `<canvas></canvas><script>console.log(document.cookie);</script>`,
    `<canvas></canvas><script>localStorage.setItem('a','b');</script>`,
    `<canvas></canvas><script>eval('1+1');</script>`,
    `<canvas></canvas><script>new Function('return 1')();</script>`,
    `<canvas></canvas><iframe src="data:text/html,hi"></iframe><script>let x=1;</script>`,
    `<canvas></canvas><script type="module">const x=1;</script>`,
    `<canvas></canvas><script>\nimport x from './foo.js';\n</script>`,
  ];

  for (const snippet of forbiddenSnippets) {
    const res = validateLivingPostHtml(`<!DOCTYPE html><html><body>${snippet}</body></html>`);
    assert.equal(res.ok, false, `Should reject: ${snippet}`);
  }
});

test('validator catches JS syntax errors via vm.Script', () => {
  const broken = `<!DOCTYPE html><html><body><canvas></canvas><script>const x = ;</script></body></html>`;
  const res = validateLivingPostHtml(broken, vmSyntaxCheck);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('JavaScript syntax error')));
  assert.equal(extractScriptBlocks(broken).length, 1);
});

test('recursiveAgent self-heals failed attempt 1 into passing attempt 2 and emits stages', async () => {
  const stages: string[] = [];
  let calls = 0;
  const capturedHistories: LLMMessage[][] = [];

  const mockComplete = async (messages: LLMMessage[]): Promise<string> => {
    calls++;
    capturedHistories.push(messages.map((m) => ({ ...m })));
    if (calls === 1) {
      return '```html\n<!DOCTYPE html><html><body><canvas></canvas><script>fetch("/steal"); const broken = ;</script></body></html>\n```';
    }
    return VALID_HTML;
  };

  const result = await generateLivingPost('barish and lightning', mockComplete, {
    maxAttempts: 2,
    syntaxChecker: vmSyntaxCheck,
    onStage: (ev) => stages.push(ev.stage),
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.deepEqual(stages, ['generating', 'validating', 'healing', 'generating', 'validating']);
  assert.ok(capturedHistories[1].some((m) => m.role === 'user' && m.content.includes('JavaScript syntax error')));
  assert.match(result.html, /http-equiv="Content-Security-Policy"/i);
});

test('recursiveAgent includes runtime error when healing broken browser output', async () => {
  let seenRuntimeMsg = '';
  const result = await generateLivingPost(
    'neon rain',
    async (messages) => {
      seenRuntimeMsg = messages.map((m) => m.content).join('\n');
      return VALID_HTML;
    },
    {
      previousHtml: '<html><body><canvas></canvas><script>oops()</script></body></html>',
      runtimeError: 'ReferenceError: oops is not defined',
      syntaxChecker: vmSyntaxCheck,
    },
  );

  assert.equal(result.ok, true);
  assert.ok(seenRuntimeMsg.includes('ReferenceError: oops is not defined'));
});

test('all curated starter presets pass security & vm.Script syntax validation', () => {
  assert.equal(LIVING_STARTER_PROMPTS.length, 4);
  for (const preset of LIVING_STARTER_PROMPTS) {
    const html = preset.buildHtml();
    const res = validateLivingPostHtml(html, vmSyntaxCheck);
    assert.equal(res.ok, true, `Preset ${preset.id} failed: ${res.errors.join('; ')}`);
  }
});

test('parseLivingPostRecipe trusts R2 URLs and rejects untrusted origins', () => {
  assert.equal(isTrustedLivingHtmlUrl('https://pub-12345.r2.dev/never/abc/living.txt'), true);
  assert.equal(isTrustedLivingHtmlUrl('https://evil.example.com/living.txt'), false);

  const parsed = parseLivingPostRecipe({
    kind: 'living_post',
    version: 1,
    livingHtmlUrl: 'https://pub-12345.r2.dev/never/abc/living.txt',
    prompt: 'Barish + Bijli + Shayari',
  });
  assert.ok(parsed);
  assert.equal(parsed.livingHtmlUrl, 'https://pub-12345.r2.dev/never/abc/living.txt');
  assert.equal(parsed.prompt, 'Barish + Bijli + Shayari');

  const untrusted = parseLivingPostRecipe({
    kind: 'living_post',
    version: 1,
    livingHtmlUrl: 'https://evil.example.com/bad.html',
    prompt: 'Evil',
  });
  assert.equal(untrusted, null);
});
