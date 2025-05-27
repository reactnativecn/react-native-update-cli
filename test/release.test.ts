// test/release.test.ts
import { commands, _internal as releaseInternalActions } from '../src/release'; // Assumes _internal export from release.ts
import * as utils from '../src/utils';
import * as appUtils from '../src/app';
import * as i18n from '../src/utils/i18n';

// Mock imported utility functions
jest.mock('../src/utils', () => ({
  ...jest.requireActual('../src/utils'),
  checkPlatform: jest.fn(),
  translateOptions: jest.fn((options) => options), 
  question: jest.fn(),
  tempDir: jest.requireActual('../src/utils').tempDir, // Keep actual tempDir
  time: jest.requireActual('../src/utils').time,     // Keep actual time
}));

jest.mock('../src/app', () => ({
  ...jest.requireActual('../src/app'),
  getSelectedApp: jest.fn(),
  getPlatform: jest.fn(),
}));

jest.mock('../src/utils/i18n', () => ({
  t: jest.fn((key, params) => {
    if (params) {
      return `${key} with ${JSON.stringify(params)}`;
    }
    return key;
  }),
}));

describe('releaseFull command', () => {
  let consoleErrorSpy;
  let consoleLogSpy;
  let mockPerformDiff, mockPerformPublish, mockPerformUpdate;

  const defaultOptions = {
    platform: 'ios',
    origin: 'path/to/origin.ppk',
    next: 'path/to/next.ppk',
    output: 'path/to/diff.ppk-patch',
    name: 'v1.0.0-bundle',
    description: 'Test release description',
    packageVersion: '1.0.0',
    metaInfo: 'extra_meta_info',
    rollout: 100,
    dryRun: false,
  };

  const MOCKED_APP_ID = 'test-app-id';
  const MOCKED_VERSION_ID = 'test-version-id';
  const MOCKED_DIFF_PATH = defaultOptions.output; // Default diff path mock

  beforeEach(() => {
    jest.clearAllMocks();

    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    // Setup default mock implementations for utils
    (utils.checkPlatform as jest.Mock).mockResolvedValue(defaultOptions.platform);
    // Ensure translateOptions returns all necessary options, including a default for 'output' if not provided by test.
    (utils.translateOptions as jest.Mock).mockImplementation(async (opts, _cmd) => {
      return { 
        ...opts, 
        output: opts.output || MOCKED_DIFF_PATH // Ensure output is always defined after translation
      };
    });
    (appUtils.getSelectedApp as jest.Mock).mockResolvedValue({ appId: MOCKED_APP_ID });

    // Spy on the methods of the (assumed) exported _internal object from src/release.ts
    mockPerformDiff = jest.spyOn(releaseInternalActions, 'performDiff')
                         .mockResolvedValue(MOCKED_DIFF_PATH);
    mockPerformPublish = jest.spyOn(releaseInternalActions, 'performPublish')
                            .mockResolvedValue({ id: MOCKED_VERSION_ID, versionName: defaultOptions.name });
    mockPerformUpdate = jest.spyOn(releaseInternalActions, 'performUpdate')
                           .mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it('should call diff, publish, and update in order with correct parameters', async () => {
    await commands.releaseFull({ args: [], options: defaultOptions });

    expect(mockPerformDiff).toHaveBeenCalledTimes(1);
    expect(mockPerformDiff).toHaveBeenCalledWith(defaultOptions.origin, defaultOptions.next, defaultOptions.output);

    expect(mockPerformPublish).toHaveBeenCalledTimes(1);
    expect(mockPerformPublish).toHaveBeenCalledWith(
      MOCKED_DIFF_PATH, // Path from diff
      expect.objectContaining({
        platform: defaultOptions.platform,
        appId: MOCKED_APP_ID,
        name: defaultOptions.name,
        description: defaultOptions.description,
        metaInfo: defaultOptions.metaInfo,
      })
    );

    expect(mockPerformUpdate).toHaveBeenCalledTimes(1);
    expect(mockPerformUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: defaultOptions.platform,
        appId: MOCKED_APP_ID,
        versionId: MOCKED_VERSION_ID,
        packageVersion: defaultOptions.packageVersion,
        rollout: defaultOptions.rollout,
        dryRun: defaultOptions.dryRun,
      })
    );
    expect(console.error).not.toHaveBeenCalled();
  });
  
  it('should use default output path for diff if user does not provide one', async () => {
    const optsWithoutOutput = { ...defaultOptions };
    delete optsWithoutOutput.output;

    // translateOptions mock will provide the default MOCKED_DIFF_PATH
    await commands.releaseFull({ args: [], options: optsWithoutOutput });

    expect(mockPerformDiff).toHaveBeenCalledWith(optsWithoutOutput.origin, optsWithoutOutput.next, MOCKED_DIFF_PATH);
    expect(mockPerformPublish).toHaveBeenCalledWith(MOCKED_DIFF_PATH, expect.anything());
  });


  const requiredOptionsForError = [
    { key: 'platform', setup: () => (utils.checkPlatform as jest.Mock).mockRejectedValueOnce(new Error('Platform check failed')) },
    { key: 'origin' },
    { key: 'next' },
    { key: 'name' }, // Bundle name for publish step
    { key: 'packageVersion' } // Native version for update step
  ];

  requiredOptionsForError.forEach(optInfo => {
    it(`should log an error and not proceed if required option "${optInfo.key}" is effectively missing or check fails`, async () => {
      const incompleteOptions = { ...defaultOptions };
      // For 'platform', the error is simulated by checkPlatform rejecting.
      // For others, they are missing from the options passed to releaseFull,
      // and translateOptions mock will pass them as undefined.
      if (optInfo.key !== 'platform') {
        delete incompleteOptions[optInfo.key];
      }
      
      if (optInfo.setup) {
        optInfo.setup();
      }

      await commands.releaseFull({ args: [], options: incompleteOptions });
      
      expect(console.error).toHaveBeenCalled();
      expect(mockPerformDiff).not.toHaveBeenCalled();
      expect(mockPerformPublish).not.toHaveBeenCalled();
      expect(mockPerformUpdate).not.toHaveBeenCalled();
    });
  });
  
  it('should stop execution if diff fails', async () => {
    mockPerformDiff.mockRejectedValueOnce(new Error('Diff generation failed'));

    await commands.releaseFull({ args: [], options: defaultOptions });

    expect(mockPerformDiff).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('RELEASE_FULL_ERROR_DIFF'), expect.any(Error));
    expect(mockPerformPublish).not.toHaveBeenCalled();
    expect(mockPerformUpdate).not.toHaveBeenCalled();
  });

  it('should stop execution if publish fails', async () => {
    mockPerformPublish.mockRejectedValueOnce(new Error('Publishing failed'));

    await commands.releaseFull({ args: [], options: defaultOptions });

    expect(mockPerformDiff).toHaveBeenCalledTimes(1);
    expect(mockPerformPublish).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('RELEASE_FULL_ERROR_PUBLISH'), expect.any(Error));
    expect(mockPerformUpdate).not.toHaveBeenCalled();
  });
  
  it('should stop execution if update fails', async () => {
    mockPerformUpdate.mockRejectedValueOnce(new Error('Update/binding failed'));

    await commands.releaseFull({ args: [], options: defaultOptions });

    expect(mockPerformDiff).toHaveBeenCalledTimes(1);
    expect(mockPerformPublish).toHaveBeenCalledTimes(1);
    expect(mockPerformUpdate).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('RELEASE_FULL_ERROR_UPDATE'), expect.any(Error));
  });

  it('should correctly pass through dryRun option to update', async () => {
    const dryRunOptions = { ...defaultOptions, dryRun: true };

    await commands.releaseFull({ args: [], options: dryRunOptions });

    expect(mockPerformUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        dryRun: true,
      })
    );
  });

  it('should correctly pass through rollout option to update (as number)', async () => {
    // Simulate rollout coming as string from CLI options, then translated to number
    const rolloutStrOptions = { ...defaultOptions, rollout: "50" }; 
    (utils.translateOptions as jest.Mock).mockImplementation(async (opts, _cmd) => {
        return { ...opts, rollout: typeof opts.rollout === 'string' ? Number(opts.rollout) : opts.rollout, output: opts.output || MOCKED_DIFF_PATH };
    });


    await commands.releaseFull({ args: [], options: rolloutStrOptions });
    
    expect(mockPerformUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        rollout: 50,
      })
    );
  });
});
