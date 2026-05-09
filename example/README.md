# React Native Update CLI Examples

[中文文档](./README.zh-CN.md)

This directory contains examples for using the React Native Update CLI programmatic Provider API and command options.

## Directory Structure

```text
example/
├── scripts/
│   └── provider-api-example.ts
├── USAGE_CUSTOM_VERSION.md
└── README.md
```

## Quick Start

```bash
npm run build
npm run provider-demo
```

## Provider API Example

```typescript
import { CLIProviderImpl } from 'react-native-update-cli';

const provider = new CLIProviderImpl();

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

Provider methods return `CommandResult`; callers should check `success` before consuming `data`.
