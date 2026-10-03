// @ts-check
// End-to-end engine tests: fake release source + local HTTP server + fake AddOns tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeZip, serve, sha256, snapshot, tmpDir, toc, writeTree } from './helpers.js';
import { update, makePlan } from '../src/app.js';
import { saveConfig, DEFAULT_CONFIG, loadState } from '../src/config.js';

/** Fake upstream: one zip per tag prefix, built from a folder layout. */
function upstream(/** @type {Record<string, string>} */ versions) {
  /** @type {Record<string, Record<string, string>>} */
  const layouts = {
    spoken: { 'SpokenPlayer/SpokenPlayer.toc': toc(versions.spoken), 'SpokenPlayer/Core.lua': 'x', 'SpokenContributions/SpokenContributions.toc': toc(versions.spoken, '16001', '## X-Part-Of: Spoken\n') },
    quests: { 'SpokenQuests/SpokenQuests.toc': toc(versions.quests), 'SpokenQuests/Core.lua': 'q', 'VoiceOverRedux/VoiceOverRedux.toc': toc('2.0.0', '11509', '## X-Part-Of: Spoken\n') },
    'quests-audio': Object.fromEntries(['Alliance', 'Horde', 'Shared', 'Gossip'].flatMap((f) => [
      [`SpokenQuestsAudio${f}/SpokenQuestsAudio${f}.toc`, toc(versions['quests-audio'], '100000, 16001')],
      ...Array.from({ length: 20 }, (_, i) => [`SpokenQuestsAudio${f}/sounds/${i}.ogg`, `${f}-${i}`.repeat(50)]),
    ])),
  };
  const assetNames = { spoken: 'SpokenPlayer', quests: 'SpokenQuests', 'quests-audio': 'SpokenQuestsAudioAll' };
  /** @type {Record<string, Buffer>} */
  const files = {};
  for (const [prefix, layout] of Object.entries(layouts)) {
    files[`/${prefix}/${versions[prefix]}.zip`] = makeZip(layout);
  }
  return { files, assetNames };
}

/**
 * @param {Record<string, string>} versions @param {string} baseUrl
 * @param {ReturnType<typeof upstream>} up
 * @returns {import('../src/sources/source.js').Source & { calls: number }}
 */
function fakeSource(versions, baseUrl, up) {
  return {
    name: 'Fake',
    calls: 0,
    async latest(item) {
      this.calls++;
      const v = versions[item.tagPrefix];
      if (!v) return null;
      const body = up.files[`/${item.tagPrefix}/${v}.zip`];
      return {
        version: v, tag: `${item.tagPrefix}/v${v}`, source: 'Fake',
        asset: { name: `${/** @type {any} */ (up.assetNames)[item.tagPrefix]}-${v}.zip`, url: `${baseUrl}/${item.tagPrefix}/${v}.zip`, size: body.length, sha256: sha256(body) },
      };
    },
  };
}

/** Set up config (zones/books off to keep fixtures small), server and deps. @param {Record<string, string>} versions */
async function world(versions) {
  const home = tmpDir();
  const addons = path.join(home, 'wow', '_classic_beta_', 'Interface', 'AddOns');
  writeTree(addons, { 'Details/Details.toc': toc('1.0.0'), 'Details/Details.lua': 'keep me' });
  writeTree(path.join(home, 'wow', '_classic_beta_', 'WTF'), { 'Account/X/SavedVariables/SpokenPlayer.lua': 'settings' });
  const configDir = path.join(home, 'config');
  saveConfig(configDir, { ...DEFAULT_CONFIG, include_zones: false, include_books: false, addons_path: addons });
  const up = upstream(versions);
  const srv = await serve(up.files);
  const source = fakeSource(versions, srv.url, up);
  const deps = { source, configDir, cacheDir: path.join(home, 'cache'), runningWow: () => [], tty: false };
  return { home, addons, configDir, srv, deps, source, up };
}

const V1 = { spoken: '2.3.1', quests: '2.2.0', 'quests-audio': '2.2.0' };

test('fresh install, then a second run is a strict no-op', async () => {
  const w = await world(V1);
  try {
    assert.equal(await update({ yes: true }, w.deps), 0);
    const names = fs.readdirSync(w.addons).sort();
    assert.deepEqual(names, ['Details', 'SpokenContributions', 'SpokenPlayer', 'SpokenQuests', 'SpokenQuestsAudioAlliance',
      'SpokenQuestsAudioGossip', 'SpokenQuestsAudioHorde', 'SpokenQuestsAudioShared']);
    assert.equal(fs.readFileSync(path.join(w.addons, 'Details/Details.lua'), 'utf8'), 'keep me');
    assert.ok(!fs.existsSync(path.join(w.addons, '..', '.spoken-updater')), 'work dir cleaned up');
    assert.ok(!fs.existsSync(path.join(w.deps.cacheDir, 'downloads', 'spoken')), 'zips removed after success');

    const requestsBefore = w.srv.stats.requests;
    const before = snapshot(w.home);
    assert.equal(await update({ yes: true }, w.deps), 0);
    assert.equal(w.srv.stats.requests, requestsBefore, 'no downloads');
    assert.deepEqual(snapshot(w.home), before, 'no file changed anywhere: AddOns, WTF, config, state, cache');
  } finally {
    await w.srv.close();
  }
});

