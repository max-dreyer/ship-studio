/**
 * Diff builder — captures changes to text, styles, images, and metadata.
 */

import type { EditSubmission, EditType, StyleChange, ImageChange, MetaChange } from '@shipstudio/shared';
import { buildFingerprint } from './selector';

/** Build a text change diff */
export function buildTextDiff(
  el: Element,
  originalText: string,
  newText: string
): EditSubmission {
  let editType: EditType = 'text_change';
  if (!originalText.trim()) editType = 'text_add';
  if (!newText.trim()) editType = 'text_delete';

  return {
    page_url: window.location.pathname,
    page_title: document.title,
    element_tag_name: el.tagName.toLowerCase(),
    element_css_selector: null,
    element_fingerprint: buildFingerprint(el),
    edit_type: editType,
    original_text: originalText,
    new_text: newText,
    original_html: el.innerHTML,
    new_html: undefined,
    submitter_user_agent: navigator.userAgent,
    submitter_viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
  };
}

/** Build a style change diff */
export function buildStyleDiff(
  el: Element,
  changes: StyleChange[]
): EditSubmission {
  return {
    page_url: window.location.pathname,
    page_title: document.title,
    element_tag_name: el.tagName.toLowerCase(),
    element_css_selector: null,
    element_fingerprint: buildFingerprint(el),
    edit_type: 'style_change',
    style_changes: changes,
    submitter_user_agent: navigator.userAgent,
    submitter_viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
  };
}

/** Build an image change diff */
export function buildImageDiff(
  el: HTMLImageElement,
  change: ImageChange
): EditSubmission {
  return {
    page_url: window.location.pathname,
    page_title: document.title,
    element_tag_name: 'img',
    element_css_selector: null,
    element_fingerprint: buildFingerprint(el),
    edit_type: 'image_change',
    image_changes: change,
    submitter_user_agent: navigator.userAgent,
    submitter_viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
  };
}

/** Build a meta change diff */
export function buildMetaDiff(change: MetaChange): EditSubmission {
  return {
    page_url: window.location.pathname,
    page_title: document.title,
    element_tag_name: 'meta',
    element_css_selector: null,
    element_fingerprint: {
      cssSelector: 'head',
      tagName: 'meta',
      textContent: '',
      parentText: '',
      previousSiblingText: '',
      nextSiblingText: '',
      nearestIdAncestor: null,
      classList: [],
      dataAttributes: {},
      ariaLabel: null,
      src: null,
    },
    edit_type: 'meta_change',
    meta_changes: change,
    submitter_user_agent: navigator.userAgent,
    submitter_viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
  };
}
