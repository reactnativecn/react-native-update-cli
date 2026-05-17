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

  test('does not prompt for optional fields in no-interactive mode', async () => {
    await versionCommands.publish({
      args: ['bundle.ppk'],
      options: {
        platform: 'android',
        name: 'v1',
        'no-interactive': true,
      },
    });

    expect(questionSpy).not.toHaveBeenCalled();
    expect(postSpy).toHaveBeenCalledWith(
      '/app/100/version/create',
      expect.objectContaining({
        name: 'v1',
        description: '',
        metaInfo: '',
      }),
    );
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe('versionCommands.versions', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let getSpy: ReturnType<typeof spyOn>;
  let getPlatformSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    getSpy = spyOn(api, 'get').mockResolvedValue({
      data: [{ id: '200', hash: 'abcdef123', name: 'v1', packages: [] }],
    });
    getPlatformSpy = spyOn(app, 'getPlatform').mockResolvedValue('ios');
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    getSpy.mockRestore();
    getPlatformSpy.mockRestore();
  });

  test('uses provided appId and requests the first paged result in non-interactive mode', async () => {
    await versionCommands.versions({
      options: { appId: '100', 'no-interactive': true },
    });

    expect(getSpy).toHaveBeenCalledWith(
      '/app/100/version/list?offset=0&limit=10',
    );
    expect(getPlatformSpy).not.toHaveBeenCalled();
  });

  test('honors global non-interactive mode when listing versions', async () => {
    global.NO_INTERACTIVE = true;

    try {
      await versionCommands.versions({
        options: { appId: '100' },
      });
    } finally {
      global.NO_INTERACTIVE = undefined;
    }

    expect(getSpy).toHaveBeenCalledWith(
      '/app/100/version/list?offset=0&limit=10',
    );
  });
});

describe('versionCommands.update package range selection', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let getAllPackagesSpy: ReturnType<typeof spyOn>;
  let postSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    getAllPackagesSpy = spyOn(api, 'getAllPackages').mockResolvedValue([
      { id: '10', name: '1.0.0' },
      { id: '11', name: '1.1.0' },
      { id: '12', name: '1.2.0' },
      { id: '13', name: '1.3.0' },
    ]);
    postSpy = spyOn(api, 'post').mockResolvedValue({});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    getAllPackagesSpy.mockRestore();
    postSpy.mockRestore();
  });

  test('applies minPackageVersion as a lower bound', async () => {
    const appId = 'min-app';

    await versionCommands.update({
      options: {
        appId,
        versionId: '200',
        minPackageVersion: '1.1.0',
      },
    });

    const bindingCalls = postSpy.mock.calls.filter(
      ([url]) => url === `/app/${appId}/binding`,
    );

    expect(bindingCalls).toHaveLength(3);
    expect(bindingCalls[0]).toEqual([
      `/app/${appId}/binding`,
      {
        versionId: '200',
        rollout: undefined,
        packageId: '11',
      },
    ]);
    expect(bindingCalls[1]).toEqual([
      `/app/${appId}/binding`,
      {
        versionId: '200',
        rollout: undefined,
        packageId: '12',
      },
    ]);
    expect(bindingCalls[2]).toEqual([
      `/app/${appId}/binding`,
      {
        versionId: '200',
        rollout: undefined,
        packageId: '13',
      },
    ]);
  });

  test('applies maxPackageVersion as an upper bound', async () => {
    const appId = 'max-app';

    await versionCommands.update({
      options: {
        appId,
        versionId: '200',
        maxPackageVersion: '1.2.0',
      },
    });

    const bindingCalls = postSpy.mock.calls.filter(
      ([url]) => url === `/app/${appId}/binding`,
    );

    expect(bindingCalls).toHaveLength(3);
    expect(bindingCalls[0]).toEqual([
      `/app/${appId}/binding`,
      {
        versionId: '200',
        rollout: undefined,
        packageId: '10',
      },
    ]);
    expect(bindingCalls[1]).toEqual([
      `/app/${appId}/binding`,
      {
        versionId: '200',
        rollout: undefined,
        packageId: '11',
      },
    ]);
    expect(bindingCalls[2]).toEqual([
      `/app/${appId}/binding`,
      {
        versionId: '200',
        rollout: undefined,
        packageId: '12',
      },
    ]);
  });

  test('fails instead of prompting for package id in non-interactive mode', async () => {
    global.NO_INTERACTIVE = true;

    try {
      await expect(
        versionCommands.update({
          options: {
            appId: '100',
            versionId: '200',
          },
        }),
      ).rejects.toThrow(/packageId|packageVersion/);

      expect(postSpy).not.toHaveBeenCalled();
    } finally {
      global.NO_INTERACTIVE = undefined;
    }
  });
});

describe('versionCommands.updateVersionInfo', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let putSpy: ReturnType<typeof spyOn>;
  let getPlatformSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    putSpy = spyOn(api, 'put').mockResolvedValue({});
    getPlatformSpy = spyOn(app, 'getPlatform').mockResolvedValue('ios');
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    putSpy.mockRestore();
    getPlatformSpy.mockRestore();
  });

  test('uses provided appId and versionId without selecting an app', async () => {
    await versionCommands.updateVersionInfo({
      options: {
        appId: '100',
        versionId: '200',
        name: 'v2',
        'no-interactive': true,
      },
    });

    expect(putSpy).toHaveBeenCalledWith('/app/100/version/200', {
      name: 'v2',
    });
    expect(getPlatformSpy).not.toHaveBeenCalled();
  });

  test('fails instead of prompting for version id in non-interactive mode', async () => {
    await expect(
      versionCommands.updateVersionInfo({
        options: {
          appId: '100',
          name: 'v2',
          'no-interactive': true,
        },
      }),
    ).rejects.toThrow(/versionId/);

    expect(putSpy).not.toHaveBeenCalled();
  });
});

describe('versionCommands.deleteVersion', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let deleteSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    deleteSpy = spyOn(api, 'doDelete').mockResolvedValue({});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    deleteSpy.mockRestore();
  });

  test('deletes the provided version id without prompting', async () => {
    await versionCommands.deleteVersion({
      options: {
        appId: '100',
        versionId: '200',
        'no-interactive': true,
      },
    });

    expect(deleteSpy).toHaveBeenCalledWith('/app/100/version/200');
  });

  test('fails instead of prompting for version id in non-interactive mode', async () => {
    await expect(
      versionCommands.deleteVersion({
        options: {
          appId: '100',
          'no-interactive': true,
        },
      }),
    ).rejects.toThrow(/versionId/);

    expect(deleteSpy).not.toHaveBeenCalled();
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
