import { pathExists } from './fs-helpers';
import { t } from './i18n';

/**
 * Bundle params implied by the project's plugins. Sentry (a sentry.properties
 * under ios/ or android/) turns on its source map upload, and with it the
 * source map itself.
 */
export async function checkPlugins(): Promise<{
  sentry: boolean;
  sourcemap: boolean;
}> {
  const [ios, android] = await Promise.all([
    pathExists('ios/sentry.properties'),
    pathExists('android/sentry.properties'),
  ]);
  const sentry = ios || android;
  if (sentry) {
    console.log(t('pluginDetected', { name: 'sentry' }));
  }
  return { sentry, sourcemap: sentry };
}
