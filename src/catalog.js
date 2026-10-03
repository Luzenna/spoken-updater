// @ts-check
// The set of things we manage. Only tag prefixes are known here; versions and
// assets are always discovered from the source at run time.

/**
 * @typedef {'addon' | 'pack'} Kind
 * @typedef {{ id: string, tagPrefix: string, kind: Kind, title: string, optional: boolean }} Item
 * @typedef {{ language: string, includeZones: boolean, includeBooks: boolean }} CatalogOptions
 */

/** @param {string} id @param {string} title @param {Kind} kind @param {boolean} [optional] @returns {Item} */
const item = (id, title, kind, optional = false) => ({ id, tagPrefix: id === 'player' ? 'spoken' : id, kind, title, optional });

/**
 * Items to manage, in install order: the shared player first, then the feature
 * addons, then the voice packs.
 * @param {CatalogOptions} opts @returns {Item[]}
 */
export function buildCatalog(opts) {
  const lang = opts.language && opts.language !== 'enUS' ? opts.language : null;
  /** @type {Item[]} */
  const items = [item('player', 'Spoken Player', 'addon'), item('quests', 'Spoken Quests', 'addon')];
  if (opts.includeZones) items.push(item('zones', 'Spoken Zones', 'addon'));
  if (opts.includeBooks) items.push(item('books', 'Spoken Books', 'addon'));

  items.push(item('quests-audio', 'Spoken Quests Audio (All)', 'pack'));
  if (opts.includeZones) items.push(item('zones-audio', 'Spoken Zones Audio', 'pack'));
  if (opts.includeBooks) items.push(item('books-audio', 'Spoken Books Audio', 'pack'));

  // Language packs install alongside the English ones. Not every language exists
  // for every pack, so they are optional: missing upstream means "skip with a notice".
  if (lang) {
    items.push(item(`quests-audio-${lang}`, `Spoken Quests Audio (${lang})`, 'pack', true));
    if (opts.includeZones) items.push(item(`zones-audio-${lang}`, `Spoken Zones Audio (${lang})`, 'pack', true));
    if (opts.includeBooks) items.push(item(`books-audio-${lang}`, `Spoken Books Audio (${lang})`, 'pack', true));
  }
  return items;
}

/** Valid language codes look like enUS, frFR, zhTW. @param {string} s */
export function isLanguageCode(s) {
  return /^[a-z]{2}[A-Z]{2}$/.test(s);
}
