import { CLIProviderImpl } from './provider';
import type {
  CLIModule,
  CLIProvider,
  CommandDefinition,
  CustomWorkflow,
} from './types';

export class ModuleManager {
  private modules: Map<string, CLIModule> = new Map();
  private provider: CLIProvider;
  private commands: Map<string, CommandDefinition> = new Map();
  private workflows: Map<string, CustomWorkflow> = new Map();

  constructor() {
    this.provider = new CLIProviderImpl();
  }

  registerModule(module: CLIModule): void {
    if (this.modules.has(module.name)) {
      throw new Error(`Module '${module.name}' is already registered`);
    }

    this.modules.set(module.name, module);

    if (module.commands) {
      for (const command of module.commands) {
        this.registerCommand(command);
      }
    }

    if (module.workflows) {
      for (const workflow of module.workflows) {
        this.registerWorkflow(workflow);
      }
    }

    if (module.init) {
      module.init(this.provider);
    }

    console.log(
      `Module '${module.name}' (v${module.version}) registered successfully`,
    );
  }

  unregisterModule(moduleName: string): void {
    const module = this.modules.get(moduleName);
    if (!module) {
      throw new Error(`Module '${moduleName}' is not registered`);
    }

    if (module.commands) {
      for (const command of module.commands) {
        this.commands.delete(command.name);
      }
    }

    if (module.workflows) {
      for (const workflow of module.workflows) {
        this.workflows.delete(workflow.name);
      }
    }

    if (module.cleanup) {
      module.cleanup();
    }

    this.modules.delete(moduleName);
    console.log(`Module '${moduleName}' unregistered successfully`);
  }

  registerCommand(command: CommandDefinition): void {
    if (this.commands.has(command.name)) {
      throw new Error(`Command '${command.name}' is already registered`);
    }
    this.commands.set(command.name, command);
  }

  registerWorkflow(workflow: CustomWorkflow): void {
    if (this.workflows.has(workflow.name)) {
      throw new Error(`Workflow '${workflow.name}' is already registered`);
    }
    this.workflows.set(workflow.name, workflow);
    this.provider.registerWorkflow(workflow);
  }

  getRegisteredCommands(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  getRegisteredWorkflows(): CustomWorkflow[] {
    return Array.from(this.workflows.values());
  }

  getRegisteredModules(): CLIModule[] {
    return Array.from(this.modules.values());
  }

  async executeCommand(commandName: string, context: any): Promise<any> {
    const command = this.commands.get(commandName);
    if (!command) {
      throw new Error(`Command '${commandName}' not found`);
    }

    return await command.handler(context);
  }

  async executeWorkflow(workflowName: string, context: any): Promise<any> {
    return await this.provider.executeWorkflow(workflowName, context);
  }

  getProvider(): CLIProvider {
    return this.provider;
  }

  listCommands(): any[] {
    return Array.from(this.commands.values());
  }

  listWorkflows(): CustomWorkflow[] {
    return Array.from(this.workflows.values());
  }

  listAll(): void {
    console.log('\n=== Registered Commands ===');
    for (const command of this.commands.values()) {
      console.log(
        `  ${command.name}: ${command.description || 'No description'}`,
      );
    }

    console.log('\n=== Registered Workflows ===');
    for (const workflow of this.workflows.values()) {
      console.log(
        `  ${workflow.name}: ${workflow.description || 'No description'}`,
      );
    }

    console.log('\n=== Registered Modules ===');
    for (const module of this.modules.values()) {
      console.log(
        `  ${module.name} (v${module.version}): ${module.commands?.length || 0} commands, ${module.workflows?.length || 0} workflows`,
      );
    }
  }
}

export const moduleManager = new ModuleManager();
