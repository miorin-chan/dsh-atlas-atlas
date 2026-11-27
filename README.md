# Atlas Modular Improvement Plan

[简体中文](README.zh.md)

Manage the workspace, session, list, plugin, mobile, continuity,
and visual bundles—and any other installed `dsh.aggregate` bundles—from one page.
In DeepSeek Harness Web or Desktop, open **Plugins → Add plugin** and enter `@miorin/dsh-atlas-atlas`.
Open **Plugins → Atlas Modular Improvement Plan** to toggle bundles or switch between npm and local repositories.

The manager requires DSH `0.2.2-rc.5` or newer.
DSH checks each member bundle's version requirements when it installs.
When you turn on a bundle, the manager reuses the existing installation (including a local link
or overlay) without overwriting its source.
By default, all seven Atlas bundles install from npm; when **Enable local repository links** is turned
on with a saved workspace directory, turning on any uninstalled bundle installs directly
from your local workspace (synthesizing a profile-private overlay when all member checkouts exist,
or linking `<workspace>/<basename>` directly otherwise) instead of falling back to npm.
Disable standalone VCS Panel and Sideby Note bundles before enabling Continuity, and disable standalone visual plugins
(or an older List Atlas that still includes Peak pricing timeline) before enabling Visual.
Turning a bundle off keeps the installed copy and its plugin settings.

For local development, turn on **Enable local repository links**
and save the absolute directory containing your sibling plugin checkouts (for example `/work/plugins`).
When enabled, a **Package source** control appears in this panel and at the bottom of manageable plugin detail pages
to switch between **npm** (latest registry release) and **Local repository** (`<workspace>/<basename>`;
when an aggregate bundle is in local mode, you can also switch individual sub-plugins between **Local repository**
and **npm**—or click **Switch all to local**—using profile-private overlays without modifying your source tree).

[Development and verification](docs/README.md)
