// src/release.ts
import { checkPlatform, translateOptions, question } from './utils';
import { diffFromPPK } from './bundle'; // Import the actual diffFromPPK
import { 
  executePublish, 
  getPackagesForUpdate, 
  bindVersionToPackages 
} from './versions'; // Import actual functions
import { tempDir, time } from './utils/constants'; // Adjust path if necessary
import { t } from './utils/i18n';
import { getSelectedApp } from './app'; // Added for appId

// _internal export can be removed or kept empty if tests are updated
// to mock imported functions directly (e.g. jest.mock('./versions')).
// For now, keeping it but its contents are no longer used by releaseFull itself.
const mockPublishForTest = async () => ({ id: 'test-id', versionName: 'test-name', hash: 'test-hash' });
const mockUpdateForTest = async () => {};
export const _internal = {
  performPublish: mockPublishForTest, // Placeholder for tests if they spy on _internal.performPublish
  performUpdate: mockUpdateForTest,   // Placeholder for tests if they spy on _internal.performUpdate
};

export const commands = {
  releaseFull: async function({ args, options }) {
    console.log(t('RELEASE_FULL_START')); // Assumes i18n key exists

    try {
      // Step 0: Option Processing & App ID
      const platform = await checkPlatform(options.platform);
      const { appId } = await getSelectedApp(platform); // Get appId
      
      const translatedOpts = await translateOptions(options, 'releaseFull');

      const {
        origin, // Path to original ppk/zip
        next,   // Path to next ppk/zip
        output, // User-specified output path for the diff package (optional)
        name,   // Name for the published bundle (bundle's version name)
        description,
        packageVersion, // Target NATIVE version for the update/binding
        metaInfo,
        rollout,
        dryRun
      } = translatedOpts;

      if (!origin || !next) {
        const errorMsg = t('RELEASE_FULL_ERROR_ORIGIN_NEXT_REQUIRED'); // Assumes i18n key
        console.error(errorMsg);
        // In a real CLI, you might throw new Error(errorMsg) or process.exit(1)
        return;
      }
      if (!packageVersion) {
        const errorMsg = t('RELEASE_FULL_ERROR_PACKAGE_VERSION_REQUIRED'); // Assumes i18n key for native package version
        console.error(errorMsg);
        return;
      }
       if (!name) {
        const errorMsg = t('RELEASE_FULL_ERROR_NAME_REQUIRED'); // Assumes i18n key for bundle name
        console.error(errorMsg);
        return;
      }


      // Step 1: Perform Diff
      console.log(t('RELEASE_FULL_DIFF_GENERATING')); // Assumes i18n key
      let diffPath; 
      try {
        // Default output path for diff if not provided by user
        // The 'output' from cli.json for releaseFull has a default: "${tempDir}/output/diff-${time}.ppk-patch"
        // translateOptions should have resolved this.
        const diffOutputPath = output; 
        // Call the actual diffFromPPK, defaulting to 'bsdiff'. 
        // 'bsdiff' is chosen as a default because releaseFull doesn't have a diff type option.
        await diffFromPPK(origin, next, diffOutputPath, 'bsdiff'); 
        diffPath = diffOutputPath; // The file is created at diffOutputPath
        console.log(t('RELEASE_FULL_DIFF_SUCCESS', { path: diffPath })); 
      } catch (error) {
        console.error(t('RELEASE_FULL_ERROR_DIFF'), error); 
        return; 
      }

      // Step 2: Publish Diff Bundle
      console.log(t('RELEASE_FULL_PUBLISH_START')); 
      let versionId;
      let publishedVersionName;
      try {
        // Call actual executePublish
        const publishResult = await executePublish({
          filePath: diffPath,
          platform,
          appId,
          name, // Name for the bundle version
          description,
          metaInfo,
          // packageVersion from releaseFull options is for native targeting, not bundle's own version here.
          // deps and commit are handled by executePublish if not provided.
        });
        versionId = publishResult.id;
        publishedVersionName = publishResult.versionName;
        console.log(t('RELEASE_FULL_PUBLISH_SUCCESS', { id: versionId, name: publishedVersionName })); 
      } catch (error) {
        console.error(t('RELEASE_FULL_ERROR_PUBLISH'), error); 
        return;
      }

      // Step 3: Update/Bind Version
      console.log(t('RELEASE_FULL_UPDATE_START')); 
      try {
        const pkgsToBind = await getPackagesForUpdate(appId, { 
          packageVersion: packageVersion // Target native package version
        });

        if (!pkgsToBind || pkgsToBind.length === 0) {
          console.error(t('RELEASE_FULL_ERROR_NO_PACKAGES_FOUND', { packageVersion: packageVersion }));
          return;
        }
        
        await bindVersionToPackages({
          appId,
          versionId,          // ID from the publish step
          pkgs: pkgsToBind,   // Packages obtained from getPackagesForUpdate
          rollout: rollout ? Number(rollout) : undefined, // Ensure rollout is a number
          dryRun,
        });
        console.log(t('RELEASE_FULL_UPDATE_SUCCESS')); 
      } catch (error) {
        console.error(t('RELEASE_FULL_ERROR_UPDATE'), error); 
        return; 
      }

      console.log(t('RELEASE_FULL_SUCCESS')); // Assumes i18n key

    } catch (error) {
      // Catch errors from checkPlatform, getSelectedApp, or translateOptions
      console.error(t('RELEASE_FULL_ERROR_UNEXPECTED'), error); // Assumes i18n key
    }
  }
};
