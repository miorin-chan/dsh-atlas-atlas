// Switch and thumb adapted from @deepseek-ai/dsh-client-ui-primitives@0.2.2-rc.5,
// src/Switch.tsx and src/Switch.module.css. See THIRD-PARTY-NOTICES.md.
export const CSS = `
.dsh-atlas-manager-heading {
  margin: 0 0 4px;
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.dsh-atlas-manager-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
}
.dsh-atlas-manager-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsh-atlas-manager-row:last-child { border-bottom: 0; }
.dsh-atlas-manager-copy { min-width: 0; }
.dsh-atlas-manager-label { font-size: 14px; line-height: 20px; font-weight: 500; }
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
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
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
  flex: 0 0 auto;
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
.dsh-atlas-manager-switch:focus-visible, .dsh-atlas-manager-retry:focus-visible {
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
@media (prefers-reduced-motion: reduce) {
  .dsh-atlas-manager-thumb { transition: none; }
  .dsh-atlas-manager-spinner { animation: none; }
}
`
