/**
 * Ship Studio Inline Editor — Entry Point
 *
 * This script is loaded on client websites via a <script> tag.
 * It stays dormant unless ?editor=true is in the URL.
 */

(function () {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('editor')) return;

  // Lazy-load the full editor
  import('./boot').then((m) => m.boot()).catch(console.error);
})();
