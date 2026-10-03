// @ts-check
// Reads WoW .toc metadata (## Key: Value lines).
import fs from 'node:fs';
import path from 'node:path';

export const FOREVER_INTERFACE = 16001;

// Suffixes a client may load instead of the plain <Folder>.toc.
// Forever/Camelot come from Wago's flavor table; Mainline is what Spoken ships with 16001 in it.
const TOC_SUFFIX = /^(.+?)(?:[-_](?:Mainline|Vanilla|Classic|TBC|BCC|Wrath|WOTLKC|Cata|Mists|Forever|Camelot))?\.toc$/i;

/**
 * @typedef {{ version: string | null, interfaces: number[], partOf: string | null, fields: Record<string, string> }} Toc
 */

/** @param {string} text @returns {Toc} */
export function parseToc(text) {
  /** @type {Record<string, string>} */
  const fields = {};
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const m = /^##\s*([^:]+?)\s*:\s*(.*?)\s*$/.exec(raw);
    if (m && !(m[1].toLowerCase() in fields)) fields[m[1].toLowerCase()] = m[2];
  }
  const interfaces = (fields['interface'] ?? '')
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);
  return {
    version: fields['version'] || null,
    interfaces,
    partOf: fields['x-part-of'] || null,
    fields,
  };
}

/**
 * The folder name a .toc file belongs to, if its name matches the WoW naming rules.
 * @param {string} file
 */
export function tocOwner(file) {
  const m = TOC_SUFFIX.exec(file);
  return m ? m[1] : null;
}

/**
 * All .toc files inside an addon folder that belong to that folder (base and suffixed).
 * The base <Folder>.toc comes first.
 * @param {string} dir @returns {string[]} absolute paths
 */
export function tocFiles(dir) {
  const name = path.basename(dir);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = entries
    .filter((e) => e.isFile() && tocOwner(e.name)?.toLowerCase() === name.toLowerCase())
    .map((e) => e.name);
  out.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return out.map((f) => path.join(dir, f));
}

/** Parsed base .toc (or the first matching suffixed one) of an addon folder. @param {string} dir */
export function readFolderToc(dir) {
  const files = tocFiles(dir);
  if (!files.length) return null;
  return parseToc(fs.readFileSync(files[0], 'utf8'));
}

/** True if any .toc of the folder lists the given interface. @param {string} dir */
export function folderSupports(dir, iface = FOREVER_INTERFACE) {
  return tocFiles(dir).some((f) => parseToc(fs.readFileSync(f, 'utf8')).interfaces.includes(iface));
}
