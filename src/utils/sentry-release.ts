import * as fs from 'fs-extra';
import path from 'path';

const g2js: {
  parseFile: (filePath: string) => Promise<unknown>;
} = require('gradle-to-js/lib/parser');
const properties: {
  parse: (content: string) => Record<string, unknown>;
} = require('properties');

export interface SentryReleaseOptions {
  sentryRelease?: string;
  sentryDist?: string;
  sentryFlavor?: string;
}

export interface ResolvedSentryRelease {
  release: string;
  dist?: string;
}

type GradleObject = Record<string, unknown>;

type GradleResolveContext = {
  appConfig: GradleObject;
  rootConfig: GradleObject;
  gradleProperties: GradleObject;
};

type AndroidVariantSelection = {
  flavorConfig?: GradleObject;
  buildTypeConfig?: GradleObject;
};

function normalizeString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function firstString(...values: Array<string | undefined>): string | undefined {
  return values.map(normalizeString).find(Boolean);
}

function asObject(value: unknown): GradleObject | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as GradleObject;
  }
  return undefined;
}

function asGradleScalar(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return normalizeString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function getObjectValue(
  object: GradleObject | undefined,
  key: string,
): unknown {
  return object?.[key];
}

function getObjectBlock(
  object: GradleObject | undefined,
  key: string,
): GradleObject | undefined {
  return asObject(getObjectValue(object, key));
}

function findKeyCaseInsensitive(
  object: GradleObject | undefined,
  key: string,
): string | undefined {
  const normalized = key.toLowerCase();
  return Object.keys(object ?? {}).find(
    (candidate) => candidate.toLowerCase() === normalized,
  );
}

function getBlockCaseInsensitive(
  object: GradleObject | undefined,
  key: string | undefined,
): GradleObject | undefined {
  if (!key) {
    return undefined;
  }

  const resolvedKey = findKeyCaseInsensitive(object, key);
  return resolvedKey ? getObjectBlock(object, resolvedKey) : undefined;
}

function parsePropertiesFile(filePath: string): GradleObject {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    return properties.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

async function parseGradleFile(filePath: string): Promise<GradleObject> {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    return asObject(await g2js.parseFile(filePath)) ?? {};
  } catch {
    return {};
  }
}

function readGradleProperties(projectRoot: string): GradleObject {
  return {
    ...parsePropertiesFile(path.join(projectRoot, 'gradle.properties')),
    ...parsePropertiesFile(
      path.join(projectRoot, 'android', 'gradle.properties'),
    ),
  };
}

function findExtValue(
  propertyName: string,
  context: GradleResolveContext,
): unknown {
  const appExt = getObjectBlock(context.appConfig, 'ext');
  const rootExt = getObjectBlock(context.rootConfig, 'ext');
  const buildscriptExt = getObjectBlock(
    getObjectBlock(context.rootConfig, 'buildscript'),
    'ext',
  );

  return (
    getObjectValue(appExt, propertyName) ??
    getObjectValue(rootExt, propertyName) ??
    getObjectValue(buildscriptExt, propertyName) ??
    getObjectValue(context.gradleProperties, propertyName)
  );
}

function resolveGradleScalar(
  value: unknown,
  context: GradleResolveContext,
): string | undefined {
  const raw = asGradleScalar(value);
  if (!raw) {
    return undefined;
  }

  const extReference = raw.match(
    /^(?:rootProject\.|project\.)?ext\.([A-Za-z_][\w]*)$/,
  );
  if (extReference) {
    return resolveGradleScalar(findExtValue(extReference[1], context), context);
  }

  const directProperty = getObjectValue(context.gradleProperties, raw);
  if (directProperty !== undefined) {
    return resolveGradleScalar(directProperty, context);
  }

  if (/[(){}?=]/.test(raw) || raw.includes(' ')) {
    return undefined;
  }

  return raw;
}

function pickAndroidVariant(
  productFlavors: GradleObject | undefined,
  buildTypes: GradleObject | undefined,
  flavorOrVariant: string | undefined,
): AndroidVariantSelection | undefined {
  const defaultBuildTypeName = findKeyCaseInsensitive(buildTypes, 'release');

  if (!flavorOrVariant) {
    const flavorNames = Object.keys(productFlavors ?? {});
    const onlyFlavor = flavorNames.length === 1 ? flavorNames[0] : undefined;
    return {
      flavorConfig: getBlockCaseInsensitive(productFlavors, onlyFlavor),
      buildTypeConfig: getBlockCaseInsensitive(
        buildTypes,
        defaultBuildTypeName,
      ),
    };
  }

  const exactFlavor = findKeyCaseInsensitive(productFlavors, flavorOrVariant);
  if (exactFlavor) {
    return {
      flavorConfig: getObjectBlock(productFlavors, exactFlavor),
      buildTypeConfig: getBlockCaseInsensitive(
        buildTypes,
        defaultBuildTypeName,
      ),
    };
  }

  const exactBuildType = findKeyCaseInsensitive(buildTypes, flavorOrVariant);
  if (exactBuildType) {
    return {
      buildTypeConfig: getObjectBlock(buildTypes, exactBuildType),
    };
  }

  for (const buildTypeName of Object.keys(buildTypes ?? {}).sort(
    (a, b) => b.length - a.length,
  )) {
    if (
      flavorOrVariant.toLowerCase().endsWith(buildTypeName.toLowerCase()) &&
      flavorOrVariant.length > buildTypeName.length
    ) {
      const flavorName = flavorOrVariant.slice(
        0,
        flavorOrVariant.length - buildTypeName.length,
      );
      const variantFlavor = findKeyCaseInsensitive(productFlavors, flavorName);
      if (variantFlavor) {
        return {
          flavorConfig: getObjectBlock(productFlavors, variantFlavor),
          buildTypeConfig: getObjectBlock(buildTypes, buildTypeName),
        };
      }
    }
  }

  return undefined;
}

function appendResolvedSuffix(
  value: string,
  suffixSource: unknown,
  context: GradleResolveContext,
): string {
  const suffix = resolveGradleScalar(suffixSource, context);
  return suffix ? `${value}${suffix}` : value;
}

export async function resolveAndroidSentryReleaseAndDist({
  projectRoot = process.cwd(),
  flavor,
  dist,
}: {
  projectRoot?: string;
  flavor?: string;
  dist?: string;
} = {}): Promise<ResolvedSentryRelease | undefined> {
  const appGradlePath = path.join(
    projectRoot,
    'android',
    'app',
    'build.gradle',
  );
  const rootGradlePath = path.join(projectRoot, 'android', 'build.gradle');
  const appConfig = await parseGradleFile(appGradlePath);
  const rootConfig = await parseGradleFile(rootGradlePath);
  const androidConfig = getObjectBlock(appConfig, 'android');
  const defaultConfig = getObjectBlock(androidConfig, 'defaultConfig');
  if (!androidConfig || !defaultConfig) {
    return undefined;
  }

  const context: GradleResolveContext = {
    appConfig,
    rootConfig,
    gradleProperties: readGradleProperties(projectRoot),
  };
  const selection = pickAndroidVariant(
    getObjectBlock(androidConfig, 'productFlavors'),
    getObjectBlock(androidConfig, 'buildTypes'),
    normalizeString(flavor),
  );
  if (!selection) {
    return undefined;
  }

  const { flavorConfig, buildTypeConfig } = selection;
  let applicationId =
    resolveGradleScalar(
      getObjectValue(flavorConfig, 'applicationId'),
      context,
    ) ??
    resolveGradleScalar(
      getObjectValue(defaultConfig, 'applicationId'),
      context,
    ) ??
    resolveGradleScalar(getObjectValue(androidConfig, 'namespace'), context);
  let versionName =
    resolveGradleScalar(getObjectValue(flavorConfig, 'versionName'), context) ??
    resolveGradleScalar(getObjectValue(defaultConfig, 'versionName'), context);
  const versionCode =
    normalizeString(dist) ??
    resolveGradleScalar(getObjectValue(flavorConfig, 'versionCode'), context) ??
    resolveGradleScalar(getObjectValue(defaultConfig, 'versionCode'), context);

  if (!applicationId || !versionName || !versionCode) {
    return undefined;
  }

  applicationId = appendResolvedSuffix(
    applicationId,
    getObjectValue(flavorConfig, 'applicationIdSuffix'),
    context,
  );
  applicationId = appendResolvedSuffix(
    applicationId,
    getObjectValue(buildTypeConfig, 'applicationIdSuffix'),
    context,
  );
  versionName = appendResolvedSuffix(
    versionName,
    getObjectValue(flavorConfig, 'versionNameSuffix'),
    context,
  );
  versionName = appendResolvedSuffix(
    versionName,
    getObjectValue(buildTypeConfig, 'versionNameSuffix'),
    context,
  );

  return {
    release: `${applicationId}@${versionName}+${versionCode}`,
    dist: versionCode,
  };
}

export async function resolveSentryReleaseAndDist(
  platform: string,
  fallbackVersion: string,
  options: SentryReleaseOptions = {},
  projectRoot = process.cwd(),
): Promise<ResolvedSentryRelease> {
  const releaseOverride = firstString(
    options.sentryRelease,
    process.env.SENTRY_RELEASE,
  );
  const distOverride = firstString(options.sentryDist, process.env.SENTRY_DIST);

  if (releaseOverride) {
    return {
      release: releaseOverride,
      dist: distOverride,
    };
  }

  if (platform === 'android') {
    const androidRelease = await resolveAndroidSentryReleaseAndDist({
      projectRoot,
      flavor: firstString(
        options.sentryFlavor,
        process.env.PUSHY_SENTRY_FLAVOR,
        process.env.SENTRY_FLAVOR,
      ),
      dist: distOverride,
    });

    if (androidRelease) {
      console.log(
        `[pushy/sentry] Using Android native release=${androidRelease.release}, dist=${androidRelease.dist}`,
      );
      return androidRelease;
    }
  }

  console.warn(
    `[pushy/sentry] Falling back to Pushy version "${fallbackVersion}" as Sentry release. ` +
      'Set --sentry-release/--sentry-dist, SENTRY_RELEASE/SENTRY_DIST, or --sentry-flavor/PUSHY_SENTRY_FLAVOR for OTA symbolication.',
  );
  return {
    release: fallbackVersion,
    dist: distOverride,
  };
}
