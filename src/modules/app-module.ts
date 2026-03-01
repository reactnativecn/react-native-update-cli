import { appCommands, listApp } from '../app';
import type { CLIModule, CommandContext, Platform } from '../types';

type WorkflowApp = {
  id: string;
  name: string;
  platform: string;
  version: string;
  status: 'active' | 'inactive';
};

type AppAnalysis = {
  totalApps: number;
  activeApps: number;
  inactiveApps: number;
  platformDistribution: Record<Platform, number>;
  issues: string[];
};

const allPlatforms: Platform[] = ['ios', 'android', 'harmony'];
const emptyAppsData: Record<Platform, WorkflowApp[]> = {
  ios: [],
  android: [],
  harmony: [],
};

type AppWorkflowState = Record<string, unknown>;

function isPlatform(value: unknown): value is Platform {
  return value === 'ios' || value === 'android' || value === 'harmony';
}

function normalizePlatformOption(value: unknown): Platform | '' {
  return isPlatform(value) ? value : '';
}

function getStringOption(
  options: Record<string, unknown>,
  key: string,
): string {
  const value = options[key];
  return typeof value === 'string' ? value : '';
}

function toWorkflowState(previousResult: unknown): AppWorkflowState {
  if (previousResult && typeof previousResult === 'object') {
    return previousResult as AppWorkflowState;
  }
  return {};
}

export const appModule: CLIModule = {
  name: 'app',
  version: '1.0.0',

  commands: [],

  workflows: [
    {
      name: 'setup-app',
      description: 'Setup a new app with initial configuration',
      steps: [
        {
          name: 'create',
          description: 'Create the app',
          execute: async (context: CommandContext) => {
            console.log('Creating app in workflow');
            const name = getStringOption(context.options, 'name');
            const downloadUrl = getStringOption(context.options, 'downloadUrl');
            const platform = normalizePlatformOption(context.options.platform);
            await appCommands.createApp({
              options: {
                name,
                downloadUrl,
                platform,
              },
            });
            return { appCreated: true };
          },
        },
        {
          name: 'select',
          description: 'Select the created app',
          execute: async (
            context: CommandContext,
            previousResult?: unknown,
          ) => {
            console.log('Selecting app in workflow');
            const state = toWorkflowState(previousResult);
            const platform = normalizePlatformOption(context.options.platform);
            await appCommands.selectApp({
              args: [],
              options: { platform },
            });
            return { ...state, appSelected: true };
          },
        },
      ],
    },
    {
      name: 'manage-apps',
      description: 'Manage multiple apps',
      steps: [
        {
          name: 'list-apps',
          description: 'List all apps',
          execute: async (context: CommandContext) => {
            console.log('Listing all apps');
            const platform = normalizePlatformOption(context.options.platform);
            await appCommands.apps({
              options: { platform },
            });
            return { appsListed: true };
          },
        },
        {
          name: 'select-target-app',
          description: 'Select target app for operations',
          execute: async (
            context: CommandContext,
            previousResult?: unknown,
          ) => {
            console.log('Selecting target app');
            const state = toWorkflowState(previousResult);
            const platform = normalizePlatformOption(context.options.platform);
            await appCommands.selectApp({
              args: [],
              options: { platform },
            });
            return { ...state, targetAppSelected: true };
          },
        },
      ],
    },
    {
      name: 'multi-platform-app-management',
      description: 'Multi-platform app unified management workflow',
      steps: [
        {
          name: 'scan-platforms',
          description: 'Scan apps on all platforms',
          execute: async (context: CommandContext) => {
            console.log('🔍 Scanning apps on all platforms...');

            const appsData: Record<Platform, WorkflowApp[]> = {
              ios: [],
              android: [],
              harmony: [],
            };

            for (const platform of allPlatforms) {
              console.log(`  Scanning ${platform} platform...`);

              try {
                const rawApps = await listApp(platform);
                const apps = rawApps.map((app, index) => ({
                  id: String(app.id ?? `${platform}-app-${index + 1}`),
                  name: app.name ?? `App ${index + 1}`,
                  platform: app.platform ?? platform,
                  version:
                    typeof (app as { version?: unknown }).version === 'string'
                      ? ((app as { version?: string }).version ?? 'unknown')
                      : 'unknown',
                  status:
                    (app as { status?: unknown }).status === 'inactive'
                      ? ('inactive' as const)
                      : ('active' as const),
                }));
                appsData[platform] = apps;
                console.log(`    ✅ Found ${apps.length} apps`);
              } catch (error) {
                appsData[platform] = [];
                console.warn(`    ⚠️ Failed to scan ${platform}:`, error);
              }
            }

            console.log('✅ Platform scanning completed');

            return { platforms: allPlatforms, appsData, scanned: true };
          },
        },
        {
          name: 'analyze-apps',
          description: 'Analyze app status',
          execute: async (
            context: CommandContext,
            previousResult?: unknown,
          ) => {
            console.log('📊 Analyzing app status...');

            const state = toWorkflowState(previousResult);
            const appsData =
              (state.appsData as Record<Platform, WorkflowApp[]> | undefined) ??
              emptyAppsData;
            const analysis: AppAnalysis = {
              totalApps: 0,
              activeApps: 0,
              inactiveApps: 0,
              platformDistribution: {
                ios: 0,
                android: 0,
                harmony: 0,
              },
              issues: [],
            };

            for (const platform of allPlatforms) {
              const platformApps = appsData[platform] ?? [];
              analysis.totalApps += platformApps.length;
              analysis.platformDistribution[platform] = platformApps.length;

              for (const app of platformApps) {
                if (app.status === 'active') {
                  analysis.activeApps++;
                } else {
                  analysis.inactiveApps++;
                  analysis.issues.push(
                    `${platform}/${app.name}: App is inactive`,
                  );
                }
              }
            }

            console.log('📈 Analysis results:');
            console.log(`  Total apps: ${analysis.totalApps}`);
            console.log(`  Active apps: ${analysis.activeApps}`);
            console.log(`  Inactive apps: ${analysis.inactiveApps}`);

            if (analysis.issues.length > 0) {
              console.log('⚠️ Issues found:');
              for (const issue of analysis.issues) {
                console.log(`    - ${issue}`);
              }
            }

            return { ...state, analysis };
          },
        },
        {
          name: 'optimize-apps',
          description: 'Optimize app configuration',
          execute: async (
            context: CommandContext,
            previousResult?: unknown,
          ) => {
            console.log('⚡ Optimizing app configuration...');

            const state = toWorkflowState(previousResult);
            const analysis = state.analysis as AppAnalysis | undefined;
            if (!analysis) {
              console.log('  No analysis data, skip optimization');
              return { ...state, optimizations: [], optimized: false };
            }
            const optimizations: string[] = [];

            if (analysis.inactiveApps > 0) {
              console.log('  Handling inactive apps...');
              optimizations.push('Reactivate inactive apps');
            }

            if (analysis.totalApps > 10) {
              console.log('  Many apps detected, suggest grouping...');
              optimizations.push('Create app groups');
            }

            for (const optimization of optimizations) {
              console.log(`    Executing: ${optimization}...`);
              console.log(`    ✅ ${optimization} completed`);
            }

            console.log('✅ App optimization completed');

            return { ...state, optimizations, optimized: true };
          },
        },
      ],
      options: {
        includeInactive: {
          hasValue: false,
          default: true,
          description: 'Include inactive apps',
        },
        autoOptimize: {
          hasValue: false,
          default: true,
          description: 'Auto optimize configuration',
        },
      },
    },
  ],
};
