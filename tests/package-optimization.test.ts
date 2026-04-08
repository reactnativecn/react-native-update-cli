import { describe, expect, mock, spyOn, test } from 'bun:test';

// Mock modules before any imports
mock.module('filesize-parser', () => ({ default: () => 0 }));
mock.module('form-data', () => ({ default: class {} }));
mock.module('node-fetch', () => ({ default: () => {} }));
mock.module('progress', () => ({
  default: class {
    tick() {}
  },
}));
mock.module('tcp-ping', () => ({ default: { ping: () => {} } }));
mock.module('tty-table', () => {
  const mockTable = () => ({ render: () => '' });
  return { default: mockTable };
});
mock.module('read', () => ({ read: () => {} }));
mock.module('chalk', () => ({
  default: {
    green: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
  },
}));
mock.module('compare-versions', () => ({
  satisfies: () => true,
}));
mock.module('isomorphic-git', () => ({}));
mock.module('registry-auth-token', () => ({}));
mock.module(
  'registry-auth-token/registry-url',
  () => () => 'https://registry.npmjs.org',
);
mock.module('semver', () => ({}));
mock.module('semver/functions/gt', () => () => true);
mock.module(
  'semver/ranges/max-satisfying',
  () => (versions: string[]) => versions[0],
);
mock.module('bytebuffer', () => ({}));

import * as api from '../src/api';
import { choosePackage } from '../src/package';
import * as utils from '../src/utils';

describe('choosePackage optimization', () => {
  test('should return the correct package when a valid ID is entered', async () => {
    const mockPackages = [
      { id: '101', name: 'package1' },
      { id: '102', name: 'package2' },
    ];

    const getAllPackagesSpy = spyOn(api, 'getAllPackages').mockResolvedValue(
      mockPackages as any,
    );
    const questionSpy = spyOn(utils, 'question').mockResolvedValue('102');
    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});

    const result = await choosePackage('app123');

    expect(result).toEqual(mockPackages[1] as any);
    expect(getAllPackagesSpy).toHaveBeenCalledWith('app123');
    expect(questionSpy).toHaveBeenCalled();

    getAllPackagesSpy.mockRestore();
    questionSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  test('should continue to prompt until a valid ID is entered', async () => {
    const mockPackages = [{ id: '201', name: 'packageA' }];

    const getAllPackagesSpy = spyOn(api, 'getAllPackages').mockResolvedValue(
      mockPackages as any,
    );

    const questionMock = mock();
    questionMock
      .mockResolvedValueOnce('999') // Invalid ID
      .mockResolvedValueOnce('201'); // Valid ID

    const questionSpy = spyOn(utils, 'question').mockImplementation(
      questionMock,
    );
    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});

    const result = await choosePackage('app123');

    expect(result).toEqual(mockPackages[0] as any);
    expect(questionMock).toHaveBeenCalledTimes(2);

    getAllPackagesSpy.mockRestore();
    questionSpy.mockRestore();
    consoleSpy.mockRestore();
  });
});
