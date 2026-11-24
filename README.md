# Modular Improvement Plan Manager

[简体中文](README.zh.md)

Manage the workspace, session, runtime, plugin, and mobile bundles for the current profile from one page.
In DeepSeek Harness Web or Desktop, open **Plugins → Add plugin** and enter `@miorin/dsh-atlas-atlas`.
Open **Plugins → Modular Improvement Plan Manager** to use the five switches.

The manager requires DSH `0.2.2-rc.5` or newer.
DSH checks each member bundle's version requirements when it installs.
The first time you turn on a bundle, DSH installs it from npm.
Turning it off keeps the installed copy and its plugin settings.

[Development and verification](docs/README.md)
