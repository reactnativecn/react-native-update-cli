# Custom Version Parameter Usage

This document demonstrates how to use the `--version` parameter with upload commands to override the version extracted from APK/IPA/APP files.

## Commands Supporting Custom Version

- `uploadApk --version <version>`
- `uploadIpa --version <version>`
- `uploadApp --version <version>`

## Usage Examples

### Upload APK with Custom Version

```bash
# Upload APK and override version to "1.2.3-custom"
cresc uploadApk app-release.apk --version "1.2.3-custom"
```

### Upload IPA with Custom Version

```bash
# Upload IPA and override version to "2.0.0-beta"
cresc uploadIpa MyApp.ipa --version "2.0.0-beta"
```

### Upload APP with Custom Version

```bash
# Upload APP and override version to "3.1.0-harmony"
cresc uploadApp MyApp.app --version "3.1.0-harmony"
```

## Behavior

1. **Without `--version`**: The command uses the version extracted from the package file (APK/IPA/APP)
2. **With `--version`**: The command uses the provided custom version instead of the extracted version
3. **Console Output**: When using a custom version, the CLI will display "Using custom version: <version>" message

## Use Cases

- **Testing**: Upload test builds with specific version identifiers
- **Hotfixes**: Override version numbers for emergency releases
- **Version Alignment**: Ensure consistent versioning across different platforms
- **Manual Override**: When the extracted version is incorrect or inappropriate

## Example Output

```
$ cresc uploadApk app-release.apk --version "1.2.3-hotfix"
Using custom version: 1.2.3-hotfix
Successfully uploaded APK native package (id: 12345, version: 1.2.3-hotfix, buildTime: 2024-01-15T10:30:00Z)
```
