import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface VersionInfo {
  /** Git branch the folder is on (absent when detached or not a git folder). */
  branch?: string;
  /** Short commit id. */
  commit?: string;
}

/** Which branch and commit the folder is on, read straight from .git so no git command is needed. */
export function readVersion(repoRoot: string): VersionInfo {
  try {
    const git = join(repoRoot, '.git');
    const head = readFileSync(join(git, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref: ')) return { commit: head.slice(0, 7) };
    const ref = head.slice('ref: '.length);
    const branch = ref.replace(/^refs\/heads\//, '');
    const loose = join(git, ref);
    let sha: string | undefined;
    if (existsSync(loose)) sha = readFileSync(loose, 'utf8').trim();
    else if (existsSync(join(git, 'packed-refs'))) {
      sha = readFileSync(join(git, 'packed-refs'), 'utf8')
        .split(/\r?\n/)
        .find((line) => line.endsWith(` ${ref}`))
        ?.split(' ')[0];
    }
    return sha ? { branch, commit: sha.slice(0, 7) } : { branch };
  } catch {
    return {};
  }
}
