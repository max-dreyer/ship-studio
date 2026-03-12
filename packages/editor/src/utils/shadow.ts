/**
 * Shadow DOM container for the inline editor UI.
 * Keeps editor styles isolated from the host page.
 */

export function createShadowContainer(): ShadowRoot {
  const host = document.createElement('div');
  host.id = 'ship-studio-editor';
  host.setAttribute('data-ss-editor', 'true');
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
  document.body.appendChild(host);

  return host.attachShadow({ mode: 'open' });
}
