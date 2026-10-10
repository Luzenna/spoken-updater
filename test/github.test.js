// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubSource, filterReleases, pickAsset } from '../src/sources/github.js';
import { buildCatalog } from '../src/catalog.js';

/** @param {string} tag @param {string[]} assets @param {Partial<{draft: boolean, prerelease: boolean}>} [flags] */
const rel = (tag, assets, flags = {}) => ({
  tag_name: tag,
  draft: !!flags.draft,
  prerelease: !!flags.prerelease,
  assets: assets.map((name, i) => ({ name, size: 100 + i, browser_download_url: `https://example/${name}`, digest: `sha256:${'ab'.repeat(32)}` })),
});

const RELEASES = [
  rel('quests-audio/v2.2.1', ['SpokenQuestsAudioAll-2.2.1.zip']),
  rel('quests-audio/v2.10.0', ['SpokenQuestsAudioAll-2.10.0.zip'], { draft: true }),
  rel('quests-audio/v2.3.0', ['SpokenQuestsAudioAll-2.3.0.zip'], { prerelease: true }),
  rel('quests-audio/v2.9.0', ['SpokenQuestsAudioAll-2.9.0.zip']),
  rel('quests-audio-frFR/v0.0.3', ['SpokenQuestsAudio_frFR-0.0.3.zip']),
  rel('quests/v2.2.1', ['SpokenQuests-2.2.1.zip', 'SpokenQuests-WoW_1.12-2.2.1.zip', 'SpokenQuests-WoW_2.4.3-2.2.1.zip', 'SpokenQuests-WoW_3.3.5-2.2.1.zip']),
  rel('quests/v2.10.0-rc.1', ['SpokenQuests-2.10.0-rc.1.zip']),
  rel('legacy/quests/v1.4.3', []),
  rel('v1.4.3', ['VoiceOver.zip']),
];

test('tag filtering is exact on the prefix and ignores drafts, prereleases and junk', () => {
  assert.deepEqual(filterReleases(RELEASES, 'quests').map((x) => x.version), ['2.2.1']);
  assert.deepEqual(filterReleases(RELEASES, 'quests-audio').map((x) => x.version), ['2.9.0', '2.2.1']);
  assert.deepEqual(filterReleases(RELEASES, 'quests-audio-frFR').map((x) => x.version), ['0.0.3']);
  assert.deepEqual(filterReleases(RELEASES, 'zones'), []);
});

test('Forever build selection skips legacy private-server zips', () => {
  assert.equal(pickAsset(RELEASES[5].assets).name, 'SpokenQuests-2.2.1.zip');
  assert.throws(() => pickAsset([]), /no Forever-compatible zip/);
  // spoken/v3.0.0 shipped the real zip plus tiny placeholder zips for the retired addons.
  const v300 = rel('spoken/v3.0.0', ['SpokenBooks-3.0.0.zip', 'Spoken-3.0.0.zip', 'SpokenQuests-3.0.0.zip']).assets;
  v300[1].size = 1;
  assert.equal(pickAsset(v300, 'spoken', '3.0.0').name, 'Spoken-3.0.0.zip', 'named after the prefix wins');
  const unnamed = rel('x/v1.0.0', ['A-1.0.0.zip', 'B-1.0.0.zip']).assets;
  unnamed[0].size = 9e6;
  assert.equal(pickAsset(unnamed, 'x', '1.0.0').name, 'A-1.0.0.zip', 'otherwise the largest');
  assert.equal(pickAsset(rel('x/v1.0.0', ['notes.txt', 'A-1.0.0.zip']).assets).name, 'A-1.0.0.zip');
});

test('releases are paginated via the Link header and fetched once', async () => {
  const pages = [RELEASES.slice(0, 4), RELEASES.slice(4)];
  /** @type {string[]} */
  const calls = [];
  /** @type {any} */
  const fakeFetch = async (/** @type {string} */ url, /** @type {any} */ init) => {
    calls.push(url);
    assert.equal(init.headers.Authorization, 'Bearer tok');
    const page = url.includes('page=2') ? 1 : 0;
    const headers = new Headers(page === 0 ? { link: '<https://api.github.com/repos/r/x/releases?per_page=100&page=2>; rel="next", <...>; rel="last"' } : {});
    return new Response(JSON.stringify(pages[page]), { status: 200, headers });
  };
  const src = new GitHubSource({ repo: 'r/x', token: 'tok', fetchImpl: fakeFetch });
  const [quests, questsAudio, fr] = await Promise.all(
    ['quests', 'quests-audio', 'quests-audio-frFR'].map((id) => src.latest({ id, tagPrefix: id, kind: 'pack', title: id, optional: false })),
  );
  assert.equal(calls.length, 2);
  assert.equal(quests?.version, '2.2.1');
  assert.equal(quests?.asset.name, 'SpokenQuests-2.2.1.zip');
  assert.equal(quests?.asset.sha256, 'ab'.repeat(32));
  assert.equal(questsAudio?.version, '2.9.0');
  assert.equal(fr?.tag, 'quests-audio-frFR/v0.0.3');
  assert.equal(await src.latest({ id: 'zones', tagPrefix: 'zones', kind: 'addon', title: '', optional: false }), null);
});

test('catalog: English defaults, languages and toggles', () => {
  const ids = (/** @type {any} */ o) => buildCatalog(o).map((i) => i.id);
  assert.deepEqual(ids({ language: 'enUS', includeZones: true, includeBooks: true }),
    ['spoken', 'quests-audio', 'zones-audio', 'books-audio']);
  assert.deepEqual(ids({ language: 'frFR', includeZones: false, includeBooks: true }),
    ['spoken', 'quests-audio', 'books-audio', 'quests-audio-frFR', 'books-audio-frFR']);
  const [sp] = buildCatalog({ language: 'enUS', includeZones: false, includeBooks: true });
  assert.equal(sp.tagPrefix, 'spoken');
  assert.deepEqual(sp.exclude, ['spoken_zones']);
  assert.deepEqual(sp.replaces?.items, ['player', 'quests', 'zones', 'books']);
});

test('a release published without assets falls back to the previous one', async () => {
  const list = [rel('spoken/v3.0.1', []), rel('spoken/v3.0.0', ['Spoken-3.0.0.zip'])];
  /** @type {any} */
  const fakeFetch = async () => new Response(JSON.stringify(list), { status: 200 });
  const src = new GitHubSource({ fetchImpl: fakeFetch });
  const r = await src.latest({ id: 'spoken', tagPrefix: 'spoken', kind: 'addon', title: '', optional: false });
  assert.equal(r?.version, '3.0.0');
  assert.equal(r?.asset.name, 'Spoken-3.0.0.zip');
});
