import fs from 'fs';
import path from 'path';
import git from 'isomorphic-git';

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  timestamp: string;
  origin: string;
}

function findGitRoot(dir = process.cwd()) {
  const gitRoot = fs.readdirSync(dir).find((dir) => dir === '.git');
  if (gitRoot) {
    // console.log({ gitRoot });
    return path.join(dir, gitRoot);
  }
  const parentDir = path.dirname(dir);
  if (parentDir === dir) {
    return null;
  }
  return findGitRoot(parentDir);
}

const gitRoot = findGitRoot();

export async function getCommitInfo(): Promise<CommitInfo | undefined> {
  if (!gitRoot) {
    return;
  }
  try {
    const remotes = await git.listRemotes({ fs, gitdir: gitRoot });
    const origin =
      remotes.find((remote) => remote.remote === 'origin') || remotes[0];
    const { commit, oid } = (
      await git.log({ fs, gitdir: gitRoot, depth: 1 })
    )[0];
    return {
      hash: oid,
      message: commit.message,
      author: commit.author.name || commit.committer.name,
      timestamp: String(commit.committer.timestamp),
      origin: origin?.url,
    };
  } catch (error) {
    console.error(error);
    return;
  }
}