test('only the item with a newer release is updated', async () => {
  const w = await world(V1);
  try {
    await update({ yes: true }, w.deps);
    const audioBefore = snapshot(path.join(w.addons, 'SpokenQuestsAudioHorde'));
    // Upstream publishes a new player only.
    const v2 = { ...V1, spoken: '2.3.2' };
    const up2 = upstream(v2);
    const srv2 = await serve(up2.files);
    try {
      const deps = { ...w.deps, source: fakeSource(v2, srv2.url, up2) };
      const { plans } = await makePlan({}, deps);
      assert.deepEqual(plans.filter((p) => p.act).map((p) => p.item.id), ['player']);
      assert.equal(await update({ yes: true }, deps), 0);
      assert.equal(srv2.stats.requests, 1);
      assert.match(fs.readFileSync(path.join(w.addons, 'SpokenPlayer/SpokenPlayer.toc'), 'utf8'), /Version: 2\.3\.2/);
      assert.deepEqual(snapshot(path.join(w.addons, 'SpokenQuestsAudioHorde')), audioBefore);
      const st = Object.values(loadState(w.configDir).installs)[0];
      assert.equal(st.player.version, '2.3.2');
    } finally {
      await srv2.close();
    }
  } finally {
    await w.srv.close();
  }
});

test('missing folder, missing .toc and gutted folder each trigger a reinstall of just that item', async () => {
  const w = await world(V1);
  try {
    await update({ yes: true }, w.deps);
    const act = async () => (await makePlan({}, w.deps)).plans.filter((p) => p.act).map((p) => `${p.item.id}:${p.status}`);

    fs.rmSync(path.join(w.addons, 'SpokenContributions'), { recursive: true });
    assert.deepEqual(await act(), ['player:missing']);
    await update({ yes: true }, w.deps);

    fs.rmSync(path.join(w.addons, 'SpokenQuests/SpokenQuests.toc'));
    assert.deepEqual(await act(), ['quests:broken']);
    await update({ yes: true }, w.deps);

    for (const f of fs.readdirSync(path.join(w.addons, 'SpokenQuestsAudioShared/sounds')).slice(0, 10)) {
      fs.rmSync(path.join(w.addons, 'SpokenQuestsAudioShared/sounds', f));
    }
    assert.deepEqual(await act(), ['quests-audio:broken']);
    await update({ yes: true }, w.deps);
    assert.deepEqual(await act(), []);
  } finally {
    await w.srv.close();
  }
});

test('the .toc wins over the state file', async () => {
  const w = await world(V1);
  try {
    await update({ yes: true }, w.deps);
    // Someone replaced SpokenQuests with an older copy by hand; state still says 2.2.0.
    fs.writeFileSync(path.join(w.addons, 'SpokenQuests/SpokenQuests.toc'), toc('2.1.0'));
    const { plans } = await makePlan({}, w.deps);
    const q = plans.find((p) => p.item.id === 'quests');
    assert.equal(q?.installed, '2.1.0');
    assert.equal(q?.status, 'outdated');
  } finally {
    await w.srv.close();
  }
});

test('folders installed by another manager are adopted when already current', async () => {
  const w = await world(V1);
  try {
    writeTree(w.addons, {
      'SpokenPlayer/SpokenPlayer.toc': toc(V1.spoken),
      ...Object.fromEntries(['Alliance', 'Horde', 'Shared', 'Gossip'].map((f) => [`SpokenQuestsAudio${f}/SpokenQuestsAudio${f}.toc`, toc(V1['quests-audio'])])),
    });
    const { plans } = await makePlan({}, w.deps);
    assert.deepEqual(plans.map((p) => `${p.item.id}:${p.status}`), ['player:current', 'quests:not-installed', 'quests-audio:current']);
  } finally {
    await w.srv.close();
  }
});

test('refuses to run while WoW is running unless --force', async () => {
  const w = await world(V1);
  try {
    const deps = { ...w.deps, runningWow: () => ['WowB.exe'] };
    await assert.rejects(update({ yes: true }, deps), /World of Warcraft is running/);
    assert.equal(w.srv.stats.requests, 0);
    assert.equal(await update({ yes: true, force: true }, deps), 0);
  } finally {
    await w.srv.close();
  }
});

test('dry run downloads and changes nothing', async () => {
  const w = await world(V1);
  try {
    const before = snapshot(w.home);
    assert.equal(await update({ yes: true, dryRun: true }, w.deps), 0);
    assert.equal(w.srv.stats.requests, 0);
    assert.deepEqual(snapshot(w.home), before);
  } finally {
    await w.srv.close();
  }
});

