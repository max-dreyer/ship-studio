/**
 * Toast notifications for the inline editor.
 */

import { injectStyles } from './styles';

export function showToast(
  shadow: ShadowRoot,
  message: string,
  type: 'success' | 'error' | 'info'
) {
  injectStyles(shadow);

  const toast = document.createElement('div');
  toast.className = `ss-toast ss-toast-${type}`;
  toast.textContent = message;
  shadow.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
