import { describe, it, expect, mock, afterEach, beforeEach, spyOn } from 'bun:test';

// Define the mock functions so we can manipulate them in tests
const spawnSyncMock = mock(() => ({
  status: 0,
  stdout: Buffer.from('mock-hash-123\n')
}));

mock.module('child_process', () => ({
  spawnSync: spawnSyncMock
}));

const listRemotesMock = mock(async () => [{ remote: 'origin', url: 'https://github.com/test/repo.git' }]);
const logMock = mock(async () => [{
  oid: 'mock-commit-hash',
  commit: {
    message: 'mock commit message',
    author: { name: 'Test Author' },
    committer: { name: 'Test Committer', timestamp: 1625097600 }
  }
}]);

mock.module('isomorphic-git', () => ({
  default: {
    listRemotes: listRemotesMock,
    log: logMock
  }
}));

import { getCurrentCommit, getCommitInfo } from '../src/utils/git';

describe('git utils', () => {
  afterEach(() => {
    spawnSyncMock.mockClear();
    listRemotesMock.mockClear();
    logMock.mockClear();
  });

  describe('getCurrentCommit', () => {
    it('should return the commit hash when git command succeeds', () => {
      spawnSyncMock.mockImplementationOnce(() => ({
        status: 0,
        stdout: Buffer.from('abcdef1234567890\n')
      }));

      const commit = getCurrentCommit();
      expect(commit).toBe('abcdef1234567890');
      expect(spawnSyncMock).toHaveBeenCalledWith('git', ['rev-parse', 'HEAD']);
    });

    it('should throw an error when git command fails', () => {
      spawnSyncMock.mockImplementationOnce(() => ({
        status: 128,
        stdout: Buffer.from(''),
        stderr: Buffer.from('fatal: not a git repository (or any of the parent directories): .git\n')
      }));

      expect(() => getCurrentCommit()).toThrow('Not a git repository');
      expect(spawnSyncMock).toHaveBeenCalledWith('git', ['rev-parse', 'HEAD']);
    });
  });

  describe('getCommitInfo', () => {
    it('should return correct commit info', async () => {
      const info = await getCommitInfo();

      expect(info).toBeDefined();
      expect(info?.hash).toBe('mock-commit-hash');
      expect(info?.message).toBe('mock commit message');
      expect(info?.author).toBe('Test Author');
      expect(info?.timestamp).toBe('1625097600');
      expect(info?.origin).toBe('https://github.com/test/repo.git');

      expect(listRemotesMock).toHaveBeenCalled();
      expect(logMock).toHaveBeenCalled();
    });

    it('should handle missing author name by falling back to committer name', async () => {
      logMock.mockImplementationOnce(async () => [{
        oid: 'mock-commit-hash-2',
        commit: {
          message: 'another message',
          author: { name: '' },
          committer: { name: 'Fallback Committer', timestamp: 1625098000 }
        }
      }]);

      const info = await getCommitInfo();
      expect(info?.author).toBe('Fallback Committer');
    });

    it('should return undefined and log error when git operations fail', async () => {
      const originalConsoleError = console.error;
      const consoleErrorMock = mock();
      console.error = consoleErrorMock;

      listRemotesMock.mockImplementationOnce(async () => {
        throw new Error('Git operation failed');
      });

      const info = await getCommitInfo();

      expect(info).toBeUndefined();
      expect(consoleErrorMock).toHaveBeenCalled();

      console.error = originalConsoleError;
    });
  });
});
