import { getSession, loadSession } from '../api';
import type { CLIModule, CommandContext, CommandResult } from '../types';
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
            data: { message: 'Login successful' },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Login failed',
          };
        }
      },
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
            data: { message: 'Logout successful' },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Logout failed',
          };
        }
      },
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
            data: { message: 'User information retrieved successfully' },
          };
        } catch (error) {
          return {
            success: false,
            error:
              error instanceof Error ? error.message : 'Get user info failed',
          };
        }
      },
    },
  ],

  workflows: [
    {
      name: 'auth-check',
      description: 'Check authentication status and user information',
      options: {
        autoLogin: {
          default: false,
          description: 'Automatically login if not authenticated',
        },
        showDetails: {
          default: true,
          description: 'Show detailed user information',
        },
      },
      steps: [
        {
          name: 'load-session',
          description: 'Load existing session from local storage',
          execute: async (context: CommandContext) => {
            console.log('Loading session from local storage...');

            try {
              await loadSession();
              const session = getSession();

              if (session && session.token) {
                console.log('✓ Session found in local storage');
                return {
                  sessionLoaded: true,
                  hasToken: true,
                  session,
                };
              } else {
                console.log('✗ No valid session found in local storage');
                return {
                  sessionLoaded: true,
                  hasToken: false,
                  session: null,
                };
              }
            } catch (error) {
              console.log(
                '✗ Failed to load session:',
                error instanceof Error ? error.message : 'Unknown error',
              );
              return {
                sessionLoaded: false,
                hasToken: false,
                session: null,
                error: error instanceof Error ? error.message : 'Unknown error',
              };
            }
          },
        },
        {
          name: 'validate-session',
          description: 'Validate session by calling API',
          execute: async (context: CommandContext, previousResult: any) => {
            if (!previousResult.hasToken) {
              console.log('No token available, skipping validation');
              return {
                ...previousResult,
                validated: false,
                reason: 'No token available',
              };
            }

            console.log('Validating session with server...');

            try {
              await userCommands.me();
              console.log('✓ Session is valid');
              return {
                ...previousResult,
                validated: true,
                reason: 'Session validated successfully',
              };
            } catch (error) {
              console.log(
                '✗ Session validation failed:',
                error instanceof Error ? error.message : 'Unknown error',
              );
              return {
                ...previousResult,
                validated: false,
                reason:
                  error instanceof Error ? error.message : 'Unknown error',
              };
            }
          },
        },
        {
          name: 'get-user-info',
          description: 'Get current user information',
          execute: async (context: CommandContext, previousResult: any) => {
            if (!previousResult.validated) {
              console.log('Session not valid, cannot get user info');
              return {
                ...previousResult,
                userInfo: null,
                reason: 'Session not valid',
              };
            }

            console.log('Getting user information...');

            try {
              const { get } = await import('../api');
              const userInfo = await get('/user/me');

              console.log('✓ User information retrieved successfully');

              if (context.options.showDetails !== false) {
                console.log('\n=== User Information ===');
                for (const [key, value] of Object.entries(userInfo)) {
                  if (key !== 'ok') {
                    console.log(`${key}: ${value}`);
                  }
                }
                console.log('========================\n');
              }

              return {
                ...previousResult,
                userInfo,
                reason: 'User info retrieved successfully',
              };
            } catch (error) {
              console.log(
                '✗ Failed to get user info:',
                error instanceof Error ? error.message : 'Unknown error',
              );
              return {
                ...previousResult,
                userInfo: null,
                reason:
                  error instanceof Error ? error.message : 'Unknown error',
              };
            }
          },
        },
        {
          name: 'handle-auth-failure',
          description: 'Handle authentication failure',
          execute: async (context: CommandContext, previousResult: any) => {
            if (previousResult.validated) {
              console.log('✓ Authentication check completed successfully');
              return {
                ...previousResult,
                authCheckComplete: true,
                status: 'authenticated',
              };
            }

            console.log('✗ Authentication check failed');

            if (context.options.autoLogin) {
              console.log('Attempting automatic login...');
              try {
                await userCommands.login({ args: [] });
                console.log('✓ Automatic login successful');
                return {
                  ...previousResult,
                  authCheckComplete: true,
                  status: 'auto-logged-in',
                  autoLoginSuccess: true,
                };
              } catch (error) {
                console.log(
                  '✗ Automatic login failed:',
                  error instanceof Error ? error.message : 'Unknown error',
                );
                return {
                  ...previousResult,
                  authCheckComplete: true,
                  status: 'failed',
                  autoLoginSuccess: false,
                  autoLoginError:
                    error instanceof Error ? error.message : 'Unknown error',
                };
              }
            } else {
              console.log('Please run login command to authenticate');
              return {
                ...previousResult,
                authCheckComplete: true,
                status: 'unauthenticated',
                suggestion: 'Run login command to authenticate',
              };
            }
          },
        },
      ],
    },
    {
      name: 'login-flow',
      description: 'Complete login flow with validation',
      options: {
        email: { hasValue: true, description: 'User email' },
        password: { hasValue: true, description: 'User password' },
        validateAfterLogin: {
          default: true,
          description: 'Validate session after login',
        },
      },
      steps: [
        {
          name: 'check-existing-session',
          description: 'Check if user is already logged in',
          execute: async (context: CommandContext) => {
            console.log('Checking existing session...');

            try {
              await loadSession();
              const session = getSession();

              if (session && session.token) {
                try {
                  await userCommands.me();
                  console.log('✓ User is already logged in');
                  return {
                    alreadyLoggedIn: true,
                    session: session,
                    status: 'authenticated',
                  };
                } catch (error) {
                  console.log(
                    '✗ Existing session is invalid, proceeding with login',
                  );
                  return {
                    alreadyLoggedIn: false,
                    session: null,
                    status: 'session-expired',
                  };
                }
              } else {
                console.log('No existing session found');
                return {
                  alreadyLoggedIn: false,
                  session: null,
                  status: 'no-session',
                };
              }
            } catch (error) {
              console.log(
                'Error checking existing session:',
                error instanceof Error ? error.message : 'Unknown error',
              );
              return {
                alreadyLoggedIn: false,
                session: null,
                status: 'error',
                error: error instanceof Error ? error.message : 'Unknown error',
              };
            }
          },
        },
        {
          name: 'perform-login',
          description: 'Perform user login',
          execute: async (context: CommandContext, previousResult: any) => {
            if (previousResult.alreadyLoggedIn) {
              console.log('Skipping login - user already authenticated');
              return {
                ...previousResult,
                loginPerformed: false,
                loginSuccess: true,
              };
            }

            console.log('Performing login...');

            try {
              const loginArgs = [];
              if (context.options.email) {
                loginArgs.push(context.options.email);
              }
              if (context.options.password) {
                loginArgs.push(context.options.password);
              }

              await userCommands.login({ args: loginArgs });
              console.log('✓ Login successful');

              return {
                ...previousResult,
                loginPerformed: true,
                loginSuccess: true,
              };
            } catch (error) {
              console.log(
                '✗ Login failed:',
                error instanceof Error ? error.message : 'Unknown error',
              );
              return {
                ...previousResult,
                loginPerformed: true,
                loginSuccess: false,
                loginError:
                  error instanceof Error ? error.message : 'Unknown error',
              };
            }
          },
        },
        {
          name: 'validate-login',
          description: 'Validate login by getting user info',
          execute: async (context: CommandContext, previousResult: any) => {
            if (
              !previousResult.loginSuccess &&
              !previousResult.alreadyLoggedIn
            ) {
              console.log('Login failed, skipping validation');
              return {
                ...previousResult,
                validationPerformed: false,
                validationSuccess: false,
              };
            }

            if (context.options.validateAfterLogin === false) {
              console.log('Skipping validation as requested');
              return {
                ...previousResult,
                validationPerformed: false,
                validationSuccess: true,
              };
            }

            console.log('Validating login by getting user information...');

            try {
              const userInfo = await userCommands.me();
              console.log('✓ Login validation successful');

              return {
                ...previousResult,
                validationPerformed: true,
                validationSuccess: true,
                userInfo,
              };
            } catch (error) {
              console.log(
                '✗ Login validation failed:',
                error instanceof Error ? error.message : 'Unknown error',
              );
              return {
                ...previousResult,
                validationPerformed: true,
                validationSuccess: false,
                validationError:
                  error instanceof Error ? error.message : 'Unknown error',
              };
            }
          },
        },
        {
          name: 'login-summary',
          description: 'Provide login flow summary',
          execute: async (context: CommandContext, previousResult: any) => {
            console.log('\n=== Login Flow Summary ===');

            if (previousResult.alreadyLoggedIn) {
              console.log('Status: Already logged in');
              console.log('Session: Valid');
            } else if (previousResult.loginSuccess) {
              console.log('Status: Login successful');
              if (previousResult.validationSuccess) {
                console.log('Validation: Passed');
              } else {
                console.log('Validation: Failed');
              }
            } else {
              console.log('Status: Login failed');
              console.log(
                'Error:',
                previousResult.loginError || 'Unknown error',
              );
            }

            console.log('==========================\n');

            return {
              ...previousResult,
              flowComplete: true,
              finalStatus:
                previousResult.alreadyLoggedIn || previousResult.loginSuccess
                  ? 'success'
                  : 'failed',
            };
          },
        },
      ],
    },
  ],
};
