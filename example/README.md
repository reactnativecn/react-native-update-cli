# Custom Module Examples

[中文文档](./README.zh-CN.md)

This directory contains examples for extending React Native Update CLI with custom modules and commands.

## Directory Structure

```text
example/
├── modules/
│   ├── custom-deploy-module.ts
│   └── analytics-module.ts
├── scripts/
│   ├── register-modules.ts
│   └── provider-api-example.ts
└── README.md
```

## Quick Start

```bash
npm run build
npx ts-node example/scripts/register-modules.ts
npx ts-node example/scripts/provider-api-example.ts
```

## Custom Module Example

```typescript
import { moduleManager } from 'react-native-update-cli';
import { customDeployModule } from './modules/custom-deploy-module';

moduleManager.registerModule(customDeployModule);

await moduleManager.executeCommand('deploy-dev', {
  args: [],
  options: { platform: 'ios', force: true },
});
```

## Provider API Example

```typescript
import { moduleManager } from 'react-native-update-cli';

const provider = moduleManager.getProvider();

const bundleResult = await provider.bundle({
  platform: 'ios',
  dev: false,
  sourcemap: true,
});

const publishResult = await provider.publish({
  name: 'v1.0.0',
  description: 'Bug fixes',
  rollout: 100,
});
```

## Notes

- Each module should have a unique `name`.
- Each command registered through a module should have a unique `name`.
- Command handlers return `CommandResult`; callers should check `success` before consuming `data`.
