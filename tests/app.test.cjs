const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

function harness(saved = []) {
  const elements = new Map();
  const element = () => ({
    children: [], value: '60', textContent: '',
    append(...children) { this.children.push(...children); },
    replaceChildren() { this.children = []; },
    addEventListener() {}, classList: { toggle() {} }
  });
  let metadata = {};
  let ready;
  class Audio {
    constructor() { this.readyState = 1; this.currentTime = 0; }
    pause() {} load() {} addEventListener() {} removeAttribute() {}
    play() { return Promise.resolve(); }
  }
  const context = vm.createContext({
    Audio, crypto: { randomUUID }, console, setInterval() {},
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
      },
      createElement: element, querySelectorAll: () => []
    },
    localStorage: { getItem: () => JSON.stringify(saved) },
    fetch: async () => ({ ok: true, json: async () => [] }),
    OBR: {
      onReady(callback) { ready = callback; },
      player: { getRole: async () => 'GM', onChange() {} },
      room: {
        getMetadata: async () => metadata,
        setMetadata: async (value) => { metadata = value; },
        onMetadataChange() {}
      }
    }
  });
  const source = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
  vm.runInContext(source.replace(/^import .*;\r?\n/, ''), context);
  return {
    run: code => vm.runInContext(code, context),
    ready: () => ready(), elements,
    seed(state) { metadata = { 'com.geezsheets.geezradio/state': state }; },
    state: () => metadata['com.geezsheets.geezradio/state']
  };
}

const track = { path: 'music/test.mp3', name: 'Test' };
const playing = (loop = 'one') => ({
  queue: [track], index: 0, playing: true, position: 0,
  updatedAt: 1000, loop, revision: 1
});

test('loop one and single-track loop all restart the playback clock', async () => {
  for (const loop of ['one', 'all']) {
    const app = harness();
    app.seed(playing(loop));
    app.run('gm = true');
    await app.run('advance()');
    assert.ok(app.state().updatedAt > 1000);
    assert.ok(app.state().playbackId);
    assert.equal(app.state().position, 0);
    assert.equal(app.state().playing, true);
  }
});

test('rapid commands execute in order and a failed write does not block later commands', async () => {
  const app = harness();
  app.seed(playing());
  app.run('gm = true');
  await app.run(`Promise.all([
    commit(s => ({ ...s, queue: [...s.queue, { path: 'music/a.mp3' }] })),
    commit(() => { throw new Error('test failure'); }),
    commit(s => ({ ...s, queue: [...s.queue, { path: 'music/b.mp3' }] }))
  ])`);
  assert.equal(app.state().queue.length, 3);
  assert.equal(app.state().revision, 3);
});

test('GM saved playlists have Load controls immediately after startup', async () => {
  const app = harness([{ name: 'Saved', queue: [track] }]);
  await app.ready();
  assert.ok(app.elements.get('playlists').children[0].children.some(child => child.textContent === 'Load'));
});

test('malformed saved playlists are sanitized without breaking startup', async () => {
  const app = harness([null, { name: 'Broken', queue: [null, track] }, { name: 'Missing queue' }]);
  await app.ready();
  assert.equal(app.elements.get('playlists').children.length, 2);
  assert.equal(app.elements.get('playlists').children[0].children[0].textContent, 'Broken (1 tracks)');
});

test('same-revision changes are received and explicit restart seeks even near the beginning', () => {
  const app = harness();
  app.run(`receive({ [KEY]: ${JSON.stringify(playing())} }); music.currentTime = 1;`);
  app.run(`receive({ [KEY]: { ...roomState, updatedAt: Date.now(), playbackId: 'restart' } });`);
  assert.ok(app.run('music.currentTime') < 0.5);
});

test('music-only updates preserve the clock and malformed URL escapes do not throw', async () => {
  const app = harness();
  app.seed(playing());
  app.run('gm = true');
  await app.run('commit(s => ({ ...s, loop: "all" }))');
  assert.equal(app.state().updatedAt, 1000);
  assert.doesNotThrow(() => app.run('audioPath(ROOT + "music/bad%name.mp3")'));
});
