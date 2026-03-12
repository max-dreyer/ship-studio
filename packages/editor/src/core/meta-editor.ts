/**
 * Page metadata editing — title, description, OG tags.
 */

import { buildMetaDiff } from './differ';
import { EditorState } from './state';
import { updateToolbar } from '../ui/toolbar';

export interface MetaField {
  label: string;
  field: string;
  getValue: () => string;
  setValue: (val: string) => void;
}

function metaName(name: string, label: string): MetaField {
  return {
    label,
    field: name,
    getValue: () =>
      document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content || '',
    setValue: (val) => {
      let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.name = name;
        document.head.appendChild(el);
      }
      el.content = val;
    },
  };
}

function metaProp(property: string, label: string): MetaField {
  return {
    label,
    field: property,
    getValue: () =>
      document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`)?.content || '',
    setValue: (val) => {
      let el = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute('property', property);
        document.head.appendChild(el);
      }
      el.content = val;
    },
  };
}

function linkRel(rel: string, label: string): MetaField {
  return {
    label,
    field: rel,
    getValue: () =>
      document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)?.href || '',
    setValue: (val) => {
      let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
      if (!el) {
        el = document.createElement('link');
        el.rel = rel;
        document.head.appendChild(el);
      }
      el.href = val;
    },
  };
}

export function getEditableMetaFields(): MetaField[] {
  return [
    // Basic
    {
      label: 'Page Title',
      field: 'title',
      getValue: () => document.title,
      setValue: (val) => { document.title = val; },
    },
    metaName('description', 'Meta Description'),
    metaName('keywords', 'Keywords'),
    metaName('robots', 'Robots'),
    linkRel('canonical', 'Canonical URL'),

    // Open Graph
    metaProp('og:title', 'OG Title'),
    metaProp('og:description', 'OG Description'),
    metaProp('og:image', 'OG Image'),
    metaProp('og:url', 'OG URL'),
    metaProp('og:type', 'OG Type'),

    // Twitter
    metaName('twitter:card', 'Twitter Card'),
    metaName('twitter:title', 'Twitter Title'),
    metaName('twitter:description', 'Twitter Description'),
    metaName('twitter:image', 'Twitter Image'),
  ];
}

export function applyMetaEdit(
  field: MetaField,
  newValue: string,
  shadow: ShadowRoot
): void {
  const originalValue = field.getValue();
  if (originalValue === newValue) return;

  field.setValue(newValue);

  const diff = buildMetaDiff({
    field: field.field,
    originalValue,
    newValue,
  });

  EditorState.addEdit(diff);
  updateToolbar(shadow);
}
