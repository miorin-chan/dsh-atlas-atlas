# AGENTS.local

Project rules for this DSH plugin bundle.
This file supplements [AGENTS.md](AGENTS.md); read that file first.
Adjust or extend this file for the project.
Where the two conflict, this file wins.

## Scope

This bundle provides the lightweight user-facing Atlas manager card.
Local repository linking, overlay synthesis, and detail-page source switching live
in the separate developer plugin `@miorin/dsh-atlas-dev` (`plugins/dsh-atlas-dev`)
so `@miorin/dsh-atlas-atlas` stays free of runtime dependencies.

## Project documentation

- `README.md` is for users: installation, usage, commands, and limits.
  Provide `README.zh.md` as its Chinese version.
- [docs/README.md](docs/README.md) records the package's behavior, build steps, and verification.
- [src/lib/atlas.ts](src/lib/atlas.ts) declares the official Atlas bundle names and handles npm installation,
  enablement, conflict checks, and removal.
- [src/lib/discover-aggregates.ts](src/lib/discover-aggregates.ts) provides the zero-dependency read-only scan
  for installed `dsh.aggregate` bundles.
- Keep the plugin detail page short.
  Set `meta.title` and `meta.description` in `locale/*.json` for the DSH interface language.
  Use `meta.detail` in each locale (`docs/DETAIL.<lang>.md`) to select a short, packaged Markdown document when needed.

## Language

- For the main README, prefer English and provide a Chinese version.
- Prefer Chinese for designs and documentation.
- Keep user-facing text translatable through the project's localization mechanism,
  and maintain all eight locales (`en`, `zh`, `ja`, `de`, `es`, `fr`, `pt`, `ru`) together.
- Use English for code identifiers and keep established technical terms in English when helpful
  for precision or searchability.

## Structure

`npm run build:tools` compiles `.mts` tooling in `scripts/` to adjacent ignored `.mjs` files.
Node.js 22.18 or newer runs the `.test.mts` files directly.

- Use TypeScript for plugin source unless otherwise specified.
  Use the workspace base for TypeScript plugins.
  Put Host, Client, and private module sources under `src/host/`, `src/client/`, and `src/lib/` as needed.
  The build generates `index.js`, `client.js`, and the `lib/*.js` test/runtime modules.
  Git ignores these outputs.
- Keep Plugin Manager metadata in `locale/*.json` and runtime translations in `LABELS` in the Client source.
- The client test uses a fake `ctx` to check registration, resources, and cleanup.
- `docs/scripts/reflow` is the standalone documentation formatter and requires Python 3.11 or newer.

## Reusing native DSH UI

- Prefer native DSH components, behavior, theme tokens, and layouts from comparable screens
  to reduce code and maintenance.
- Prefer runtime reuse through supported slots, component factories, or host-provided modules
  when performance is acceptable.
- When statically importing or bundling official code or assets, annotate the reference
  with the upstream package, version or commit, source path, and symbol name.
  Keep applicable licenses and attribution so future updates can be traced to the source.

## Implementation

- Keep the bundle independently installable and toggleable, with zero runtime `dependencies`.
- Implement the feature through supported DSH plugin APIs and extension points.
  Keep DSH source and installed files intact.
- Reuse the DSH type declarations for the supported runtime version.
  Preserve types across plugin interfaces, configuration, and events.
- Keep the factory free of side effects.
  Register resources in `apply` with `ctx.effect` or `ctx.on` and return cleanup functions.
- Always pass `PREK_HOME="${TMPDIR:?}/prek-dsh"` when committing inside the sandbox.

## Verification

- Follow the [development checks](docs/README.md#本地安装与开发检查).
- From the workspace root, run `node tools/new-dsh-plugin/cli.mts --check plugins/<id>`.
