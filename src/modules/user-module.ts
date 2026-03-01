import { getSession, loadSession } from '../api';
import type { CLIModule, CommandContext } from '../types';
import { userCommands } from '../user';
import {
  getBooleanOption,
  getOptionalStringOption,
  toObjectState,
} from '../utils/options';

type AuthCheckState = {
  hasToken?: boolean;
  validated?: boolean;
  [key: string]: unknown;
};

type LoginFlowState = {
  alreadyLoggedIn?: boolean;
  loginSuccess?: boolean;
  validationSuccess?: boolean;
  loginError?: string;
  [key: string]: unknown;
};

export const userModule: CLIModule = {
  name: 'user',
  version: '1.0.0',

  commands: [],

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

              if (session?.token) {
                console.log('✓ Session found in local storage');
                return {
                  sessionLoaded: true,
                  hasToken: true,
                  session,
                };
              }
              console.log('✗ No valid session found in local storage');
              return {
                sessionLoaded: true,
                hasToken: false,
                session: null,
              };
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
          execute: async (
            context: CommandContext,
            previousResult?: unknown,
          ) => {
            const state = toObjectState<AuthCheckState>(previousResult, {});
            if (!state.hasToken) {
              console.log('No token available, skipping validation');
              return {
                ...state,
                validated: false,
                reason: 'No token available',
              };
            }

            console.log('Validating session with server...');

            try {
              await userCommands.me();
              console.log('✓ Session is valid');
              return {
                ...state,
                validated: true,
                reason: 'Session validated successfully',
              };
            } catch (error) {
              console.log(
                '✗ Session validation failed:',
                error instanceof Error ? error.message : 'Unknown error',
              );
              return {
                ...state,
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
          execute: async (
            context: CommandContext,
            previousResult?: unknown,
          ) => {
            const state = toObjectState<AuthCheckState>(previousResult, {});
            if (!state.validated) {
              console.log('Session not valid, cannot get user info');
              return {
                ...state,
                userInfo: null,
                reason: 'Session not valid',
              };
            }

            console.log('Getting user information...');

            try {
              const { get } = await import('../api');
              const userInfo = (await get('/user/me')) as Record<
                string,
                unknown
              >;

              console.log('✓ User information retrieved successfully');

              const showDetails = getBooleanOption(
                context.options,
                'showDetails',
                true,
              );
              if (showDetails) {
                console.log('\n=== User Information ===');
                for (const [key, value] of Object.entries(userInfo)) {
                  if (key !== 'ok') {
                    console.log(`${key}: ${value}`);
                  }
                }
                console.log('========================\n');
              }

              return {
                ...state,
                userInfo,
                reason: 'User info retrieved successfully',
              };
            } catch (error) {
              console.log(
                '✗ Failed to get user info:',
                error instanceof Error ? error.message : 'Unknown error',
              );
              return {
                ...state,
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
          execute: async (
            context: CommandContext,
            previousResult?: unknown,
          ) => {
            const state = toObjectState<AuthCheckState>(previousResult, {});
            if (state.validated) {
              console.log('✓ Authentication check completed successfully');
              return {
                ...state,
                authCheckComplete: true,
                status: 'authenticated',
              };
            }

            console.log('✗ Authentication check failed');

            const autoLogin = getBooleanOption(
              context.options,
              'autoLogin',
              false,
            );
            if (autoLogin) {
              console.log('Attempting automatic login...');
              try {
                await userCommands.login({ args: [] });
                console.log('✓ Automatic login successful');
                return {
                  ...state,
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
                  ...state,
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
                ...state,
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

              if (session?.token) {
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
          execute: async (
            context: CommandContext,
            previousResult?: unknown,
          ) => {
            const state = toObjectState<LoginFlowState>(previousResult, {});
            if (state.alreadyLoggedIn) {
              console.log('Skipping login - user already authenticated');
              return {
                ...state,
                loginPerformed: false,
                loginSuccess: true,
              };
            }

            console.log('Performing login...');

            try {
              const loginArgs: string[] = [];
              const email = getOptionalStringOption(context.options, 'email');
              if (email) {
                loginArgs.push(email);
              }
              const password = getOptionalStringOption(
                context.options,
                'password',
              );
              if (password) {
                loginArgs.push(password);
              }

              await userCommands.login({ args: loginArgs });
              console.log('✓ Login successful');

              return {
                ...state,
                loginPerformed: true,
                loginSuccess: true,
              };
            } catch (error) {
              console.log(
                '✗ Login failed:',
                error instanceof Error ? error.message : 'Unknown error',
              );
              return {
                ...state,
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
          execute: async (
            context: CommandContext,
            previousResult?: unknown,
          ) => {
            const state = toObjectState<LoginFlowState>(previousResult, {});
            if (!state.loginSuccess && !state.alreadyLoggedIn) {
              console.log('Login failed, skipping validation');
              return {
                ...state,
                validationPerformed: false,
                validationSuccess: false,
              };
            }

            const validateAfterLogin = getBooleanOption(
              context.options,
              'validateAfterLogin',
              true,
            );
            if (!validateAfterLogin) {
              console.log('Skipping validation as requested');
              return {
                ...state,
                validationPerformed: false,
                validationSuccess: true,
              };
            }

            console.log('Validating login by getting user information...');

            try {
              const userInfo = await userCommands.me();
              console.log('✓ Login validation successful');

              return {
                ...state,
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
                ...state,
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
          execute: async (
            context: CommandContext,
            previousResult?: unknown,
          ) => {
            const state = toObjectState<LoginFlowState>(previousResult, {});
            console.log('\n=== Login Flow Summary ===');

            if (state.alreadyLoggedIn) {
              console.log('Status: Already logged in');
              console.log('Session: Valid');
            } else if (state.loginSuccess) {
              console.log('Status: Login successful');
              if (state.validationSuccess) {
                console.log('Validation: Passed');
              } else {
                console.log('Validation: Failed');
              }
            } else {
              console.log('Status: Login failed');
              console.log('Error:', state.loginError || 'Unknown error');
            }

            console.log('==========================\n');

            return {
              ...state,
              flowComplete: true,
              finalStatus:
                state.alreadyLoggedIn || state.loginSuccess
                  ? 'success'
                  : 'failed',
            };
          },
        },
      ],
    },
  ],
};
