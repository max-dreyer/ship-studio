/**
 * Image editor panel — change image src and alt text.
 */

import { uploadImage } from '../api/client';
import { buildImageDiff } from '../core/differ';
import { EditorState } from '../core/state';
import { updateToolbar } from './toolbar';
import { showToast } from './toast';
import { h } from '../utils/dom';
import { injectStyles } from './styles';

let currentPanel: HTMLElement | null = null;

export function showImagePanel(shadow: ShadowRoot, img: HTMLImageElement) {
  closeImagePanel();
  injectStyles(shadow);

  const originalSrc = img.src;
  const originalAlt = img.alt;

  const panel = h('div', { className: 'ss-panel' });
  panel.setAttribute('data-ss-editor', 'true');

  const titleEl = h('h3', {}, 'Edit Image');
  const closeBtn = h('button', { className: 'ss-panel-close' }, '×');
  closeBtn.addEventListener('click', closeImagePanel);

  // Current image preview
  const preview = h('img') as HTMLImageElement;
  preview.src = img.src;
  preview.style.cssText = 'width: 100%; border-radius: 8px; margin-bottom: 12px; max-height: 150px; object-fit: cover;';

  // File upload
  const uploadLabel = h('label', { className: 'ss-input-label' }, 'Replace Image');
  const fileInput = h('input', { type: 'file', className: 'ss-input' }) as HTMLInputElement;
  fileInput.accept = 'image/*';

  let newSrc = originalSrc;

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    try {
      showToast(shadow, 'Uploading image…', 'info');
      const url = await uploadImage(file);
      newSrc = url;
      preview.src = url;
      img.src = url; // Live preview on page
      showToast(shadow, 'Image uploaded', 'success');
    } catch (err) {
      showToast(shadow, 'Failed to upload image', 'error');
    }
  });

  // Alt text
  const altLabel = h('label', { className: 'ss-input-label' }, 'Alt Text');
  const altInput = h('input', { className: 'ss-input', type: 'text' }) as HTMLInputElement;
  altInput.value = originalAlt;
  altInput.addEventListener('input', () => {
    img.alt = altInput.value;
  });

  // Save button
  const saveBtn = h('button', { className: 'ss-btn ss-btn-primary' }, 'Capture Change');
  saveBtn.style.width = '100%';
  saveBtn.style.marginTop = '4px';

  saveBtn.addEventListener('click', () => {
    const newAlt = altInput.value;
    if (newSrc === originalSrc && newAlt === originalAlt) {
      closeImagePanel();
      return;
    }

    const diff = buildImageDiff(img, {
      originalSrc,
      newSrc,
      originalAlt,
      newAlt,
    });

    EditorState.addEdit(diff);
    updateToolbar(shadow);
    showToast(shadow, 'Image change captured', 'success');
    closeImagePanel();
  });

  panel.append(titleEl, closeBtn, preview, uploadLabel, fileInput, altLabel, altInput, saveBtn);
  shadow.appendChild(panel);
  currentPanel = panel;
}

export function closeImagePanel() {
  currentPanel?.remove();
  currentPanel = null;
}
