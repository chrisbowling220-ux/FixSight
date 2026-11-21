const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

test('read aloud requires a tap, reuses audio for replay, and releases it on stop', async () => {
  const source = readFileSync('public/app.js', 'utf8');
  const playback = source.slice(source.indexOf('// Playback is generated'));
  const elements = Object.fromEntries([
    'voice-playback', 'voice-read', 'voice-pause', 'voice-replay', 'voice-stop',
    'voice-playback-status', 'screen-result',
  ].map((id) => [id, {
    hidden: false, disabled: false, textContent: '', handlers: {},
    addEventListener(event, handler) { this.handlers[event] = handler; },
  }]));
  const calls = [];
  const revoked = [];
  let instance;
  class AudioMock {
    constructor(url) { this.src = url; this.paused = true; this.currentTime = 10; instance = this; }
    addEventListener() {}
    async play() { this.paused = false; }
    pause() { this.paused = true; }
  }
  const context = {
    $: (id) => elements[id], state: { result: { diagnosis: {} } },
    buildShareSummary: () => 'Test assessment', Audio: AudioMock, AbortController,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: (url) => revoked.push(url) },
    fetch: async (url) => {
      calls.push(url);
      return url.endsWith('/status')
        ? { ok: true, json: async () => ({ available: true }) }
        : { ok: true, blob: async () => ({}) };
    },
  };
  vm.createContext(context);
  vm.runInContext('let resetReadAloud = () => {}; function show() {}\n' + playback, context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['/api/voice/status']);
  assert.equal(elements['voice-playback'].hidden, false);
  await elements['voice-read'].handlers.click();
  assert.equal(calls.filter((url) => url.endsWith('/synthesize')).length, 1);
  assert.equal(instance.paused, false);
  await elements['voice-pause'].handlers.click();
  assert.equal(instance.paused, true);
  await elements['voice-replay'].handlers.click();
  assert.equal(instance.currentTime, 0);
  assert.equal(calls.filter((url) => url.endsWith('/synthesize')).length, 1);
  elements['voice-stop'].handlers.click();
  assert.deepEqual(revoked, ['blob:test']);
  assert.equal(elements['voice-read'].disabled, false);
});
