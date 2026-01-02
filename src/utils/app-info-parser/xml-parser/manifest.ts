// From https://github.com/openstf/adbkit-apkreader
import { BinaryXmlParser } from './binary';

const INTENT_MAIN = 'android.intent.action.MAIN';
const CATEGORY_LAUNCHER = 'android.intent.category.LAUNCHER';

export class ManifestParser {
  private buffer: Buffer;
  private xmlParser: BinaryXmlParser;

  constructor(buffer: Buffer, options: Record<string, any> = {}) {
    this.buffer = buffer;
    this.xmlParser = new BinaryXmlParser(this.buffer, options);
  }

  private collapseAttributes(element: any) {
    const collapsed: Record<string, any> = Object.create(null);
    for (const attr of Array.from(element.attributes)) {
      collapsed[attr.name] = attr.typedValue.value;
    }
    return collapsed;
  }

  private parseIntents(element: any, target: any) {
    target.intentFilters = [];
    target.metaData = [];

    for (const child of element.childNodes) {
      switch (child.nodeName) {
        case 'intent-filter': {
          const intentFilter = this.collapseAttributes(child);

          intentFilter.actions = [];
          intentFilter.categories = [];
          intentFilter.data = [];

          for (const item of child.childNodes) {
            switch (item.nodeName) {
              case 'action':
                intentFilter.actions.push(this.collapseAttributes(item));
                break;
              case 'category':
                intentFilter.categories.push(this.collapseAttributes(item));
                break;
              case 'data':
                intentFilter.data.push(this.collapseAttributes(item));
                break;
            }
          }

          target.intentFilters.push(intentFilter);
          break;
        }
        case 'meta-data':
          target.metaData.push(this.collapseAttributes(child));
          break;
      }
    }
  }

  private parseApplication(element: any) {
    const app = this.collapseAttributes(element);

    app.activities = [];
    app.activityAliases = [];
    app.launcherActivities = [];
    app.services = [];
    app.receivers = [];
    app.providers = [];
    app.usesLibraries = [];
    app.metaData = [];

    for (const child of element.childNodes) {
      switch (child.nodeName) {
        case 'activity': {
          const activity = this.collapseAttributes(child);
          this.parseIntents(child, activity);
          app.activities.push(activity);
          if (this.isLauncherActivity(activity)) {
            app.launcherActivities.push(activity);
          }
          break;
        }
        case 'activity-alias': {
          const activityAlias = this.collapseAttributes(child);
          this.parseIntents(child, activityAlias);
          app.activityAliases.push(activityAlias);
          if (this.isLauncherActivity(activityAlias)) {
            app.launcherActivities.push(activityAlias);
          }
          break;
        }
        case 'service': {
          const service = this.collapseAttributes(child);
          this.parseIntents(child, service);
          app.services.push(service);
          break;
        }
        case 'receiver': {
          const receiver = this.collapseAttributes(child);
          this.parseIntents(child, receiver);
          app.receivers.push(receiver);
          break;
        }
        case 'provider': {
          const provider = this.collapseAttributes(child);

          provider.grantUriPermissions = [];
          provider.metaData = [];
          provider.pathPermissions = [];

          for (const item of child.childNodes) {
            switch (item.nodeName) {
              case 'grant-uri-permission':
                provider.grantUriPermissions.push(
                  this.collapseAttributes(item),
                );
                break;
              case 'meta-data':
                provider.metaData.push(this.collapseAttributes(item));
                break;
              case 'path-permission':
                provider.pathPermissions.push(this.collapseAttributes(item));
                break;
            }
          }

          app.providers.push(provider);
          break;
        }
        case 'uses-library':
          app.usesLibraries.push(this.collapseAttributes(child));
          break;
        case 'meta-data':
          app.metaData.push(this.collapseAttributes(child));
          break;
      }
    }

    return app;
  }

  private isLauncherActivity(activity: any) {
    return activity.intentFilters.some((filter: any) => {
      const hasMain = filter.actions.some(
        (action: any) => action.name === INTENT_MAIN,
      );
      if (!hasMain) {
        return false;
      }
      return filter.categories.some(
        (category: any) => category.name === CATEGORY_LAUNCHER,
      );
    });
  }

  parse() {
    const document = this.xmlParser.parse();
    const manifest = this.collapseAttributes(document);

    manifest.usesPermissions = [];
    manifest.usesPermissionsSDK23 = [];
    manifest.permissions = [];
    manifest.permissionTrees = [];
    manifest.permissionGroups = [];
    manifest.instrumentation = null;
    manifest.usesSdk = null;
    manifest.usesConfiguration = null;
    manifest.usesFeatures = [];
    manifest.supportsScreens = null;
    manifest.compatibleScreens = [];
    manifest.supportsGlTextures = [];
    manifest.application = Object.create(null);

    for (const element of document.childNodes) {
      switch (element.nodeName) {
        case 'uses-permission':
          manifest.usesPermissions.push(this.collapseAttributes(element));
          break;
        case 'uses-permission-sdk-23':
          manifest.usesPermissionsSDK23.push(this.collapseAttributes(element));
          break;
        case 'permission':
          manifest.permissions.push(this.collapseAttributes(element));
          break;
        case 'permission-tree':
          manifest.permissionTrees.push(this.collapseAttributes(element));
          break;
        case 'permission-group':
          manifest.permissionGroups.push(this.collapseAttributes(element));
          break;
        case 'instrumentation':
          manifest.instrumentation = this.collapseAttributes(element);
          break;
        case 'uses-sdk':
          manifest.usesSdk = this.collapseAttributes(element);
          break;
        case 'uses-configuration':
          manifest.usesConfiguration = this.collapseAttributes(element);
          break;
        case 'uses-feature':
          manifest.usesFeatures.push(this.collapseAttributes(element));
          break;
        case 'supports-screens':
          manifest.supportsScreens = this.collapseAttributes(element);
          break;
        case 'compatible-screens':
          for (const screen of element.childNodes) {
            manifest.compatibleScreens.push(this.collapseAttributes(screen));
          }
          break;
        case 'supports-gl-texture':
          manifest.supportsGlTextures.push(this.collapseAttributes(element));
          break;
        case 'application':
          manifest.application = this.parseApplication(element);
          break;
      }
    }

    return manifest;
  }
}
