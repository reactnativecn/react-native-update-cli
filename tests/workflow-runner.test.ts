import { describe, expect, test } from 'bun:test';
import type { CommandContext, CustomWorkflow } from '../src/types';
import { runWorkflow } from '../src/workflow-runner';

const context: CommandContext = {
  args: [],
  options: {},
};

describe('workflow-runner', () => {
  test('throws when workflow validation fails', async () => {
    const workflow: CustomWorkflow = {
      name: 'invalid',
      steps: [],
      validate: () => false,
    };

    await expect(runWorkflow('invalid', workflow, context)).rejects.toThrow(
      "Workflow 'invalid' validation failed",
    );
  });

  test('runs all steps in order and passes previous result', async () => {
    const calls: Array<{ step: string; previous: unknown }> = [];
    const workflow: CustomWorkflow = {
      name: 'ordered',
      steps: [
        {
          name: 'first',
          execute: async (_ctx, previous) => {
            calls.push({ step: 'first', previous });
            return { id: 1 };
          },
        },
        {
          name: 'second',
          execute: async (_ctx, previous) => {
            calls.push({ step: 'second', previous });
            return { id: 2, previous };
          },
        },
      ],
    };

    const result = await runWorkflow('ordered', workflow, context);

    expect(calls).toEqual([
      { step: 'first', previous: undefined },
      { step: 'second', previous: { id: 1 } },
    ]);
    expect(result).toEqual({
      id: 2,
      previous: { id: 1 },
    });
  });

  test('skips step when condition returns false', async () => {
    const executed: string[] = [];
    const workflow: CustomWorkflow = {
      name: 'conditional',
      steps: [
        {
          name: 'skip',
          condition: () => false,
          execute: async () => {
            executed.push('skip');
            return undefined;
          },
        },
        {
          name: 'run',
          execute: async () => {
            executed.push('run');
            return 'ok';
          },
        },
      ],
    };

    const result = await runWorkflow('conditional', workflow, context);

    expect(executed).toEqual(['run']);
    expect(result).toBe('ok');
  });

  test('propagates step error', async () => {
    const workflow: CustomWorkflow = {
      name: 'error-flow',
      steps: [
        {
          name: 'boom',
          execute: async () => {
            throw new Error('step failed');
          },
        },
      ],
    };

    await expect(runWorkflow('error-flow', workflow, context)).rejects.toThrow(
      'step failed',
    );
  });
});
