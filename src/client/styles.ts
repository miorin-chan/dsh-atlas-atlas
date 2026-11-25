// Switch and thumb adapted from @deepseek-ai/dsh-client-ui-primitives@0.2.2-rc.5,
// src/Switch.tsx and src/Switch.module.css. See THIRD-PARTY-NOTICES.md.
export const CSS = `
.dsh-atlas-manager-repositories {
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsh-atlas-manager-repository-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
}
.dsh-atlas-manager-path { margin-top: 8px; font-size: 13px; }
.dsh-atlas-manager-path-controls { display: flex; gap: 8px; flex-wrap: wrap; margin: 4px 0; }
.dsh-atlas-manager-path-controls > input {
  flex: 1 1 12rem;
  min-width: 0;
  min-height: 32px;
  padding: 4px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  font: inherit;
}
.dsh-atlas-manager-path-controls > button { margin-top: 0; }
.dsh-atlas-manager-path-controls > button:disabled { cursor: default; opacity: 0.55; }
.dsh-atlas-manager-heading {
  margin: 0 0 4px;
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.dsh-atlas-manager-subheading {
  margin: 14px 0 4px;
  font-size: 13px;
  line-height: 18px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}
.dsh-atlas-manager-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
}
.dsh-atlas-manager-row {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsh-atlas-manager-row:last-child { border-bottom: 0; }
.dsh-atlas-manager-icon {
  box-sizing: border-box;
  display: grid;
  place-items: center;
  align-self: start;
  width: 40px;
  height: 40px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
}
.dsh-atlas-manager-icon > img { object-fit: contain; }
.dsh-atlas-manager-icon-btn {
  padding: 0;
  background: transparent;
  cursor: pointer;
  font: inherit;
}
.dsh-atlas-manager-copy { min-width: 0; }
.dsh-atlas-manager-label {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.dsh-atlas-manager-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dsh-atlas-manager-link-arrow {
  flex-shrink: 0;
  color: var(--dsw-alias-label-secondary);
  transition: transform 140ms ease, color 140ms ease;
}
@media (hover: hover) {
  .dsh-atlas-manager-icon-btn:hover {
    border-color: var(--dsw-alias-border-l2);
    background: var(--dsw-alias-interactive-bg-hover);
  }
  .dsh-atlas-manager-link:hover {
    color: var(--dsw-alias-brand-primary);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .dsh-atlas-manager-link:hover .dsh-atlas-manager-link-arrow {
    color: currentColor;
    transform: translateX(1.5px);
  }
}
.dsh-atlas-manager-tags {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}
.dsh-atlas-local-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 16px;
  font-weight: 500;
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
}
.dsh-atlas-local-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
.dsh-atlas-local-btn {
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  padding: 3px 8px;
  background: var(--dsw-alias-bg-layer-1);
  cursor: pointer;
}
.dsh-atlas-local-btn:disabled { cursor: default; opacity: 0.55; }
@media (hover: hover) {
  .dsh-atlas-local-btn:enabled:hover { background: var(--dsw-alias-interactive-bg-hover); }
}
.dsh-atlas-section {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.dsh-atlas-section + .dsh-atlas-section {
  margin-top: 14px;
}
.dsh-atlas-settings-section {
  padding-top: 14px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.dsh-atlas-section-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 4px 6px;
  margin-inline: -6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dsh-atlas-section-count {
  font-size: 12px;
  line-height: 18px;
  font-weight: 400;
  color: var(--dsw-alias-label-secondary);
}
.dsh-atlas-chevron {
  flex-shrink: 0;
  color: var(--dsw-alias-label-secondary);
  transition: transform 140ms ease;
}
[aria-expanded='true'] > .dsh-atlas-chevron {
  transform: rotate(90deg);
}
.dsh-atlas-settings-groups {
  display: grid;
  gap: 18px;
  min-width: 0;
  padding-top: 4px;
}
.dsh-atlas-settings-group {
  display: grid;
  gap: 12px;
  min-width: 0;
}
.dsh-atlas-settings-group + .dsh-atlas-settings-group {
  padding-top: 16px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.dsh-atlas-settings-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
.dsh-atlas-settings-group-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1 1 auto;
  padding: 3px 6px;
  margin-inline: -6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
}
.dsh-atlas-settings-group-open {
  flex-shrink: 0;
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
@media (hover: hover) {
  .dsh-atlas-section-toggle:hover,
  .dsh-atlas-settings-group-toggle:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }
  .dsh-atlas-settings-group-open:hover {
    color: var(--dsw-alias-brand-primary);
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.dsh-atlas-settings-group-icon {
  width: 28px;
  height: 28px;
  border-radius: var(--dsw-radius-sm);
}
.dsh-atlas-settings-group-body {
  margin-left: 14px;
  padding-left: 20px;
  border-left: 1px solid var(--dsw-alias-border-l2);
  min-width: 0;
}
@media (max-width: 520px) {
  .dsh-atlas-settings-group-body {
    margin-left: 8px;
    padding-left: 12px;
  }
}
.dsh-atlas-manager-status {
  font-size: 13px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
  margin: 2px 0 0;
}
.dsh-atlas-manager-status[data-error] { color: var(--dsw-alias-state-error-primary); }
.dsh-atlas-manager-detail { margin-top: 4px; }
.dsh-atlas-manager-detail > summary { cursor: pointer; }
.dsh-atlas-manager-detail > code { white-space: pre-wrap; }
.dsh-atlas-manager-retry {
  font: inherit;
  color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  padding: 4px 10px;
  margin-top: 8px;
  background: var(--dsw-alias-bg-layer-1);
  cursor: pointer;
}
.dsh-atlas-manager-control {
  display: grid;
  grid-template-columns: 14px 28px 36px;
  align-items: center;
  gap: 8px;
}
.dsh-atlas-manager-control > .dsh-atlas-manager-switch { grid-column: 3; }
/* Danger outline follows .danger in @deepseek-ai/dsh-client-ui-plugin-manager@0.2.2-rc.5,
   src/client/PluginManagerPage.module.css. See THIRD-PARTY-NOTICES.md. */
.dsh-atlas-manager-danger,
.dsh-atlas-manager-trash {
  color: var(--dsw-alias-state-error-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent);
}
.dsh-atlas-manager-danger:hover:not(:disabled), .dsh-atlas-manager-trash:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
}
.dsh-atlas-manager-trash {
  grid-column: 2;
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  padding: 0;
  border-width: 1px;
  border-style: solid;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  cursor: pointer;
}
.dsh-atlas-manager-trash:disabled { cursor: default; opacity: 0.55; }
.dsh-atlas-manager-uninstall-dialog {
  max-inline-size: min(25rem, calc(100% - 2rem));
  box-sizing: border-box;
  padding: 20px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
}
.dsh-atlas-manager-uninstall-dialog::backdrop {
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 30%, transparent);
}
.dsh-atlas-manager-uninstall-dialog h4, .dsh-atlas-manager-uninstall-dialog p { margin: 0 0 8px; }
.dsh-atlas-manager-uninstall-dialog > div { display: flex; justify-content: flex-end; gap: 8px; }
.dsh-atlas-manager-spinner {
  box-sizing: border-box;
  width: 14px;
  height: 14px;
  border: 2px solid var(--dsw-alias-border-l2);
  border-top-color: var(--dsw-alias-brand-primary);
  border-radius: 50%;
  animation: dsh-atlas-manager-spin 700ms linear infinite;
}
@keyframes dsh-atlas-manager-spin { to { transform: rotate(1turn); } }
.dsh-atlas-manager-switch {
  box-sizing: border-box;
  grid-column: 2;
  width: 36px;
  height: 20px;
  padding: 2px;
  border: 0;
  border-radius: 999px;
  corner-shape: round;
  background: var(--dsw-alias-border-l3);
  cursor: pointer;
}
.dsh-atlas-manager-switch[aria-checked='true'] { background: var(--dsw-alias-brand-primary); }
.dsh-atlas-manager-switch[aria-checked='false'] {
  box-shadow: inset 0 0 0 1px var(--dsw-alias-label-secondary);
}
.dsh-atlas-manager-switch[aria-disabled='true'] { cursor: default; opacity: 0.55; }
.dsh-atlas-manager-switch:focus-visible, .dsh-atlas-manager-retry:focus-visible,
.dsh-atlas-manager-trash:focus-visible, .dsh-atlas-manager-path-controls > input:focus-visible,
.dsh-atlas-local-btn:focus-visible, .dsh-atlas-manager-link:focus-visible,
.dsh-atlas-section-toggle:focus-visible, .dsh-atlas-settings-group-toggle:focus-visible,
.dsh-atlas-settings-group-open:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
  outline-offset: 2px;
}
.dsh-atlas-manager-thumb {
  display: block;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  corner-shape: round;
  background: var(--dsw-alias-switch-thumb);
  transition: transform 120ms ease;
}
.dsh-atlas-manager-switch[aria-checked='true'] .dsh-atlas-manager-thumb {
  background: var(--dsw-alias-label-primary-foreground);
  transform: translateX(16px);
}
.dsh-atlas-local-detail {
  display: grid;
  gap: 10px;
  padding-top: 12px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  font-size: 13px;
  line-height: 18px;
}
.dsh-atlas-local-detail > h4 {
  margin: 0;
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.dsh-atlas-local-feature {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
}
.dsh-atlas-local-feature-info {
  min-width: 0;
  display: grid;
  gap: 2px;
}
.dsh-atlas-local-feature-title {
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.dsh-atlas-local-feature-meta {
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}
.dsh-atlas-local-members-list {
  margin: 6px 0 0;
  padding-left: 16px;
  display: grid;
  gap: 4px;
  color: var(--dsw-alias-label-secondary);
}
@media (prefers-reduced-motion: reduce) {
  .dsh-atlas-manager-thumb { transition: none; }
  .dsh-atlas-manager-spinner { animation: none; }
  .dsh-atlas-manager-link-arrow { transition: none; }
  .dsh-atlas-chevron { transition: none; }
}
`
