# Atlas 管理开发与验证

[使用说明](../README.zh.md)介绍管理卡的安装和四个开关。

## 行为

管理卡通过 `plugins.bundle.config` 插槽渲染四个开关。
它从 `pluginManager.listBundles` 获取当前 profile 的整包状态，并在收到 `plugin-manager/changed` 或连接恢复后更新。

首次开启时，管理卡按包名调用 DSH 的 `installBundle`，优先请求 npm 公共 registry，保存实际安装的精确版本。
安装后先读取目标 bundle，检查行 ID 是否已由其他启用的 bundle 定义，再保存启用状态。
若启用在保存选择后失败，管理卡尝试恢复停用状态并报告结果。
再次开启和关闭都使用 `setBundleEnabled`，复用已有安装和逐项设置。

## 开发检查

```sh
pnpm install --ignore-scripts
npm run build
npm run check
```

从工作区运行 `node tools/new-dsh-plugin/cli.mjs --check plugins/dsh-atlas-atlas`。
测试覆盖 npm 首次安装、已有安装复用、包文件缺失、并行安装、行 ID 冲突、失败后的启用状态和插槽释放。
开关适配的官方代码版本和许可见 [第三方声明](../THIRD-PARTY-NOTICES.md)。

## 一次性 profile 实测

2026-11-23，使用 DSH `0.2.2-rc.5` 与 Chrome 驱动。
在一次性 `DSH_HOME` 安装管理插件的打包产物，模型引导使用回环夹具。

- 四项初始均为未安装。逐一开启后，profile 记录四个从 npm 安装的 `0.1.0` 及对应的 bundle 选择。
- 各项关闭、重新开启时，另外三个 Atlas 保持启用，依赖清单和 lockfile 保持一致。
- 将一次性 profile 的 `@miorin` registry 指向返回 404 的回环夹具时，
  移动端开关显示 npm 安装失败与重试提示，profile 清单和 lockfile 均保持一致。
  恢复 npm 后，用同一个开关完成安装。
- 在原生会话 Atlas 卡上关闭会话标题历史，整包停用再启用后，成员开关仍为关闭。
  管理卡整体停用时，详情区四个控制消失。
- 重载页面后确认状态，并检查英文浅色、英文深色和中文深色界面。
  Chrome 未报告未捕获异常或 Atlas 插槽错误。
