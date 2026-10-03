// @ts-check
// Plain ASCII output that reads well in Konsole and Windows conhost.

let verbose = false;

/** @param {boolean} v */
export function setVerbose(v) {
  verbose = v;
}

/** @param {string} msg */
export function info(msg) {
  process.stdout.write(msg + '\n');
}

/** @param {string} msg */
export function warn(msg) {
  process.stdout.write('WARNING: ' + msg + '\n');
}

/** @param {string} msg */
export function error(msg) {
  process.stderr.write('ERROR: ' + msg + '\n');
}

/** @param {string} msg */
export function debug(msg) {
  if (verbose) process.stdout.write('  . ' + msg + '\n');
}

/** Human-readable byte count, e.g. "1.40 GB". @param {number} n */
export function bytes(n) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return i === 0 ? `${n} B` : `${n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0)} ${units[i]}`;
}
