# React Native Update CLI 示例

这个目录包含 React Native Update CLI 编程式 Provider API 和命令参数示例。

## 目录结构

```text
example/
├── scripts/
│   └── provider-api-example.ts
├── USAGE_CUSTOM_VERSION.md
└── README.md
```

## 快速开始

```bash
npm run build
npm run provider-demo
```

## Provider API 示例

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

## 注意事项

Provider 方法返回 `CommandResult`；调用方应先检查 `success` 再消费 `data`。
