# Atlas Modular Improvement Plan

[简体中文](README.zh.md)

Manage the workspace, session, list, plugin, mobile, and continuity bundles for the current profile from one page.
In DeepSeek Harness Web or Desktop, open **Plugins → Add plugin** and enter `@miorin/dsh-atlas-atlas`.
Open **Plugins → Atlas Modular Improvement Plan** to use the six switches.

The manager requires DSH `0.2.2-rc.5` or newer.
DSH checks each member bundle's version requirements when it installs.
When you turn on a bundle, the manager reuses the existing installation, including a local link.
Install [List Atlas](https://github.com/miorin-chan/dsh-atlas-list) from its local checkout before using its switch.
Continuity Atlas is local only.
Prepare the `dsh-atlas-continuity` checkout and add it through Plugins, or use local repository links below.
Disable any standalone VCS Panel and Sideby Note bundles before enabling Continuity.
DSH can install published bundles from npm.
Turning a bundle off keeps the installed copy and its plugin settings.

To use local checkouts, turn on **Use local repository links**,
enter the absolute directory containing `dsh-atlas-workspace`, `dsh-atlas-session`,
and the other member repositories, then select **Save and link**.
Prepare the checkouts as their READMEs describe before linking.
Saving switches the source of installed members while keeping their on/off selections.
Members that are not installed link the first time you enable them.
If a link fails, check the member’s error details.
The manager does not reinstall the previous copy.
Turning off local mode keeps existing links.

[Development and verification](docs/README.md)
