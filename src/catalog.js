// @ts-check
// The set of things we manage. Only tag prefixes are known here; versions and
// assets are always discovered from the source at run time.
//
// Since Spoken 3.0.0 the player and the Quests/Zones/Books modules ship as one
// addon, "Spoken", in one zip on the spoken/ tag (folders Spoken, Spoken_Quests,
// Spoken_Zones, Spoken_Books, SpokenContributions). The 2.x addons (SpokenPlayer,
// SpokenQuests, SpokenZones, SpokenBooks, on the spoken/, quests/, zones/ and
// books/ tags) are retired; their folders must go when 3.x goes in, or both
// generations load and every line is voiced twice.

/**
 * @typedef {'addon' | 'pack'} Kind
 * @typedef {object} Item
 * @property {string} id
 * @property {string} tagPrefix
 * @property {Kind} kind
 * @property {string} title
 * @property {boolean} optional     missing upstream means "skip with a notice"
 * @property {string[]} [exclude]   folders in the zip not to install (lower case)
 * @property {{ items: string[], folders: string[] }} [replaces]  retired items/folders this item supersedes
 * @typedef {{ language: string, includeZones: boolean, includeBooks: boolean }} CatalogOptions
 */

/** Item ids of the 2.x addons, which earlier versions of this tool installed. */
export const RETIRED_ITEMS = ['player', 'quests', 'zones', 'books'];
/** Their folders (the same list Spoken's own Core.lua warns about, minus the non-Spoken-named placeholders). */
export const RETIRED_FOLDERS = ['SpokenPlayer', 'SpokenQuests', 'SpokenZones', 'SpokenBooks'];

/** @param {string} id @param {string} title @param {Kind} kind @param {boolean} [optional] @returns {Item} */
const pack = (id, title, kind, optional = false) => ({ id, tagPrefix: id, kind, title, optional });

/**
 * Items to manage, in install order: the addon first, then the voice packs.
 * @param {CatalogOptions} opts @returns {Item[]}
 */
export function buildCatalog(opts) {
  const lang = opts.language && opts.language !== 'enUS' ? opts.language : null;
  const exclude = [];
  if (!opts.includeZones) exclude.push('spoken_zones');
  if (!opts.includeBooks) exclude.push('spoken_books');
  /** @type {Item[]} */
  const items = [{
    id: 'spoken', tagPrefix: 'spoken', kind: 'addon', title: 'Spoken (player, Quests, Zones, Books)', optional: false,
    exclude, replaces: { items: RETIRED_ITEMS, folders: RETIRED_FOLDERS },
  }];

  items.push(pack('quests-audio', 'Spoken Quests Audio (All)', 'pack'));
  if (opts.includeZones) items.push(pack('zones-audio', 'Spoken Zones Audio', 'pack'));
  if (opts.includeBooks) items.push(pack('books-audio', 'Spoken Books Audio', 'pack'));

  // Language packs install alongside the English ones. Not every language exists
  // for every pack, so they are optional.
  if (lang) {
    items.push(pack(`quests-audio-${lang}`, `Spoken Quests Audio (${lang})`, 'pack', true));
    if (opts.includeZones) items.push(pack(`zones-audio-${lang}`, `Spoken Zones Audio (${lang})`, 'pack', true));
    if (opts.includeBooks) items.push(pack(`books-audio-${lang}`, `Spoken Books Audio (${lang})`, 'pack', true));
  }
  return items;
}

/** Valid language codes look like enUS, frFR, zhTW. @param {string} s */
export function isLanguageCode(s) {
  return /^[a-z]{2}[A-Z]{2}$/.test(s);
}