test('install --only reinstalls a current item and nothing else', async () => {
  const w = await world(V1);
  try {
    await update({ yes: true }, w.deps);
    const n = w.srv.stats.requests;
    assert.equal(await update({ yes: true, only: ['quests'] }, w.deps), 0);
    assert.equal(w.srv.stats.requests, n + 1);
    await assert.rejects(update({ yes: true, only: ['nope'] }, w.deps), /unknown item/);
  } finally {
    await w.srv.close();
  }
});

test('a broken release for one item does not stop the others', async () => {
  const w = await world(V1);
  try {
    const orig = w.source.latest.bind(w.source);
    w.source.latest = async (item) => {
      if (item.id === 'quests') throw new Error('ambiguous assets, expected one zip: A.zip, B.zip');
      return orig(item);
    };
    assert.equal(await update({ yes: true }, w.deps), 1, 'exit 1 because one item failed');
    assert.ok(fs.existsSync(path.join(w.addons, 'SpokenPlayer')));
    assert.ok(fs.existsSync(path.join(w.addons, 'SpokenQuestsAudioHorde')));
    assert.ok(!fs.existsSync(path.join(w.addons, 'SpokenQuests')));
  } finally {
    await w.srv.close();
  }
});

test('a newer installed version is never downgraded', async () => {
  const w = await world(V1);
  try {
    await update({ yes: true }, w.deps);
    fs.writeFileSync(path.join(w.addons, 'SpokenQuests/SpokenQuests.toc'), toc('9.0.0'));
    const { plans } = await makePlan({}, w.deps);
    const q = plans.find((p) => p.item.id === 'quests');
    assert.equal(q?.status, 'current');
    assert.equal(q?.act, false);
    assert.match(q?.reason ?? '', /newer/);
  } finally {
    await w.srv.close();
  }
});

test('a second instance is refused while the first holds the lock', async () => {
  const w = await world(V1);
  try {
    // Another live process (this one's parent stands in for it) holds the lock.
    fs.writeFileSync(path.join(w.configDir, 'spoken-updater.lock'), String(process.ppid));
    await assert.rejects(update({ yes: true }, w.deps), /already running/);
    assert.equal(w.srv.stats.requests, 0);
    // A lock from a dead process is taken over.
    fs.writeFileSync(path.join(w.configDir, 'spoken-updater.lock'), '999999');
    assert.equal(await update({ yes: true }, w.deps), 0);
    assert.ok(!fs.existsSync(path.join(w.configDir, 'spoken-updater.lock')), 'lock released');
  } finally {
    await w.srv.close();
  }
});

test('dry run with an interrupted install pending changes nothing; a real run recovers it', async () => {
  const w = await world(V1);
  try {
    await update({ yes: true }, w.deps);
    // Simulate a crash mid-swap of SpokenPlayer: original moved to backup, journal left behind.
    const work = path.join(w.addons, '..', '.spoken-updater');
    const bak = path.join(work, 'bak-1');
    fs.mkdirSync(bak, { recursive: true });
    fs.renameSync(path.join(w.addons, 'SpokenPlayer'), path.join(bak, 'SpokenPlayer'));
    fs.writeFileSync(path.join(work, 'journal.json'), JSON.stringify({
      bakDir: bak, committed: false,
      moves: [{ kind: 'backup', from: path.join(w.addons, 'SpokenPlayer'), to: path.join(bak, 'SpokenPlayer') }],
    }));
    const before = snapshot(w.home);
    assert.equal(await update({ yes: true, dryRun: true }, w.deps), 0);
    assert.deepEqual(snapshot(w.home), before);

    const n = w.srv.stats.requests;
    assert.equal(await update({ yes: true }, w.deps), 0);
    assert.ok(fs.existsSync(path.join(w.addons, 'SpokenPlayer/SpokenPlayer.toc')), 'original restored');
    assert.equal(w.srv.stats.requests, n, 'restored folder was current, nothing downloaded');
    assert.ok(!fs.existsSync(work));
  } finally {
    await w.srv.close();
  }
});

test('state from an older version listing a placeholder folder does not cause reinstalls', async () => {
  const w = await world(V1);
  try {
    await update({ yes: true }, w.deps);
    // Pretend an older version of this tool installed and recorded VoiceOverRedux.
    const st = JSON.parse(fs.readFileSync(path.join(w.configDir, 'state.json'), 'utf8'));
    const key = Object.keys(st.installs)[0];
    st.installs[key].quests.folders.VoiceOverRedux = { files: 1, bytes: 10, tocVersion: '2.0.0' };
    fs.writeFileSync(path.join(w.configDir, 'state.json'), JSON.stringify(st));
    const { plans } = await makePlan({}, w.deps);
    assert.deepEqual(plans.filter((p) => p.act).map((p) => p.item.id), []);
  } finally {
    await w.srv.close();
  }
});
