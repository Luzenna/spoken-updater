#!/usr/bin/env node
// @ts-check
// spoken-updater: install and update the Spoken voiceover addons and voice packs
// for World of Warcraft: Forever. No arguments = install/update everything.
import { parseArgs } from 'node:util';
import * as log from './log.js';
import { appDirs, loadConfig, githubToken } from './config.js';
import { GitHubSource } from './sources/github.js';
import { isLanguageCode } from './catalog.js';
import { trySelfUpdate } from './selfupdate.js';
import { update, status, detectCmd, clean, UsageError } from './app.js';

// Stamped in by scripts/build.mjs from package.json (CI sets it to the release version).
const VERSION = /** @type {any} */ (globalThis).__SPOKEN_VERSION__ ?? 'dev';

const HELP = `spoken-updater ${VERSION} - Spoken voiceover addons and voice packs for WoW: Forever

Usage: spoken-updater [command] [options]

Commands:
  update                 install or update whatever is needed (default)
  install --only <ids>   (re)install the named items, comma-separated
  status                 show installed vs latest for every item
  detect                 list the AddOns folders found on this computer
  clean                  prune the download cache and leftover temp folders

Options:
  --addons <path>   use this Interface/AddOns folder
  --lang <code>     also install voice packs in this language (e.g. frFR, deDE)
  --dry-run         show what update would do, change nothing
  --yes, -y         never ask questions (for shortcuts and scripts)
  --force           install even while WoW is running
  --no-self-update  don't check GitHub for a newer spoken-updater first
  --pause-on-exit   wait for Enter (max 30 s) before closing the window
  --verbose, -v     more detail
  --version, --help

Items: spoken, quests-audio, zones-audio, books-audio,
       and quests-audio-<lang>, zones-audio-<lang>, books-audio-<lang> with --lang.
Config file: ${appDirs().config}${process.platform === 'win32' ? '\\' : '/'}config.json
GitHub token (optional, for rate limits): SPOKEN_GITHUB_TOKEN or GITHUB_TOKEN.`;

/** @param {string[]} argv */
export async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      addons: { type: 'string' },
      lang: { type: 'string' },
      only: { type: 'string' },
      'dry-run': { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      force: { type: 'boolean' },
      'no-self-update': { type: 'boolean' },
      'pause-on-exit': { type: 'boolean' },
      verbose: { type: 'boolean', short: 'v' },
      version: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) return log.info(HELP), 0;
  if (values.version) return log.info(VERSION), 0;
  log.setVerbose(!!values.verbose);

  const cmd = positionals[0] ?? 'update';
  if (positionals.length > 1) throw new UsageError(`unexpected argument: ${positionals[1]}`);
  if (values.lang && !isLanguageCode(values.lang)) throw new UsageError(`--lang must look like frFR or deDE, got "${values.lang}"`);

  const dirs = appDirs();
  const cfg = loadConfig(dirs.config);
  const deps = {
    source: new GitHubSource({ token: githubToken(cfg) }),
    configDir: dirs.config,
    cacheDir: dirs.cache,
  };
  const opts = {
    addons: values.addons,
    lang: values.lang,
    yes: !!values.yes,
    force: !!values.force,
    dryRun: !!values['dry-run'],
    only: values.only ? values.only.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
  };

  switch (cmd) {
    case 'update':
      if (opts.only) throw new UsageError('use "install --only <items>" to pick items');
      if (!opts.dryRun && !values['no-self-update']) await trySelfUpdate(VERSION, dirs.cache);
      return update(opts, deps);
    case 'install':
      if (!opts.only?.length) throw new UsageError('install needs --only <item>[,<item>]');
      if (!opts.dryRun && !values['no-self-update']) await trySelfUpdate(VERSION, dirs.cache);
      return update(opts, deps);
    case 'status':
      return status(opts, deps);
    case 'detect':
      return detectCmd(opts, deps);
    case 'clean':
      return clean(opts, deps);
    default:
      throw new UsageError(`unknown command "${cmd}". Try --help.`);
  }
}

/** Keep the console window open briefly (Steam shortcut / double-click). */
async function pause() {
  if (!process.stdin.isTTY) {
    // No keyboard to press Enter on (e.g. a Steam shortcut): just keep the window up.
    await new Promise((r) => setTimeout(r, 30_000));
    return;
  }
  process.stdout.write('\nPress Enter to close (closes by itself in 30 s)...');
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 30_000);
    process.stdin.once('data', () => (clearTimeout(t), resolve(undefined)));
    process.stdin.resume();
  });
  process.stdin.pause();
}

// No top-level await: the single-executable build bundles this file as CommonJS.
async function run() {
  const argv = process.argv.slice(2);
  let code;
  try {
    code = await main(argv);
  } catch (e) {
    if (e instanceof UsageError || /** @type {any} */ (e)?.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
      log.error(/** @type {Error} */ (e).message);
      code = 2;
    } else {
      log.error(/** @type {Error} */ (e)?.message ?? String(e));
      if (argv.includes('--verbose') || argv.includes('-v')) console.error(e);
      code = 1;
    }
  }
  if (argv.includes('--pause-on-exit')) await pause();
  process.exitCode = code ?? 0;
}

run();
