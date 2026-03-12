/**
 * All CSS for the inline editor UI — injected into the Shadow DOM.
 */

let injected = false;

const CSS = `
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  .ss-toolbar {
    position: fixed;
    bottom: 20px;
    right: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: #1e1e1e;
    border: 1px solid #333;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    color: #fff;
    font-size: 13px;
    z-index: 2147483647;
  }

  .ss-toolbar-logo {
    width: 20px;
    height: 20px;
    background: #3b82f6;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 11px;
    color: #fff;
    flex-shrink: 0;
  }

  .ss-toolbar-count {
    background: #3b82f6;
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 10px;
    min-width: 20px;
    text-align: center;
  }

  .ss-btn {
    padding: 6px 14px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    transition: background 0.15s;
  }

  .ss-btn-primary {
    background: #3b82f6;
    color: #fff;
  }
  .ss-btn-primary:hover {
    background: #2563eb;
  }
  .ss-btn-primary:disabled {
    background: #333;
    color: #666;
    cursor: not-allowed;
  }

  .ss-btn-secondary {
    background: #333;
    color: #ccc;
  }
  .ss-btn-secondary:hover {
    background: #444;
  }

  .ss-btn-ghost {
    background: transparent;
    color: #999;
  }
  .ss-btn-ghost:hover {
    background: #333;
    color: #fff;
  }

  .ss-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2147483647;
  }

  .ss-modal {
    background: #1e1e1e;
    border: 1px solid #333;
    border-radius: 16px;
    padding: 24px;
    min-width: 340px;
    max-width: 420px;
    box-shadow: 0 16px 64px rgba(0, 0, 0, 0.5);
    color: #fff;
  }

  .ss-modal h2 {
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 4px;
  }

  .ss-modal p {
    font-size: 13px;
    color: #999;
    margin-bottom: 16px;
  }

  .ss-input {
    width: 100%;
    padding: 10px 12px;
    background: #111;
    border: 1px solid #333;
    border-radius: 8px;
    color: #fff;
    font-size: 13px;
    outline: none;
    margin-bottom: 12px;
  }
  .ss-input:focus {
    border-color: #3b82f6;
  }

  .ss-input-label {
    display: block;
    font-size: 12px;
    color: #999;
    margin-bottom: 4px;
  }

  .ss-error {
    color: #ef4444;
    font-size: 12px;
    margin-bottom: 8px;
  }

  .ss-panel {
    position: fixed;
    top: 50%;
    right: 20px;
    transform: translateY(-50%);
    background: #1e1e1e;
    border: 1px solid #333;
    border-radius: 12px;
    padding: 16px;
    width: 280px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    color: #fff;
    z-index: 2147483647;
  }

  .ss-panel h3 {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 12px;
  }

  .ss-panel-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .ss-panel-close {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 24px;
    height: 24px;
    background: transparent;
    border: none;
    color: #666;
    cursor: pointer;
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
  }
  .ss-panel-close:hover {
    background: #333;
    color: #fff;
  }

  .ss-toast {
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 10px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    z-index: 2147483647;
    animation: ss-slide-in 0.3s ease;
  }

  .ss-toast-success {
    background: #065f46;
    color: #6ee7b7;
    border: 1px solid #047857;
  }

  .ss-toast-error {
    background: #7f1d1d;
    color: #fca5a5;
    border: 1px solid #991b1b;
  }

  .ss-toast-info {
    background: #1e3a5f;
    color: #93c5fd;
    border: 1px solid #1e40af;
  }

  @keyframes ss-slide-in {
    from {
      opacity: 0;
      transform: translateX(20px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  .ss-history-item {
    padding: 8px;
    border: 1px solid #333;
    border-radius: 8px;
    margin-bottom: 8px;
    font-size: 12px;
  }

  .ss-history-item .ss-status {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .ss-status-pending { background: #854d0e; color: #fde047; }
  .ss-status-approved { background: #065f46; color: #6ee7b7; }
  .ss-status-rejected { background: #7f1d1d; color: #fca5a5; }
  .ss-status-applied { background: #1e3a5f; color: #93c5fd; }

  .ss-edit-toggle {
    position: fixed;
    bottom: 20px;
    right: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    background: #1e1e1e;
    border: 1px solid #333;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    color: #fff;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    z-index: 2147483647;
    transition: background 0.15s, border-color 0.15s;
  }
  .ss-edit-toggle:hover {
    background: #2a2a2a;
    border-color: #3b82f6;
  }

  .ss-edit-toggle-icon {
    width: 20px;
    height: 20px;
    background: #3b82f6;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    color: #fff;
    flex-shrink: 0;
  }

  .ss-meta-panel {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #1e1e1e;
    border: 1px solid #333;
    border-radius: 16px;
    padding: 28px;
    width: 92vw;
    max-width: 960px;
    max-height: 85vh;
    overflow-y: auto;
    box-shadow: 0 16px 64px rgba(0, 0, 0, 0.5);
    color: #fff;
    z-index: 2147483647;
  }

  .ss-meta-panel h3 {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 16px;
  }

  .ss-meta-layout {
    display: flex;
    gap: 32px;
  }

  .ss-meta-fields {
    flex: 1 1 55%;
    min-width: 0;
  }

  .ss-meta-preview {
    flex: 1 1 45%;
    min-width: 0;
    position: sticky;
    top: 0;
    align-self: flex-start;
  }

  .ss-meta-section-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #666;
    margin-top: 12px;
    margin-bottom: 6px;
  }
  .ss-meta-section-label:first-child {
    margin-top: 0;
  }

  .ss-google-preview {
    background: #fff;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
  }

  .ss-google-preview-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #666;
    margin-bottom: 8px;
  }

  .ss-google-url {
    font-size: 12px;
    color: #202124;
    font-family: Arial, sans-serif;
    line-height: 1.3;
    margin-bottom: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ss-google-title {
    font-size: 18px;
    color: #1a0dab;
    font-family: Arial, sans-serif;
    line-height: 1.3;
    margin-bottom: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .ss-google-title:hover {
    text-decoration: underline;
  }

  .ss-google-desc {
    font-size: 13px;
    color: #4d5156;
    font-family: Arial, sans-serif;
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .ss-social-preview {
    background: #292929;
    border-radius: 8px;
    overflow: hidden;
  }

  .ss-social-preview-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #666;
    margin-bottom: 8px;
  }

  .ss-social-image {
    width: 100%;
    height: 160px;
    background: #333;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #666;
    font-size: 12px;
  }

  .ss-social-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .ss-social-body {
    padding: 10px 12px;
  }

  .ss-social-domain {
    font-size: 11px;
    color: #999;
    text-transform: uppercase;
    margin-bottom: 2px;
  }

  .ss-social-title {
    font-size: 14px;
    color: #fff;
    font-weight: 600;
    line-height: 1.3;
    margin-bottom: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ss-social-desc {
    font-size: 12px;
    color: #999;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* Auto-apply progress */
  .ss-apply-progress {
    position: fixed;
    bottom: 68px;
    right: 20px;
    background: #1e1e1e;
    border: 1px solid #333;
    border-radius: 12px;
    padding: 14px 16px;
    min-width: 260px;
    max-width: 320px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    color: #fff;
    font-size: 13px;
    z-index: 2147483646;
    animation: ss-slide-in 0.3s ease;
  }

  .ss-apply-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 2px;
  }

  .ss-apply-title {
    font-weight: 500;
    font-size: 13px;
  }

  .ss-apply-steps {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 10px;
  }

  .ss-apply-steps:empty {
    display: none;
  }

  .ss-apply-step {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #999;
  }

  .ss-step-icon {
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    flex-shrink: 0;
    border-radius: 50%;
  }

  .ss-step-done {
    background: #065f46;
    color: #6ee7b7;
  }

  .ss-step-error {
    background: #7f1d1d;
    color: #fca5a5;
  }

  .ss-step-info {
    background: #1e3a5f;
    color: #93c5fd;
  }

  .ss-step-running {
    background: transparent;
  }

  .ss-step-label {
    line-height: 1.3;
  }

  .ss-apply-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid #333;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: ss-spin 0.8s linear infinite;
    flex-shrink: 0;
  }

  .ss-apply-dot {
    display: block;
    width: 6px;
    height: 6px;
    background: #3b82f6;
    border-radius: 50%;
    animation: ss-pulse 1s ease-in-out infinite;
  }

  @keyframes ss-spin {
    to { transform: rotate(360deg); }
  }

  @keyframes ss-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  @media (max-width: 640px) {
    .ss-meta-layout {
      flex-direction: column;
    }
    .ss-meta-preview {
      flex: none;
    }
  }
`;

export function injectStyles(shadow: ShadowRoot) {
  if (injected) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  shadow.appendChild(style);
  injected = true;
}
