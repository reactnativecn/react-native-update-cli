// The handful of fs-extra conveniences the CLI used, on plain node:fs.

import fs from 'fs';
import path from 'path';

/** `rm -rf`: no error when the path is already gone. */
export function remove(target: string): Promise<void> {
  return fs.promises.rm(target, { recursive: true, force: true });
}

export function removeSync(target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
}

export function ensureDirSync(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function pathExists(target: string): Promise<boolean> {
  return fs.promises.access(target).then(
    () => true,
    () => false,
  );
}

/** Deletes everything inside `dir`, creating it when missing. */
export function emptyDirSync(dir: string): void {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    // only a missing directory is created; an unreadable one must not pass
    // for emptied
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    ensureDirSync(dir);
    return;
  }
  for (const name of names) removeSync(path.join(dir, name));
}

/**
 * Moves `src` to `dest`, replacing it. Creates the parent of `dest`, and
 * falls back to copy + delete when the two are on different devices.
 */
export function moveSync(src: string, dest: string): void {
  ensureDirSync(path.dirname(dest));
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    removeSync(dest);
    fs.cpSync(src, dest, { recursive: true });
    removeSync(src);
  }
}
