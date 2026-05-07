import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { CLIProviderImpl } from '../src/provider';

describe('CLIProviderImpl', () => {
  let provider: CLIProviderImpl;
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    provider = new CLIProviderImpl();
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('getPlatform', () => {
    test('resolves valid platform string', async () => {
      const platform = await provider.getPlatform('ios');
      expect(platform).toBe('ios');
    });

    test('resolves android platform', async () => {
      const platform = await provider.getPlatform('android');
      expect(platform).toBe('android');
    });

    test('resolves harmony platform', async () => {
      const platform = await provider.getPlatform('harmony');
      expect(platform).toBe('harmony');
    });

    test('throws for invalid platform', async () => {
      await expect(provider.getPlatform('windows' as any)).rejects.toThrow();
    });
  });
});
