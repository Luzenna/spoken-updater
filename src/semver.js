// @ts-check
// Minimal semver: MAJOR.MINOR.PATCH with optional leading "v" and optional -prerelease.
// Build metadata (+...) is ignored, as the spec says.

const RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * @typedef {{ major: number, minor: number, patch: number, pre: string[] }} SemVer
 */

/** @param {string} s @returns {SemVer | null} */
export function parse(s) {
  const m = RE.exec(String(s).trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] };
}

/** @param {string} s */
export function valid(s) {
  return parse(s) !== null;
}

/** Strip a leading "v". Returns null for invalid input. @param {string} s */
export function clean(s) {
  const v = parse(s);
  if (!v) return null;
  return `${v.major}.${v.minor}.${v.patch}` + (v.pre.length ? `-${v.pre.join('.')}` : '');
}

/**
 * Compare two versions. Invalid versions sort below every valid one.
 * @param {string} a @param {string} b @returns {-1|0|1}
 */
export function compare(a, b) {
  const x = parse(a), y = parse(b);
  if (!x && !y) return 0;
  if (!x) return -1;
  if (!y) return 1;
  for (const k of /** @type {const} */ (['major', 'minor', 'patch'])) {
    if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  }
  // A version without prerelease is greater than one with it.
  if (!x.pre.length && !y.pre.length) return 0;
  if (!x.pre.length) return 1;
  if (!y.pre.length) return -1;
  const n = Math.max(x.pre.length, y.pre.length);
  for (let i = 0; i < n; i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) {
      if (+p !== +q) return +p < +q ? -1 : 1;
    } else if (pn !== qn) {
      return pn ? -1 : 1; // numeric identifiers sort lower
    } else if (p !== q) {
      return p < q ? -1 : 1;
    }
  }
  return 0;
}

/** Highest valid version in the list, or null. @param {string[]} list */
export function max(list) {
  /** @type {string | null} */
  let best = null;
  for (const v of list) {
    if (!valid(v)) continue;
    if (best === null || compare(v, best) > 0) best = v;
  }
  return best;
}
