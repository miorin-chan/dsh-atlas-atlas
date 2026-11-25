# 模块模块化改良计划开发与验证

[使用说明](../README.zh.md)介绍管理卡的安装和六个开关。

## 命名与本地化

中文管理器的正式名称为「模块模块化改良计划」。
开头重复的「模块」是有意设计的叠词，维护中文文案时保留完整名称。
英文正式名称为「Atlas Modular Improvement Plan」。
其他语言采用各自的译名。每个开关在对应语言下都与成员包的 `meta.title` 一致。

## 行为

管理卡通过 `plugins.bundle.config` 插槽按工作区、会话、列表、插件、移动端、脉络的顺序渲染六个开关，
并基于 `dsh.aggregate` 自动发现 profile 中已安装的其他聚合包。
它从 `pluginManager.listBundles` 获取当前 profile 的整包状态，并在收到 `plugin-manager/changed` 或连接恢复后更新。

开启尚未安装的成员包时，管理卡按包名调用 DSH 的 `installBundle`，优先请求 npm 公共 registry，保存实际安装的精确版本。
安装后先读取目标 bundle，检查行 ID 是否已由其他启用的 bundle 定义，再保存启用状态。
若启用在保存选择后失败，管理卡尝试恢复停用状态并报告结果。
默认模式下，再次开启和关闭都使用 `setBundleEnabled`，复用已有安装和逐项设置。
脉络是本地成员，尚未安装时显示本地安装提示，不尝试请求 npm。

## 双本地链接与开发模式

Host 在 `Config` 中维护 `localDevEnabled`（默认 `false`）和 `localWorkspaceDir`（默认 `''`），
并通过受浏览器会话鉴权的 `POST /api/dsh-atlas-local-dev` 路由提供状态探测与来源切换：

- **Feature 1（包本体切本地）**：针对任意可管理的单插件或聚合包，
  在基线来源与 `link:<localWorkspaceDir>/<basename>` 之间切换。
- **Feature 2（聚合成员切本地）**：针对声明 `dsh.aggregate` 的聚合包，
  在 profile 私有目录 `<profileDir>/dsh-atlas-local-dev/overlays/<safePkg>/<id>/` 合成 overlay，
  用 `yaml` AST 重新生成 `cordis.patch.yml` 并链接本地直接成员，不写入用户源码目录。
- 两者在聚合包上可正交组合成 4 种状态，每次切换保留原 `enabled` 状态、具备失败回滚和外部漂移保护，
  并在切换完成后自动回收旧 overlay 目录。
- `localDevEnabled` 关闭时，详情页 `plugins.detail.badge` 与 `plugins.detail.section` 直接返回 `null` 且不发起请求；
  开启后在详情页自然底部位置（不使用 CSS `order` hack）按单包或聚合包分别显示控制项。

成员已安装、已停用且可卸载时，成员开关旁显示红色垃圾桶。
确认时重新检查成员状态，再调用 DSH 的 `removeBundle`。
这会从当前 profile 的依赖清单移除成员，保留本地仓库文件。

## 成员图标

开关行显示各成员包的图标。日常构建和页面直接使用随插件保存的图标，成员尚未安装时也有图标。
[图标清单](../src/client/published-icons.ts) 记录包名、版本和资源路径。
列表图标取自本地 List Atlas 源码，对应计划发布的 npm `0.1.0`。
`npm pack` 在打包前执行 `npm run sync:atlas-icons`，从可通过 npm 安装的成员包的 `latest` 版本读取图标，再构建客户端。
本地成员跳过 npm 查询。脉络的嵌入图标记录在[本地图标清单](../src/client/local-icons.ts)。
列表包发布后即可执行这一步。

## 本地安装与开发检查

在新检出的仓库中先运行下面的依赖安装命令，`prepare` 会构建插件。
本地安装时，随后在 DSH 的 **插件 → 添加插件** 中选择该目录。
开发检查按以下顺序执行。

```sh
pnpm install --frozen-lockfile
npm test
npm run check
```

测试直接导入从 `src/lib/atlas.ts` 编译的 `lib/atlas.js`，Git 忽略这份产物。
`npm test` 会先构建再运行测试。`npm run check` 读取现有产物并核对它们与源码是否一致。

从工作区运行 `node tools/new-dsh-plugin/cli.mts --check plugins/dsh-atlas-atlas`。
测试覆盖 npm 首次安装、本地链接、脉络未安装时不发起 npm 请求、已有安装复用，
以及包文件缺失、并行安装、行 ID 冲突和启用失败后的状态。
客户端测试核对插槽注册和释放、开关顺序、八语标题与本地安装提示。
开关适配的官方代码版本和许可见 [第三方声明](../THIRD-PARTY-NOTICES.md)。

## 一次性 profile 实测（0.1.0）

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
