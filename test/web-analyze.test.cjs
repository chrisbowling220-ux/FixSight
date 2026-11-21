const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function harness(fetch) {
  const source = readFileSync('public/app.js', 'utf8');
  const start = source.indexOf('async function analyze(answers)');
  const end = source.indexOf('$("analyze-btn").addEventListener', start);
  const events = [];
  let timeout;
  let cleared = false;
  const context = {
    state: { image: 'AAAA', mediaType: 'image/jpeg', category: null, description: '' },
    AbortController, fetch,
    setTimeout: (fn) => { timeout = fn; return 1; },
    clearTimeout: () => { cleared = true; },
    startLoader: () => events.push('start'), stopLoader: () => events.push('stop'),
    showError: (message) => events.push(message),
    renderResult: () => {}, saveToHistory: () => {}, show: (screen) => events.push(screen),
    renderQuestions: () => {}, renderNonDiagnosis: () => {},
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  return { context, events, timeout: () => timeout(), cleared: () => cleared };
}

test('web scan omits an unselected category and clears its timeout', async () => {
  let body;
  const h = harness(async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ result_type: 'diagnosis', diagnosis: {} }) };
  });
  await h.context.analyze([]);
  assert.equal('category' in body, false);
  assert.equal(h.cleared(), true);
  assert.ok(h.events.includes('screen-result'));
});

test('web scan exits the loader on timeout and warns before retry', async () => {
  const h = harness((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));
  const pending = h.context.analyze([]);
  h.timeout();
  await pending;
  assert.ok(h.events.includes('stop'));
  assert.ok(h.events.some((event) => /timed out/.test(event)));
  assert.equal(h.cleared(), true);
});
