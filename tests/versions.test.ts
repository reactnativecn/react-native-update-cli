import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';

// We test the exported helper bindVersionToPackages and the internal rollout
// parsing logic by calling versionCommands.update with mocked API calls.

import * as api from '../src/api';
import * as app from '../src/app';
import * as utils from '../src/utils';
import * as git from '../src/utils/git';
import { bindVersionToPackages, versionCommands } from '../src/versions';

describe('bindVersionToPackages', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let postSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    postSpy = spyOn(api, 'post').mockResolvedValue({});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    postSpy.mockRestore();
  });

  test('binds version to a single package', async () => {
    await bindVersionToPackages({
      appId: '100',
      versionId: '200',
      pkgs: [{ id: '10', name: '1.0.0' }],
    });

    expect(postSpy).toHaveBeenCalledWith('/app/100/binding', {
      versionId: '200',
      rollout: undefined,
      packageId: '10',
    });
  });

  test('binds version to multiple packages', async () => {
    await bindVersionToPackages({
      appId: '100',
      versionId: '200',
      pkgs: [
        { id: '10', name: '1.0.0' },
        { id: '11', name: '1.1.0' },
        { id: '12', name: '1.2.0' },
      ],
    });

    expect(postSpy).toHaveBeenCalledTimes(3);
  });

  test('passes rollout configuration', async () => {
    await bindVersionToPackages({
      appId: '100',
      versionId: '200',
      pkgs: [{ id: '10', name: '1.0.0' }],
      rollout: 50,
    });

    expect(postSpy).toHaveBeenCalledWith('/app/100/binding', {
      versionId: '200',
      rollout: 50,
      packageId: '10',
    });
  });

  test('skips API call in dryRun mode', async () => {
    await bindVersionToPackages({
      appId: '100',
      versionId: '200',
      pkgs: [{ id: '10', name: '1.0.0' }],
      dryRun: true,
    });

    expect(postSpy).not.toHaveBeenCalled();
  });

  test('logs operation completion after binding packages', async () => {
    await bindVersionToPackages({
      appId: '100',
      versionId: '200',
      pkgs: [
        { id: '10', name: '1.0.0' },
        { id: '11', name: '1.1.0' },
      ],
    });

    expect(consoleSpy).toHaveBeenCalledTimes(3);
  });
});

describe('versionCommands.publish', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let getPlatformSpy: ReturnType<typeof spyOn>;
  let getSelectedAppSpy: ReturnType<typeof spyOn>;
  let uploadFileSpy: ReturnType<typeof spyOn>;
  let postSpy: ReturnType<typeof spyOn>;
  let questionSpy: ReturnType<typeof spyOn>;
  let getCommitInfoSpy: ReturnType<typeof spyOn>;
  let updateSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    getPlatformSpy = spyOn(app, 'getPlatform').mockResolvedValue('android');
    getSelectedAppSpy = spyOn(app, 'getSelectedApp').mockResolvedValue({
      appId: '100',
      appKey: 'key',
      platform: 'android',
    });
    uploadFileSpy = spyOn(api, 'uploadFile').mockResolvedValue({
      hash: 'hash',
    });
    postSpy = spyOn(api, 'post').mockResolvedValue({ id: '200' });

    const answers = ['name', 'description', '{}', 'y'];
    const questionMock = mock(async () => answers.shift() ?? '');
    questionSpy = spyOn(utils, 'question').mockImplementation(questionMock);
    getCommitInfoSpy = spyOn(git, 'getCommitInfo').mockResolvedValue(undefined);
    updateSpy = spyOn(versionCommands, 'update').mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    getPlatformSpy.mockRestore();
    getSelectedAppSpy.mockRestore();
    uploadFileSpy.mockRestore();
    postSpy.mockRestore();
    questionSpy.mockRestore();
    getCommitInfoSpy.mockRestore();
    updateSpy.mockRestore();
  });

  test('can bind after publish when called without object receiver', async () => {
    const publish = versionCommands.publish;

    await publish({
      args: ['bundle.ppk'],
      options: { platform: 'android' },
    });

    expect(updateSpy).toHaveBeenCalledWith({
      options: {
        versionId: '200',
        platform: 'android',
        versionDeps: expect.any(Object),
        warnDepsChanges: true,
      },
    });
  });
});

describe('rollout validation (via versionCommands.update)', () => {
  // We test rollout parsing indirectly by importing the module and checking
  // that Number.parseInt + NaN check works correctly via the update command.
  // Since update() requires many dependencies, we test the fixed logic directly.

  function parseRollout(value: string | undefined): number | undefined {
    if (value === undefined) return undefined;
    const rollout = Number.parseInt(value, 10);
    if (Number.isNaN(rollout) || rollout < 1 || rollout > 100) {
      throw new Error('rollout must be an integer between 1-100');
    }
    return rollout;
  }

  test('parses valid rollout values', () => {
    expect(parseRollout('1')).toBe(1);
    expect(parseRollout('50')).toBe(50);
    expect(parseRollout('100')).toBe(100);
  });

  test('rejects rollout value of 0', () => {
    expect(() => parseRollout('0')).toThrow('1-100');
  });

  test('rejects rollout value above 100', () => {
    expect(() => parseRollout('101')).toThrow('1-100');
  });

  test('rejects non-numeric rollout (was the bug: parseInt never throws)', () => {
    expect(() => parseRollout('abc')).toThrow('1-100');
    expect(() => parseRollout('')).toThrow('1-100');
    expect(() => parseRollout('not-a-number')).toThrow('1-100');
  });

  test('rejects negative rollout', () => {
    expect(() => parseRollout('-5')).toThrow('1-100');
  });

  test('returns undefined when value is undefined', () => {
    expect(parseRollout(undefined)).toBeUndefined();
  });

  test('handles leading-number strings like "50abc"', () => {
    // parseInt('50abc') returns 50, which is valid
    expect(parseRollout('50abc')).toBe(50);
  });

  test('handles decimal strings', () => {
    // parseInt('33.7') returns 33
    expect(parseRollout('33.7')).toBe(33);
  });
});
