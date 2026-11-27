# 模块模块化改良计划开发与验证

[使用说明](../README.zh.md)介绍管理卡的安装与七个开关。

## 命名与本地化

中文管理器的正式名称为「模块模块化改良计划」。
开头重复的「模块」是有意设计的叠词，维护中文文案时保留完整名称。
英文正式名称为「Atlas Modular Improvement Plan」。
其他语言采用各自的译名。每个开关在对应语言下都与成员包的 `meta.title` 一致。

## 行为

管理卡本身不依赖第三方运行时 npm 包，通过 `plugins.bundle.config` 插槽按工作区、会话、列表、脉络、外观、插件、
移动端的顺序渲染七个开关，同时提供零依赖只读 Host 路由 `GET /api/dsh-atlas-aggregates`（浏览器会话鉴权），
从已安装 profile 包的 `package.json` 读取 `dsh.aggregate` 声明以发现包括未启用聚合包在内的第三方聚合包。
管理卡从 `pluginManager.listBundles` 获取当前 profile 的整包状态，
并在收到 `plugin-manager/changed` 或连接恢复后同步刷新。
对已启用且暴露了 `dsh-aggregate.config:<bundleName>` Slot Factory 的聚合包（包含官方七个与自动发现的聚合包），
管理卡订阅 `plugins.bundle.config` 与成员子槽变更，
在唯一列表内直接将可配置成员的标题（及图标）作为展开/折叠开关（默认收起）：
点击标题后就在该行下方缩进并带竖向引导线原位展开全部活跃成员设置（内部各子插件同样以子标题控制折叠/展开）。
对于已安装的官方或自动发现的聚合包，点击标题右侧跳转按钮调用 `ctx.pluginNavigation.openBundle` 打开详情页。

开启尚未安装的成员包时，管理卡按包名调用 DSH 的 `installBundle`，请求 npm 公共 registry，保存实际安装的精确版本。
安装后先读取目标 bundle，检查行 ID 是否已由其他启用的 bundle 定义，再保存启用状态。
若启用在保存选择后失败，管理卡尝试恢复停用状态并报告结果。
开启和关闭已安装成员时直接调用 `setBundleEnabled`，完整保留已有安装来源（包括本地链接或 overlay）与逐项设置。

成员已安装、已停用且可卸载时，成员开关旁显示红色垃圾桶。
确认时重新检查成员状态，再调用 DSH 的 `removeBundle` 从当前 profile 移除成员，保留本地目录文件。

本地源码切换、聚合包 overlay 组装以及逐个子插件的 npm/本地切换能力已拆出到独立开发者插件
[开发模块化改良计划](../../dsh-atlas-dev/docs/README.md)（`@miorin/dsh-atlas-dev`），使本管理器保持零运行时依赖，
同时让 `@miorin/dsh-atlas-dev` 能够直接切换 `@miorin/dsh-atlas-atlas` 自身的安装来源。

## 成员图标

开关行显示各成员包的图标。日常构建和页面直接使用随插件保存的图标，成员尚未安装时也有图标。
[图标清单](../src/client/published-icons.ts)记录包名、版本和资源路径。
`npm pack` 在打包前执行 `npm run sync:atlas-icons`，从全部成员包的 `latest` 版本读取图标再构建客户端。

## 本地安装与开发检查

```sh
pnpm install --frozen-lockfile
npm test
npm run check
```

测试直接导入从 `src/lib/atlas.ts` 和 `src/lib/discover-aggregates.ts` 编译的 `lib/*.js` 产物，Git 忽略这些产物。
从工作区根目录运行 `node tools/new-dsh-plugin/cli.mts --check plugins/dsh-atlas-atlas`。
开关适配的官方代码版本和许可见[第三方声明](../THIRD-PARTY-NOTICES.md)。

## 一次性 profile 实测（0.1.0）

2026-11-23，使用 DSH `0.2.2-rc.5` 与 Chrome 驱动。
在一次性 `DSH_HOME` 安装管理插件的打包产物，模型引导使用回环夹具。

- 初始未安装项逐一开启后，profile 记录从 npm 安装的 `0.1.0` 及对应的 bundle 选择；
  关闭和重开时其余项与 lockfile 保持一致。
- 将 registry 指向返回 404 的回环夹具时，开关显示 npm 安装失败与重试提示；恢复 npm 后可用同一开关完成安装。
- 关闭或恢复整包均保留子插件开关设置；管理卡整体停用时控制入口全部卸载。

## 一次性 profile 实测（单一列表与行内子标题折叠设置）

2026-11-25，使用 DSH `0.2.2-rc.5` 与 `tools/dsh-web-drive` 在一次性 `web` profile 加载 `dsh-atlas-atlas`、
`dsh-atlas-list` 与 `dsh-atlas-workspace`。

- 管理卡仅保留单一成员包列表，点击 List Atlas 标题在行内下方缩进展开子插件设置，
  点击跳转按钮打开 `@miorin/dsh-atlas-list` 详情页；全程无控制台错误、未捕获异常或日志报错。
