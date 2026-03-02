import { describe, expect, test } from 'bun:test';
import { ModuleManager } from '../src/module-manager';
import type {
  CLIModule,
  CLIProvider,
  CommandContext,
  CommandResult,
  CustomWorkflow,
  Platform,
  Session,
} from '../src/types';

type ProviderStub = CLIProvider & {
  registeredWorkflows: string[];
  workflowCalls: string[];
};

function createProviderStub(): ProviderStub {
  const registeredWorkflows: string[] = [];
  const workflowCalls: string[] = [];

  return {
    registeredWorkflows,
    workflowCalls,
    bundle: async () => ({ success: true }),
    publish: async () => ({ success: true }),
    upload: async () => ({ success: true }),
    createApp: async () => ({ success: true }),
    listApps: async () => ({ success: true }),
    getSelectedApp: async () => ({ appId: '1', platform: 'ios' }),
    listVersions: async () => ({ success: true }),
    updateVersion: async () => ({ success: true }),
    getPlatform: async (platform?: Platform) => platform ?? 'ios',
    loadSession: async () => ({ token: 'token' }) as Session,
    registerWorkflow: (workflow: CustomWorkflow) => {
      registeredWorkflows.push(workflow.name);
    },
    executeWorkflow: async (
      workflowName: string,
      _context: CommandContext,
    ): Promise<CommandResult> => {
      workflowCalls.push(workflowName);
      return { success: true, data: { workflowName } };
    },
  };
}

function setProvider(manager: ModuleManager, provider: CLIProvider): void {
  (manager as unknown as { provider: CLIProvider }).provider = provider;
}

describe('module-manager', () => {
  test('registers module commands/workflows and runs init', () => {
    const manager = new ModuleManager();
    const provider = createProviderStub();
    setProvider(manager, provider);

    let initCalled = false;
    const workflow: CustomWorkflow = {
      name: 'wf-1',
      steps: [],
    };
    const module: CLIModule = {
      name: 'mod-1',
      version: '1.0.0',
      commands: [
        {
          name: 'cmd-1',
          handler: async () => ({ success: true }),
        },
      ],
      workflows: [workflow],
      init: () => {
        initCalled = true;
      },
    };

    manager.registerModule(module);

    expect(initCalled).toBe(true);
    expect(manager.listModules().map((item) => item.name)).toEqual(['mod-1']);
    expect(manager.listCommands().map((item) => item.name)).toEqual(['cmd-1']);
    expect(manager.listWorkflows().map((item) => item.name)).toEqual(['wf-1']);
    expect(provider.registeredWorkflows).toEqual(['wf-1']);
  });

  test('throws when registering duplicate module', () => {
    const manager = new ModuleManager();
    const provider = createProviderStub();
    setProvider(manager, provider);

    const module: CLIModule = {
      name: 'dup-module',
      version: '1.0.0',
    };

    manager.registerModule(module);
    expect(() => manager.registerModule(module)).toThrow(
      "Module 'dup-module' is already registered",
    );
  });

  test('throws on duplicate command and workflow registration', () => {
    const manager = new ModuleManager();

    manager.registerCommand({
      name: 'dup-command',
      handler: async () => ({ success: true }),
    });
    expect(() =>
      manager.registerCommand({
        name: 'dup-command',
        handler: async () => ({ success: true }),
      }),
    ).toThrow("Command 'dup-command' is already registered");

    const provider = createProviderStub();
    setProvider(manager, provider);

    const workflow: CustomWorkflow = { name: 'dup-workflow', steps: [] };
    manager.registerWorkflow(workflow);
    expect(() => manager.registerWorkflow(workflow)).toThrow(
      "Workflow 'dup-workflow' is already registered",
    );
  });

  test('executeCommand calls command handler and returns result', async () => {
    const manager = new ModuleManager();
    const context: CommandContext = { args: ['1'], options: { dryRun: true } };

    manager.registerCommand({
      name: 'run',
      handler: async (ctx) => ({
        success: true,
        data: ctx,
      }),
    });

    const result = await manager.executeCommand('run', context);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(context);
  });

  test('executeCommand throws when command not found', async () => {
    const manager = new ModuleManager();
    const context: CommandContext = { args: [], options: {} };

    await expect(manager.executeCommand('missing', context)).rejects.toThrow(
      "Command 'missing' not found",
    );
  });

  test('executeWorkflow delegates to provider', async () => {
    const manager = new ModuleManager();
    const provider = createProviderStub();
    setProvider(manager, provider);

    const context: CommandContext = { args: [], options: {} };
    const result = await manager.executeWorkflow('flow-1', context);

    expect(result).toEqual({
      success: true,
      data: { workflowName: 'flow-1' },
    });
    expect(provider.workflowCalls).toEqual(['flow-1']);
  });

  test('unregisterModule removes command/workflow and runs cleanup', async () => {
    const manager = new ModuleManager();
    const provider = createProviderStub();
    setProvider(manager, provider);

    let cleaned = false;
    const module: CLIModule = {
      name: 'cleanup-module',
      version: '1.0.0',
      commands: [
        {
          name: 'cleanup-command',
          handler: async () => ({ success: true }),
        },
      ],
      workflows: [{ name: 'cleanup-workflow', steps: [] }],
      cleanup: () => {
        cleaned = true;
      },
    };
    manager.registerModule(module);

    manager.unregisterModule('cleanup-module');

    expect(cleaned).toBe(true);
    expect(manager.listModules()).toHaveLength(0);
    expect(manager.listCommands()).toHaveLength(0);
    expect(manager.listWorkflows()).toHaveLength(0);

    await expect(
      manager.executeCommand('cleanup-command', { args: [], options: {} }),
    ).rejects.toThrow("Command 'cleanup-command' not found");
  });
});
