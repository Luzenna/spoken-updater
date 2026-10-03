// @ts-check
// Config and state files. Windows: %APPDATA%\spoken-updater (cache under
// %LOCALAPPDATA%). Linux: XDG dirs (~/.config, ~/.cache).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const APP = 'spoken-updater';

/**
 * @typedef {object} Config
 * @property {string} addons_path     overrides detection when set
 * @property {string} client_folder   Forever client folder under the WoW root
 * @property {string} language        enUS, or e.g. frFR to add that language's packs
 * @property {boolean} include_zones
 * @property {boolean} include_books
 * @property {string} github_token
 * @property {boolean} keep_downloads keep zips in the cache after a successful install
 */

/** @type {Config} */
export const DEFAULT_CONFIG = {
  addons_path: '',
  client_folder: '_classic_beta_',
  language: 'enUS',
  include_zones: true,
  include_books: true,
  github_token: '',
  keep_downloads: false,
};

/**
 * @typedef {{ files: number, bytes: number, tocVersion: string | null }} FolderState
 * @typedef {object} ItemState
 * @property {string} tag         release tag installed, e.g. "quests-audio/v2.2.1"
 * @property {string} version     release version installed
 * @property {string} asset
 * @property {string | null} sha256
 * @property {string} installedAt
 * @property {Record<string, FolderState>} folders
 * @typedef {{ schema: 1, installs: Record<string, Record<string, ItemState>> }} State
 */

/** @param {NodeJS.ProcessEnv} [env] */
export function appDirs(env = process.env) {
  if (env.SPOKEN_UPDATER_HOME) {
    return { config: env.SPOKEN_UPDATER_HOME, cache: path.join(env.SPOKEN_UPDATER_HOME, 'cache') };
  }
  if (process.platform === 'win32') {
    const roaming = env.APPDATA ?? path.join(os.homedir(), 'AppData/Roaming');
    const local = env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData/Local');
    return { config: path.join(roaming, APP), cache: path.join(local, APP, 'cache') };
  }
  const cfg = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  const cache = env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return { config: path.join(cfg, APP), cache: path.join(cache, APP) };
}

/** @param {string} file */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT') return null;
    throw new Error(`cannot read ${file}: ${/** @type {Error} */ (e).message}`);
  }
}

/**
 * Write JSON atomically (temp file + rename). Does nothing when the content is
 * unchanged, so a no-op run leaves every file untouched. Returns true if written.
 * @param {string} file @param {unknown} data
 */
export function writeJsonAtomic(file, data) {
  const text = JSON.stringify(data, null, 2) + '\n';
  try {
    if (fs.readFileSync(file, 'utf8') === text) return false;
  } catch { /* missing */ }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
  return true;
}

/** @param {string} dir @returns {Config} */
export function loadConfig(dir) {
  const raw = readJson(path.join(dir, 'config.json')) ?? {};
  return { ...DEFAULT_CONFIG, ...raw };
}

/** @param {string} dir @param {Config} cfg */
export function saveConfig(dir, cfg) {
  return writeJsonAtomic(path.join(dir, 'config.json'), cfg);
}

/** @param {string} dir @returns {State} */
export function loadState(dir) {
  const raw = readJson(path.join(dir, 'state.json'));
  return raw?.schema === 1 ? raw : { schema: 1, installs: {} };
}

/** @param {string} dir @param {State} state */
export function saveState(dir, state) {
  return writeJsonAtomic(path.join(dir, 'state.json'), state);
}

/** State is keyed per AddOns folder so several WoW installs are tracked separately. @param {string} addons */
export function stateKey(addons) {
  const p = path.resolve(addons);
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

/** Token lookup order: SPOKEN_GITHUB_TOKEN, GITHUB_TOKEN, config. @param {Config} cfg @param {NodeJS.ProcessEnv} [env] */
export function githubToken(cfg, env = process.env) {
  return env.SPOKEN_GITHUB_TOKEN || env.GITHUB_TOKEN || cfg.github_token || null;
}
