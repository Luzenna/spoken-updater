// @ts-check
// GitHub Releases source. Lists every release once per run (paginated), then
// answers per-item queries by tag prefix and semver.
import * as semver from '../semver.js';
import { HttpError, USER_AGENT, withRetry } from '../http.js';

export const DEFAULT_REPO = 'rusty-key/spoken-wow';

/**
 * @typedef {{ name: string, size: number, browser_download_url: string, digest?: string | null, state?: string }} GhAsset
 * @typedef {{ tag_name: string, draft: boolean, prerelease: boolean, assets: GhAsset[] }} GhRelease
 */

/**
 * Pick the one zip meant for modern clients (which includes Forever). Spoken
 * publishes a multi-flavor zip plus legacy private-server builds named
 * "<Addon>-WoW_1.12-<ver>.zip"; those must never be chosen.
 * @param {GhAsset[]} assets @returns {GhAsset}
 */
export function pickAsset(assets) {
  const zips = assets.filter(
    (a) => /\.zip$/i.test(a.name) && !/-WoW_\d/i.test(a.name) && (a.state ?? 'uploaded') === 'uploaded',
  );
  if (zips.length === 1) return zips[0];
  if (!zips.length) throw new Error(`no Forever-compatible zip among assets: ${assets.map((a) => a.name).join(', ') || '(none)'}`);
  throw new Error(`ambiguous assets, expected one zip: ${zips.map((a) => a.name).join(', ')}`);
}

/**
 * Releases for one tag prefix, newest first by semver. Drafts, prereleases and
 * tags whose suffix isn't a version are dropped.
 * @param {GhRelease[]} releases @param {string} prefix
 */
export function filterReleases(releases, prefix) {
  const want = prefix + '/';
  return releases
    .filter((r) => !r.draft && !r.prerelease && r.tag_name.startsWith(want))
    .map((r) => ({ r, version: semver.clean(r.tag_name.slice(want.length)) }))
    .filter((x) => x.version !== null && !semver.parse(x.version)?.pre.length)
    .sort((a, b) => semver.compare(/** @type {string} */ (b.version), /** @type {string} */ (a.version)));
}

/** @param {string | null} link */
function nextLink(link) {
  const m = link && /<([^>]+)>;\s*rel="next"/.exec(link);
  return m ? m[1] : null;
}

export class GitHubSource {
  name = 'GitHub';

  /**
   * @param {{ repo?: string, token?: string | null, apiBase?: string, fetchImpl?: typeof fetch, retry?: Parameters<typeof withRetry>[1] }} [opts]
   */
  constructor(opts = {}) {
    this.repo = opts.repo ?? DEFAULT_REPO;
    this.token = opts.token ?? null;
    this.apiBase = opts.apiBase ?? 'https://api.github.com';
    this.fetch = opts.fetchImpl ?? fetch;
    this.retry = opts.retry;
    /** @type {Promise<GhRelease[]> | null} */
    this.cache = null;
  }

  /** @returns {Promise<GhRelease[]>} */
  releases() {
    this.cache ??= this.#fetchAll();
    return this.cache;
  }

  async #fetchAll() {
    /** @type {GhRelease[]} */
    const all = [];
    /** @type {string | null} */
    let url = `${this.apiBase}/repos/${this.repo}/releases?per_page=100`;
    while (url) {
      const page = /** @type {string} */ (url);
      const res = await withRetry(async () => {
        /** @type {Record<string, string>} */
        const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': USER_AGENT };
        // The token only ever goes to the API host.
        if (this.token && new URL(page).host === new URL(this.apiBase).host) headers.Authorization = `Bearer ${this.token}`;
        const r = await this.fetch(page, { headers });
        if (!r.ok) {
          if (r.status === 403 && r.headers.get('x-ratelimit-remaining') === '0' && !this.token) {
            throw Object.assign(new HttpError(page, r.status, r.headers), {
              message: 'GitHub API rate limit reached. Set SPOKEN_GITHUB_TOKEN (or github_token in config) and try again.',
            });
          }
          throw new HttpError(page, r.status, r.headers);
        }
        return r;
      }, this.retry);
      all.push(.../** @type {GhRelease[]} */ (await res.json()));
      url = nextLink(res.headers.get('link'));
    }
    return all;
  }

  /** @param {import('../catalog.js').Item} item @returns {Promise<import('./source.js').Release | null>} */
  async latest(item) {
    const [top] = filterReleases(await this.releases(), item.tagPrefix);
    if (!top) return null;
    const a = pickAsset(top.r.assets);
    const digest = a.digest && /^sha256:([0-9a-f]{64})$/i.exec(a.digest);
    return {
      version: /** @type {string} */ (top.version),
      tag: top.r.tag_name,
      asset: { name: a.name, url: a.browser_download_url, size: a.size, sha256: digest ? digest[1].toLowerCase() : null },
      source: this.name,
    };
  }
}
