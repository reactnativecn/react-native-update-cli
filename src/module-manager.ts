import type { CLIModule, CLIProvider, CommandDefinition, CustomWorkflow } from './types';
import { CLIProviderImpl } from './provider';

export class ModuleManager {
  private modules: Map<string, CLIModule> = new Map();
  private provider: CLIProvider;
  private commands: Map<string, CommandDefinition> = new Map();
  private workflows: Map<string, CustomWorkflow> = new Map();

  constructor() {
    this.provider = new CLIProviderImpl();
  }

  /**
   * 注册一个CLI模块
   */
  registerModule(module: CLIModule): void {
    if (this.modules.has(module.name)) {
      throw new Error(`Module '${module.name}' is already registered`);
    }

    this.modules.set(module.name, module);

    // 注册模块的命令
    if (module.commands) {
      for (const command of module.commands) {
        this.registerCommand(command);
      }
    }

    // 注册模块的工作流
    if (module.workflows) {
      for (const workflow of module.workflows) {
        this.registerWorkflow(workflow);
      }
    }

    // 初始化模块
    if (module.init) {
      module.init(this.provider);
    }

    console.log(`Module '${module.name}' (v${module.version}) registered successfully`);
  }

  /**
   * 注销一个CLI模块
   */
  unregisterModule(moduleName: string): void {
    const module = this.modules.get(moduleName);
    if (!module) {
      throw new Error(`Module '${moduleName}' is not registered`);
    }

    // 清理模块的命令
    if (module.commands) {
      for (const command of module.commands) {
        this.commands.delete(command.name);
      }
    }

    // 清理模块的工作流
    if (module.workflows) {
      for (const workflow of module.workflows) {
        this.workflows.delete(workflow.name);
      }
    }

    // 清理模块
    if (module.cleanup) {
      module.cleanup();
    }

    this.modules.delete(moduleName);
    console.log(`Module '${moduleName}' unregistered successfully`);
  }

  /**
   * 注册单个命令
   */
  registerCommand(command: CommandDefinition): void {
    if (this.commands.has(command.name)) {
      throw new Error(`Command '${command.name}' is already registered`);
    }
    this.commands.set(command.name, command);
  }

  /**
   * 注册单个工作流
   */
  registerWorkflow(workflow: CustomWorkflow): void {
    if (this.workflows.has(workflow.name)) {
      throw new Error(`Workflow '${workflow.name}' is already registered`);
    }
    this.workflows.set(workflow.name, workflow);
    this.provider.registerWorkflow(workflow);
  }

  /**
   * 获取所有注册的命令
   */
  getRegisteredCommands(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  /**
   * 获取所有注册的工作流
   */
  getRegisteredWorkflows(): CustomWorkflow[] {
    return Array.from(this.workflows.values());
  }

  /**
   * 获取所有注册的模块
   */
  getRegisteredModules(): CLIModule[] {
    return Array.from(this.modules.values());
  }

  /**
   * 执行命令
   */
  async executeCommand(commandName: string, context: any): Promise<any> {
    const command = this.commands.get(commandName);
    if (!command) {
      throw new Error(`Command '${commandName}' not found`);
    }

    return await command.handler(context);
  }

  /**
   * 执行工作流
   */
  async executeWorkflow(workflowName: string, context: any): Promise<any> {
    return await this.provider.executeWorkflow(workflowName, context);
  }

  /**
   * 获取CLI提供者实例
   */
  getProvider(): CLIProvider {
    return this.provider;
  }

  /**
   * 列出所有可用的命令和工作流
   */
  listAll(): void {
    console.log('\n=== Registered Commands ===');
    for (const command of this.commands.values()) {
      console.log(`  ${command.name}: ${command.description || 'No description'}`);
    }

    console.log('\n=== Registered Workflows ===');
    for (const workflow of this.workflows.values()) {
      console.log(`  ${workflow.name}: ${workflow.description || 'No description'}`);
    }

    console.log('\n=== Registered Modules ===');
    for (const module of this.modules.values()) {
      console.log(`  ${module.name} (v${module.version}): ${module.commands?.length || 0} commands, ${module.workflows?.length || 0} workflows`);
    }
  }
}

// 创建全局模块管理器实例
export const moduleManager = new ModuleManager(); 