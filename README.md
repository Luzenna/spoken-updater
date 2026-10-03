# spoken-updater

Installs and updates the [Spoken](https://github.com/rusty-key/spoken-wow) voiceover addons and their voice packs for **World of Warcraft: Forever** (1.60.x, Interface 16001), on Windows 10/11 and the Steam Deck.

It downloads only what changed. If everything is already current, it downloads nothing and changes no files.

## Use

```
spoken-updater                     install or update everything (English)
spoken-updater status              installed vs latest for every item
spoken-updater update --dry-run    show what would happen
spoken-updater install --only quests-audio
spoken-updater detect              list the AddOns folders found
spoken-updater clean               prune the download cache
spoken-updater --lang frFR         also install the French voice packs
```

From source (needs Node 22+): `npm install`, then `npm start`. With no arguments, it installs or updates English.

**Installed by default:**
- the addons SpokenPlayer, SpokenQuests, SpokenZones and SpokenBooks
- the voice packs Spoken Quests Audio (the "All" bundle), Spoken Zones Audio and Spoken Books Audio

That's about 2.3 GB on first install.

**Item ids:** `player`, `quests`, `zones`, `books`, `quests-audio`, `zones-audio`, `books-audio`. With a language set you also get `quests-audio-<lang>`, `zones-audio-<lang>` and `books-audio-<lang>`.

**Flags:**
- `--addons <path>`: use this AddOns folder.
- `--yes`: never prompt.
- `--force`: install even while WoW is running.
- `--pause-on-exit`: keep the window open at the end.
- `--verbose`: print more detail.

**Exit codes:** 0 ok, 1 an item failed, 2 usage/detection problem or WoW running.

### Steam Deck

1. Switch to Desktop Mode and copy `spoken-updater-linux-x64` to your home folder, e.g. `~/spoken-updater`.
2. Run `chmod +x ~/spoken-updater` in Konsole, then `~/spoken-updater`.
3. Optional: in Steam, choose *Add a Non-Steam Game*, pick the file, and set its launch options to `--yes --pause-on-exit`.

The tool searches for your WoW install under:
- Proton prefixes, in `~/.local/share/Steam/steamapps/compatdata` and Steam libraries on the SD card under `/run/media`
- Lutris (`~/Games`), Heroic (`~/Games/Heroic/Prefixes`), Bottles and `~/.wine`

### Windows

Run `spoken-updater.exe` in a terminal, or double-click it. The tool finds WoW through Battle.net's `product.db`, the Battle.net config, the registry, and the common install folders.

## Config

- **Windows:** `%APPDATA%\spoken-updater\config.json`. The cache is in `%LOCALAPPDATA%\spoken-updater\cache`.
- **Linux:** `~/.config/spoken-updater/config.json`. The cache is in `~/.cache/spoken-updater`.

```json
{
  "addons_path": "",
  "client_folder": "_classic_beta_",
  "language": "enUS",
  "include_zones": true,
  "include_books": true,
  "github_token": "",
  "keep_downloads": false
}
```

- `addons_path`: overrides detection. When several installs are found, the tool asks once and saves your choice here.
- `client_folder`: the Forever client folder. Change it if Blizzard renames the folder at launch. Clients that report game version 1.60.x are detected regardless of folder name.
- `github_token`: optional, only needed if you hit GitHub's rate limit of 60 requests an hour. Takes `SPOKEN_GITHUB_TOKEN` or `GITHUB_TOKEN` from the environment too.
- `keep_downloads`: keep zips after a successful install. By default they are deleted to save space, but kept after a failure so a retry doesn't download them again.

`state.json`, next to the config, records what was installed. Each folder's `.toc` is the source of truth. An item is reinstalled if:
- its folder or `.toc` disappears, or
- its file count or size changes by more than 10%.

## Where things come from

Everything comes from [GitHub Releases](https://github.com/rusty-key/spoken-wow/releases). One tag prefix maps to each item:

| Item | Tag prefix |
|---|---|
| `player` | `spoken/` |
| `quests` | `quests/` |
| `zones` | `zones/` |
| `books` | `books/` |
| `quests-audio` | `quests-audio/` |
| `zones-audio` | `zones-audio/` |
| `books-audio` | `books-audio/` |
| language packs | e.g. `quests-audio-frFR/` |

**How the version and file are chosen:**
- The newest stable version is picked by semver.
- The multi-flavor zip is used, not the `-WoW_1.12`-style legacy builds.
- Each download is checked against GitHub's sha256 digest.

**Not offered:**
- The old faction-split quest packs stopped at v2.0.0 and don't support Forever.
- There is no 64 kbps zones pack.

Sources plug in through `src/sources/source.js`. A Wago source is possible, but Wago's API needs a personal API key.

## How it installs safely

1. **WoW must be closed.** The tool refuses to run while `Wow*.exe` is running, including under Wine/Proton, unless you pass `--force`.
2. **Disk space is checked first**, for both the download cache and the AddOns drive.
3. **Downloads resume and retry.** They resume with HTTP Range and retry with backoff.
4. **Zips are unpacked into `Interface/.spoken-updater`**, on the same drive as AddOns. Paths are normalised (backslashes, wrapper folders, double nesting) and unsafe paths are refused.
5. **Only folders named `Spoken*` are written.** Other addons and `WTF/` are never touched. The upstream zips also contain `VoiceOverRedux` and `ZoneLore`. These are empty placeholders named after the addons' old names, only useful for carrying over settings from those old addons, so they are not installed.
6. **Folders are swapped in by renaming.** Old folders move to a backup and new ones move in. If anything fails, everything is moved back. A journal lets the next run finish or undo a swap that was interrupted by a crash.

## Development

```
npm test           # node:test, no network, fake zips and fake WoW/Steam Deck trees
npm run build      # dist/spoken-updater.exe and dist/spoken-updater-linux-x64
make               # same, via make
```

The build bundles `src/` with esbuild into a Node [single executable application](https://nodejs.org/api/single-executable-applications.html). It downloads the official Node binaries for each platform, checks them against nodejs.org's SHASUMS256, and injects the bundle. Both targets build from Windows or Linux. Each binary is about 85–120 MB because it contains Node.

## Releases

Every push to `main` that touches `src/`, `scripts/` or `package*.json` is released by
`.github/workflows/release.yml`. It runs the tests on Ubuntu and Windows, builds both
executables, smoke-tests each on its own OS, and publishes a GitHub release with
`SHA256SUMS.txt`.

The version comes from the latest `vX.Y.Z` tag, bumped by the subject lines of the pushed commits:

| In a commit subject | Effect |
|---|---|
| (nothing) | patch: 0.1.0 -> 0.1.1 |
| `#minor` or `[minor]` | minor: 0.1.1 -> 0.2.0 |
| `#major` or `[major]` | major: 0.2.0 -> 1.0.0 |
| `#norelease` | skip releasing this push |
| `#release` | release even if only docs/CI changed |

The first release uses the version in `package.json`. You can also start a release by hand from the Actions tab.
