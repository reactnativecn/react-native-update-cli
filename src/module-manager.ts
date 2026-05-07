import { CLIProviderImpl } from './provider';
import type {
  CLIModule,
  CLIProvider,
  CommandContext,
  CommandDefinition,
  CommandResult,
} from './types';

export class ModuleManager {
  private modules: Map<string, CLIModule> = new Map();
  private provider: CLIProvider;
  private commands: Map<string, CommandDefinition> = new Map();

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

    if (module.init) {
      module.init(this.provider);
    }
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

  async executeCommand(
    commandName: string,
    context: CommandContext,
  ): Promise<CommandResult> {
    const command = this.commands.get(commandName);
    if (!command) {
      throw new Error(`Command '${commandName}' not found`);
    }

    return await command.handler(context);
  }

  getProvider(): CLIProvider {
    return this.provider;
  }

  listCommands(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  listModules(): CLIModule[] {
    return Array.from(this.modules.values());
  }

  listAll(): void {
    console.log('\n=== Registered Commands ===');
    for (const command of this.commands.values()) {
      console.log(
        `  ${command.name}: ${command.description || 'No description'}`,
      );
    }

    console.log('\n=== Registered Modules ===');
    for (const module of this.modules.values()) {
      console.log(
        `  ${module.name} (v${module.version}): ${module.commands?.length || 0} commands`,
      );
    }
  }
}

export const moduleManager = new ModuleManager();
