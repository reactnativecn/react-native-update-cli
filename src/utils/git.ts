import { execFile as execFileCallback, spawnSync } from 'child_process';
import { promisify } from 'util';

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  timestamp: string;
  origin?: string;
}

const execFile = promisify(execFileCallback);

export function getCurrentCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD']);
  if (result.status !== 0) {
    throw new Error('Not a git repository');
  }
  return result.stdout.toString().trim();
}

async function gitOutput(args: string[], cwd = process.cwd()): Promise<string> {
  const { stdout } = await execFile('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  return stdout.trimEnd();
}

async function getRemoteOrigin(cwd: string) {
  const origin = await gitOutput(['remote', 'get-url', 'origin'], cwd).catch(
    () => '',
  );
  if (origin) {
    return origin;
  }

  const remotes = await gitOutput(['remote'], cwd).catch(() => '');
  const firstRemote = remotes.split(/\r?\n/).find(Boolean);
  if (!firstRemote) {
    return undefined;
  }

  return gitOutput(['remote', 'get-url', firstRemote], cwd).catch(
    () => undefined,
  );
}

export async function getCommitInfo(): Promise<CommitInfo | undefined> {
  try {
    const gitRoot = await gitOutput(['rev-parse', '--show-toplevel']);
    const [hash, message, author, timestamp, origin] = await Promise.all([
      gitOutput(['rev-parse', 'HEAD'], gitRoot),
      gitOutput(['log', '-1', '--format=%B'], gitRoot),
      gitOutput(['log', '-1', '--format=%an'], gitRoot),
      gitOutput(['log', '-1', '--format=%ct'], gitRoot),
      getRemoteOrigin(gitRoot),
    ]);

    return {
      hash,
      message,
      author,
      timestamp,
      origin,
    };
  } catch (_error) {
    return;
  }
}
