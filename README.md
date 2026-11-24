# Atlas Modular Improvement Plan

[简体中文](README.zh.md)

Manage the workspace, session, list, plugin, and mobile bundles for the current profile from one page.
In DeepSeek Harness Web or Desktop, open **Plugins → Add plugin** and enter `@miorin/dsh-atlas-atlas`.
Open **Plugins → Atlas Modular Improvement Plan** to use the five switches.

The manager requires DSH `0.2.2-rc.5` or newer.
DSH checks each member bundle's version requirements when it installs.
When you turn on a bundle, the manager reuses the existing installation, including a local link.
Install [List Atlas](https://github.com/miorin-chan/dsh-atlas-list) from its local checkout before using its switch.
DSH can install the other bundles from npm.
Turning a bundle off keeps the installed copy and its plugin settings.

[Development and verification](docs/README.md)
