# 自定义模块示例

这个目录包含 React Native Update CLI 自定义模块和命令扩展示例。

## 目录结构

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

## 快速开始

```bash
npm run build
npx ts-node example/scripts/register-modules.ts
npx ts-node example/scripts/provider-api-example.ts
```

## 自定义模块示例

```typescript
import { moduleManager } from 'react-native-update-cli';
import { customDeployModule } from './modules/custom-deploy-module';

moduleManager.registerModule(customDeployModule);

await moduleManager.executeCommand('deploy-dev', {
  args: [],
  options: { platform: 'ios', force: true },
});
```

## Provider API 示例

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

## 注意事项

- 每个模块都应该有唯一的 `name`。
- 通过模块注册的每个命令都应该有唯一的 `name`。
- 命令处理函数返回 `CommandResult`；调用方应先检查 `success` 再消费 `data`。
