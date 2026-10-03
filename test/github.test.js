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
  assert.throws(() => pickAsset(rel('x/v1.0.0', ['A-1.0.0.zip', 'B-1.0.0.zip']).assets), /ambiguous/);
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
    ['player', 'quests', 'zones', 'books', 'quests-audio', 'zones-audio', 'books-audio']);
  assert.deepEqual(ids({ language: 'frFR', includeZones: false, includeBooks: true }),
    ['player', 'quests', 'books', 'quests-audio', 'books-audio', 'quests-audio-frFR', 'books-audio-frFR']);
  assert.equal(buildCatalog({ language: 'enUS', includeZones: true, includeBooks: true })[0].tagPrefix, 'spoken');
});
