// @ts-check
// One spoken-updater at a time: a second copy (e.g. a Steam shortcut launched
// twice) must not roll back the first one's swap or append to the same download.
import fs from 'node:fs';
import path from 'node:path';

/** @param {number} pid */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return /** @type {NodeJS.ErrnoException} */ (e).code === 'EPERM';
  }
}

/**
 * Take the lock or throw. Returns a release function. A lock left behind by a
 * process that no longer exists is taken over.
 * @param {string} dir
 */
export function acquireLock(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'spoken-updater.lock');
  for (let i = 0; i < 2; i++) {
    try {
      const fd = fs.openSync(file, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return () => fs.rmSync(file, { force: true });
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
      const pid = Number(fs.readFileSync(file, 'utf8').trim());
      if (pid && pid !== process.pid && alive(pid)) {
        throw Object.assign(new Error(`another spoken-updater is already running (pid ${pid}). Wait for it to finish.`), { usage: true });
      }
      fs.rmSync(file, { force: true }); // stale
    }
  }
  throw new Error(`could not take the lock ${file}`);
}
