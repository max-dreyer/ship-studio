/**
 * SEO metadata editor panel — title, description, OG tags with live previews.
 */

import { getEditableMetaFields, applyMetaEdit } from '../core/meta-editor';
import { showToast } from './toast';
import { h } from '../utils/dom';
import { injectStyles } from './styles';

let currentPanel: HTMLElement | null = null;
let currentBackdrop: HTMLElement | null = null;

const SECTIONS: Record<string, string> = {
  title: 'Basic',
  description: 'Basic',
  keywords: 'Basic',
  robots: 'Basic',
  canonical: 'Basic',
  'og:title': 'Open Graph',
  'og:description': 'Open Graph',
  'og:image': 'Open Graph',
  'og:url': 'Open Graph',
  'og:type': 'Open Graph',
  'twitter:card': 'Twitter',
  'twitter:title': 'Twitter',
  'twitter:description': 'Twitter',
  'twitter:image': 'Twitter',
};

export function showMetaPanel(shadow: ShadowRoot) {
  closeMetaPanel();
  injectStyles(shadow);

  const fields = getEditableMetaFields();

  // Backdrop
  const backdrop = h('div', { className: 'ss-modal-backdrop' });
  backdrop.setAttribute('data-ss-editor', 'true');
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeMetaPanel();
  });

  const panel = h('div', { className: 'ss-meta-panel' });
  panel.setAttribute('data-ss-editor', 'true');
  panel.addEventListener('click', (e) => e.stopPropagation());

  const titleEl = h('h3', {}, 'Edit Page Meta');
  const closeBtn = h('button', { className: 'ss-panel-close' }, '×');
  closeBtn.addEventListener('click', closeMetaPanel);

  panel.append(titleEl, closeBtn);

  // Two-column layout
  const layout = h('div', { className: 'ss-meta-layout' });
  const fieldsCol = h('div', { className: 'ss-meta-fields' });
  const previewCol = h('div', { className: 'ss-meta-preview' });

  // Build field inputs grouped by section
  const inputs: Array<{ field: typeof fields[0]; input: HTMLInputElement }> = [];
  let lastSection = '';

  for (const field of fields) {
    const section = SECTIONS[field.field] || '';
    if (section !== lastSection) {
      const sectionLabel = h('div', { className: 'ss-meta-section-label' }, section);
      fieldsCol.appendChild(sectionLabel);
      lastSection = section;
    }

    const label = h('label', { className: 'ss-input-label' }, field.label);
    const input = h('input', { className: 'ss-input', type: 'text' }) as HTMLInputElement;
    input.value = field.getValue();
    input.addEventListener('input', updatePreviews);

    inputs.push({ field, input });
    fieldsCol.append(label, input);
  }

  // Google preview
  const googleLabel = h('div', { className: 'ss-google-preview-label' }, 'Google Preview');
  const googlePreview = h('div', { className: 'ss-google-preview' });
  const googleUrl = h('div', { className: 'ss-google-url' });
  const googleTitle = h('div', { className: 'ss-google-title' });
  const googleDesc = h('div', { className: 'ss-google-desc' });
  googlePreview.append(googleUrl, googleTitle, googleDesc);

  // Social preview (OG)
  const socialLabel = h('div', { className: 'ss-social-preview-label' }, 'Social Preview');
  const socialPreview = h('div', { className: 'ss-social-preview' });
  const socialImage = h('div', { className: 'ss-social-image' });
  const socialBody = h('div', { className: 'ss-social-body' });
  const socialDomain = h('div', { className: 'ss-social-domain' });
  const socialTitle = h('div', { className: 'ss-social-title' });
  const socialDesc = h('div', { className: 'ss-social-desc' });
  socialBody.append(socialDomain, socialTitle, socialDesc);
  socialPreview.append(socialImage, socialBody);

  previewCol.append(googleLabel, googlePreview, socialLabel, socialPreview);

  function getInputValue(fieldName: string): string {
    const entry = inputs.find((i) => i.field.field === fieldName);
    return entry ? entry.input.value : '';
  }

  function updatePreviews() {
    const pageTitle = getInputValue('title');
    const metaDesc = getInputValue('description');
    const ogTitle = getInputValue('og:title');
    const ogDesc = getInputValue('og:description');
    const ogImage = getInputValue('og:image');
    const ogUrl = getInputValue('og:url');
    const canonical = getInputValue('canonical');

    // Google preview
    const displayUrl = canonical || ogUrl || window.location.href;
    googleUrl.textContent = displayUrl;
    googleTitle.textContent = pageTitle || 'Untitled Page';
    googleDesc.textContent = metaDesc || 'No description provided.';

    // Social preview
    const domain = (() => {
      try { return new URL(displayUrl).hostname; } catch { return window.location.hostname; }
    })();
    socialDomain.textContent = domain;
    socialTitle.textContent = ogTitle || pageTitle || 'Untitled Page';
    socialDesc.textContent = ogDesc || metaDesc || '';

    socialImage.innerHTML = '';
    if (ogImage) {
      const img = document.createElement('img');
      img.src = ogImage;
      img.alt = '';
      img.onerror = () => {
        socialImage.innerHTML = '';
        socialImage.textContent = 'Image failed to load';
      };
      socialImage.appendChild(img);
    } else {
      socialImage.textContent = 'No OG image set';
    }
  }

  updatePreviews();

  // Save button
  const saveBtn = h('button', { className: 'ss-btn ss-btn-primary' }, 'Capture Changes');
  saveBtn.style.width = '100%';
  saveBtn.style.marginTop = '12px';

  saveBtn.addEventListener('click', () => {
    let changeCount = 0;
    for (const { field, input } of inputs) {
      const newVal = input.value;
      if (newVal !== field.getValue()) {
        applyMetaEdit(field, newVal, shadow);
        changeCount++;
      }
    }

    if (changeCount > 0) {
      showToast(shadow, `${changeCount} meta change${changeCount > 1 ? 's' : ''} captured`, 'success');
    }
    closeMetaPanel();
  });

  fieldsCol.appendChild(saveBtn);
  layout.append(fieldsCol, previewCol);
  panel.appendChild(layout);
  backdrop.appendChild(panel);
  shadow.appendChild(backdrop);

  currentPanel = panel;
  currentBackdrop = backdrop;
}

export function closeMetaPanel() {
  currentBackdrop?.remove();
  currentBackdrop = null;
  currentPanel = null;
}
