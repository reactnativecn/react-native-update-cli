import type { CLIModule, CommandDefinition, CustomWorkflow, CommandContext, CommandResult } from '../types';
import { userCommands } from '../user';

export const userModule: CLIModule = {
  name: 'user',
  version: '1.0.0',
  
  commands: [
    {
      name: 'login',
      description: 'Login to the service',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          console.log('Logging in user');
          await userCommands.login(context);
          return {
            success: true,
            data: { message: 'Login successful' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Login failed'
          };
        }
      }
    },
    {
      name: 'logout',
      description: 'Logout from the service',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          console.log('Logging out user');
          await userCommands.logout(context);
          return {
            success: true,
            data: { message: 'Logout successful' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Logout failed'
          };
        }
      }
    },
    {
      name: 'me',
      description: 'Show current user information',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          console.log('Getting user information');
          await userCommands.me();
          return {
            success: true,
            data: { message: 'User information retrieved successfully' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Get user info failed'
          };
        }
      }
    }
  ],

  workflows: [
    {
      name: 'auth-check',
      description: 'Check authentication status',
      steps: [
        {
          name: 'check-session',
          description: 'Check if user is logged in',
          execute: async (context: CommandContext) => {
            console.log('Checking authentication status');
            return { authenticated: true };
          }
        },
        {
          name: 'get-user-info',
          description: 'Get current user information',
          execute: async (context: CommandContext, previousResult: any) => {
            console.log('Getting user information');
            return { ...previousResult, userInfo: { name: 'test-user' } };
          }
        }
      ]
    }
  ]
}; 