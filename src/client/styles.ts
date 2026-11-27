// Inward chevron icon mirrors IconChevronsUpDownOutlineMedium from @deepseek-ai/dsh-client-ui-primitives@0.2.2-rc.5.
// Danger button overrides follow .danger in @deepseek-ai/dsh-client-ui-plugin-manager@0.2.2-rc.5. See THIRD-PARTY-NOTICES.md.
export const CSS = `
.dsh-atlas-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
.dsh-atlas-manager-heading-row {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  flex-wrap: wrap;
  margin: 4px 0 6px;
}
.dsh-atlas-manager-heading {
  margin: 0;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--dsw-alias-label-primary);
}
.dsh-atlas-expand-all {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  min-width: 24px;
  min-height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  transition: color 120ms ease, background-color 120ms ease;
}
@media (hover: hover) {
  .dsh-atlas-expand-all:hover {
    color: var(--dsw-alias-label-primary);
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.dsh-atlas-expand-all:active {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-active);
}
.dsh-atlas-manager-subheading {
  margin: 18px 0 6px;
  font-size: 13px;
  line-height: 18px;
  font-weight: 600;
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
  gap: 0;
  padding: 10px 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
}
.dsh-atlas-manager-row:last-child { border-bottom: 0; }
.dsh-atlas-manager-row-main {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
}
.dsh-atlas-manager-icon {
  box-sizing: border-box;
  display: grid;
  place-items: center;
  align-self: center;
  width: 36px;
  height: 36px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 9px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 3%, transparent);
  transition: opacity 120ms ease, border-color 120ms ease, background-color 120ms ease;
}
.dsh-atlas-manager-icon > img {
  width: 24px;
  height: 24px;
  object-fit: contain;
}
.dsh-atlas-manager-icon-btn {
  padding: 0;
  cursor: pointer;
  font: inherit;
}
.dsh-atlas-manager-copy {
  min-width: 0;
  transition: opacity 120ms ease;
}
.dsh-atlas-manager-row[data-atlas-state='off'] .dsh-atlas-manager-icon,
.dsh-atlas-manager-row[data-atlas-state='off'] .dsh-atlas-manager-copy {
  opacity: 0.56;
}
.dsh-atlas-manager-label {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  overflow-wrap: anywhere;
}
@media (hover: hover) {
  .dsh-atlas-manager-icon-btn:hover {
    border-color: var(--dsw-alias-border-l1);
    background: var(--dsw-alias-interactive-bg-hover);
  }
  .dsh-atlas-manager-row[data-atlas-state='off']:hover .dsh-atlas-manager-icon,
  .dsh-atlas-manager-row[data-atlas-state='off']:hover .dsh-atlas-manager-copy {
    opacity: 1;
  }
}
.dsh-atlas-settings-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 2px 6px;
  margin-inline: -6px 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dsh-atlas-section-count {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 18px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary);
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent);
}
.dsh-atlas-chevron {
  flex-shrink: 0;
  color: var(--dsw-alias-label-secondary);
  transition: transform 140ms ease;
}
[aria-expanded='true'] > .dsh-atlas-chevron {
  transform: rotate(90deg);
}
.dsh-atlas-detail-open {
  flex-shrink: 0;
  box-sizing: border-box;
  width: 24px;
  height: 24px;
  min-width: 24px;
  min-height: 24px;
  display: inline-grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  opacity: 0.55;
  cursor: pointer;
  transition: opacity 120ms ease, color 120ms ease, background-color 120ms ease;
}
@media (hover: hover) {
  .dsh-atlas-settings-toggle:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }
  .dsh-atlas-manager-row:hover .dsh-atlas-detail-open {
    opacity: 0.9;
  }
  .dsh-atlas-detail-open:hover {
    opacity: 1;
    color: var(--dsw-alias-state-business-primary);
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.dsh-atlas-detail-open:focus-visible {
  opacity: 1;
}
.dsh-atlas-settings-body {
  margin: 6px 0 4px 17px;
  padding: 2px 0 2px 18px;
  border-left: 1.5px solid var(--dsw-alias-border-l2);
  min-width: 0;
}
@media (max-width: 520px) {
  .dsh-atlas-settings-body {
    margin-left: 8px;
    padding-left: 12px;
  }
}
.dsh-atlas-manager-status {
  font-size: 12px;
  line-height: 17px;
  color: var(--dsw-alias-label-tertiary);
  overflow-wrap: anywhere;
  margin: 3px 0 0;
}
.dsh-atlas-manager-status[data-error] { color: var(--dsw-alias-state-error-primary); }
.dsh-atlas-manager-detail { margin-top: 4px; }
.dsh-atlas-manager-detail > summary { cursor: pointer; }
.dsh-atlas-manager-detail > code { white-space: pre-wrap; }
.dsh-atlas-manager-retry {
  margin-top: 8px;
}
.dsh-atlas-manager-control {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
/* Danger outline follows .danger in @deepseek-ai/dsh-client-ui-plugin-manager@0.2.2-rc.5,
   src/client/PluginManagerPage.module.css. See THIRD-PARTY-NOTICES.md. */
.dsh-atlas-manager-danger,
.dsh-atlas-manager-trash {
  color: var(--dsw-alias-state-error-primary);
  --dsh-button-outline-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent);
}
@media (hover: hover) {
  .dsh-atlas-manager-danger:hover:not(:disabled),
  .dsh-atlas-manager-trash:hover:not(:disabled) {
    background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
  }
}
.dsh-atlas-manager-trash {
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  min-width: 28px;
  min-height: 28px;
  display: inline-grid;
  place-items: center;
  padding: 0;
}
.dsh-atlas-settings-toggle:focus-visible, .dsh-atlas-detail-open:focus-visible, .dsh-atlas-expand-all:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .dsh-atlas-expand-all,
  .dsh-atlas-manager-icon,
  .dsh-atlas-manager-copy,
  .dsh-atlas-detail-open { transition: none; }
  .dsh-atlas-chevron { transition: none; }
}
`
