/**
 * CSS property editor panel — lets clients edit common style properties.
 */

import type { StyleChange } from '@shipstudio/shared';
import { buildStyleDiff } from '../core/differ';
import { EditorState } from '../core/state';
import { updateToolbar } from './toolbar';
import { showToast } from './toast';
import { h } from '../utils/dom';
import { injectStyles } from './styles';

const EDITABLE_PROPERTIES = [
  { property: 'color', label: 'Text Color', type: 'color', category: 'typography' },
  { property: 'font-size', label: 'Font Size', type: 'text', category: 'typography' },
  { property: 'font-weight', label: 'Font Weight', type: 'text', category: 'typography' },
  { property: 'background-color', label: 'Background', type: 'color', category: 'layout' },
  { property: 'padding', label: 'Padding', type: 'text', category: 'layout' },
  { property: 'margin', label: 'Margin', type: 'text', category: 'layout' },
  { property: 'border-radius', label: 'Border Radius', type: 'text', category: 'layout' },
];

let currentPanel: HTMLElement | null = null;

export function showStylePanel(shadow: ShadowRoot, el: HTMLElement) {
  closeStylePanel();
  injectStyles(shadow);

  const computed = window.getComputedStyle(el);
  const originalValues: Record<string, string> = {};

  const panel = h('div', { className: 'ss-panel' });
  panel.setAttribute('data-ss-editor', 'true');

  const titleEl = h('h3', {}, 'Edit Styles');
  const closeBtn = h('button', { className: 'ss-panel-close' }, '×');
  closeBtn.addEventListener('click', closeStylePanel);

  panel.append(titleEl, closeBtn);

  for (const prop of EDITABLE_PROPERTIES) {
    originalValues[prop.property] = computed.getPropertyValue(prop.property);

    const row = h('div', { className: 'ss-panel-row' });
    const label = h('label', { className: 'ss-input-label' }, prop.label);
    label.style.width = '90px';
    label.style.flexShrink = '0';

    const input = h('input', {
      className: 'ss-input',
      type: prop.type,
    }) as HTMLInputElement;
    input.style.marginBottom = '0';
    input.value = computed.getPropertyValue(prop.property);

    input.addEventListener('input', () => {
      el.style.setProperty(prop.property, input.value);
    });

    row.append(label, input);
    panel.appendChild(row);
  }

  // Apply button
  const applyBtn = h('button', { className: 'ss-btn ss-btn-primary' }, 'Capture Changes');
  applyBtn.style.width = '100%';
  applyBtn.style.marginTop = '8px';

  applyBtn.addEventListener('click', () => {
    const changes: StyleChange[] = [];

    for (const prop of EDITABLE_PROPERTIES) {
      const currentVal = el.style.getPropertyValue(prop.property) ||
        window.getComputedStyle(el).getPropertyValue(prop.property);
      const originalVal = originalValues[prop.property];

      if (currentVal !== originalVal) {
        changes.push({
          property: prop.property,
          originalValue: originalVal,
          newValue: currentVal,
          category: prop.category,
        });
      }
    }

    if (changes.length > 0) {
      const diff = buildStyleDiff(el, changes);
      EditorState.addEdit(diff);
      updateToolbar(shadow);
      showToast(shadow, `${changes.length} style change${changes.length > 1 ? 's' : ''} captured`, 'success');
    }

    closeStylePanel();
  });

  panel.appendChild(applyBtn);
  shadow.appendChild(panel);
  currentPanel = panel;
}

export function closeStylePanel() {
  currentPanel?.remove();
  currentPanel = null;
}
