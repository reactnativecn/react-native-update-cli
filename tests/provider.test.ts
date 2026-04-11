import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';
import { CLIProviderImpl } from '../src/provider';
import type { CommandContext, CustomWorkflow } from '../src/types';

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

  describe('registerWorkflow and executeWorkflow', () => {
    test('registers and executes a simple workflow', async () => {
      const workflow: CustomWorkflow = {
        name: 'test-wf',
        description: 'Test workflow',
        steps: [
          {
            name: 'step-1',
            execute: async () => ({ stepOneResult: true }),
          },
          {
            name: 'step-2',
            execute: async (_ctx, prev) => ({
              ...(prev as object),
              stepTwoResult: true,
            }),
          },
        ],
      };

      provider.registerWorkflow(workflow);

      const context: CommandContext = { args: [], options: {} };
      const result = await provider.executeWorkflow('test-wf', context);

      expect(result.success).toBe(true);
    });

    test('returns error for non-existent workflow', async () => {
      const context: CommandContext = { args: [], options: {} };
      const result = await provider.executeWorkflow('nonexistent', context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('nonexistent');
    });

    test('executes workflow with conditional steps', async () => {
      const executedSteps: string[] = [];

      const workflow: CustomWorkflow = {
        name: 'conditional-wf',
        steps: [
          {
            name: 'always-run',
            execute: async () => {
              executedSteps.push('always-run');
              return { ran: true };
            },
          },
          {
            name: 'skip-me',
            condition: () => false,
            execute: async () => {
              executedSteps.push('skip-me');
              return {};
            },
          },
          {
            name: 'also-run',
            execute: async () => {
              executedSteps.push('also-run');
              return {};
            },
          },
        ],
      };

      provider.registerWorkflow(workflow);

      const context: CommandContext = { args: [], options: {} };
      await provider.executeWorkflow('conditional-wf', context);

      expect(executedSteps).toEqual(['always-run', 'also-run']);
    });

    test('workflow with validation failure returns error', async () => {
      const workflow: CustomWorkflow = {
        name: 'validated-wf',
        validate: () => false,
        steps: [
          {
            name: 'step-1',
            execute: async () => ({}),
          },
        ],
      };

      provider.registerWorkflow(workflow);

      const context: CommandContext = { args: [], options: {} };
      const result = await provider.executeWorkflow('validated-wf', context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('validation');
    });
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
