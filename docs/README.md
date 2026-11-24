# 模块模块化改良计划开发与验证

[使用说明](../README.zh.md)介绍管理卡的安装和五个开关。

## 命名与本地化

中文管理器的正式名称为「模块模块化改良计划」。
开头重复的「模块」是有意设计的叠词，维护中文文案时保留完整名称。
英文正式名称为「Atlas Modular Improvement Plan」。
其他语言采用各自的译名。每个开关在对应语言下都与成员包的 `meta.title` 一致。

## 行为

管理卡通过 `plugins.bundle.config` 插槽按工作区、会话、列表、插件、移动端的顺序渲染五个开关。
它从 `pluginManager.listBundles` 获取当前 profile 的整包状态，并在收到 `plugin-manager/changed` 或连接恢复后更新。

开启尚未安装的成员包时，管理卡按包名调用 DSH 的 `installBundle`，优先请求 npm 公共 registry，保存实际安装的精确版本。
安装后先读取目标 bundle，检查行 ID 是否已由其他启用的 bundle 定义，再保存启用状态。
若启用在保存选择后失败，管理卡尝试恢复停用状态并报告结果。
再次开启和关闭都使用 `setBundleEnabled`，复用已有安装和逐项设置。

## 成员图标

开关行显示各成员包的图标。日常构建和页面直接使用随插件保存的图标，成员尚未安装时也有图标。
[图标清单](../src/client/published-icons.ts) 记录包名、版本和资源路径。
列表图标取自本地 List Atlas 源码，对应计划发布的 npm `0.1.0`。
`npm pack` 在打包前执行 `npm run sync:atlas-icons`，从各成员包的 `latest` 版本读取图标，再构建客户端。
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
测试覆盖五个成员包的 npm 首次安装与已有安装复用，以及包文件缺失、并行安装、行 ID 冲突和启用失败后的状态。
客户端测试核对插槽的注册和释放，以及列表开关的八语标题。
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
