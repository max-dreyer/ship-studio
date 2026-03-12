// ---------------------------------------------------------------------------
// Element Fingerprinting
// ---------------------------------------------------------------------------

/** Multi-signal fingerprint for locating an element in source code */
export interface ElementFingerprint {
  cssSelector: string;
  tagName: string;
  textContent: string;
  parentText: string;
  previousSiblingText: string;
  nextSiblingText: string;
  nearestIdAncestor: string | null;
  classList: string[];
  dataAttributes: Record<string, string>;
  ariaLabel: string | null;
  src: string | null;
}

// ---------------------------------------------------------------------------
// Edit Types
// ---------------------------------------------------------------------------

export type EditType =
  | 'text_change'
  | 'text_delete'
  | 'text_add'
  | 'style_change'
  | 'combined_change'
  | 'image_change'
  | 'meta_change';

export type EditStatus =
  | 'pending'
  | 'approved'
  | 'applying'
  | 'applied'
  | 'rejected'
  | 'failed';

export type AppliedMethod = 'claude_desktop' | 'claude_auto' | 'manual';

// ---------------------------------------------------------------------------
// Style Changes
// ---------------------------------------------------------------------------

export interface StyleChange {
  property: string;
  originalValue: string;
  newValue: string;
  category: string;
}

// ---------------------------------------------------------------------------
// Image Changes
// ---------------------------------------------------------------------------

export interface ImageChange {
  originalSrc: string;
  newSrc: string;
  originalAlt: string;
  newAlt: string;
}

// ---------------------------------------------------------------------------
// Meta Changes
// ---------------------------------------------------------------------------

export interface MetaChange {
  field: string;
  originalValue: string;
  newValue: string;
}

// ---------------------------------------------------------------------------
// Viewport Info
// ---------------------------------------------------------------------------

export interface ViewportInfo {
  width: number;
  height: number;
  devicePixelRatio: number;
}

// ---------------------------------------------------------------------------
// Inline Edit (matches inline_edits table)
// ---------------------------------------------------------------------------

export interface InlineEdit {
  id: string;
  project_id: string;
  batch_id: string;
  submitted_by: string;

  status: EditStatus;

  page_url: string;
  page_title: string | null;

  element_tag_name: string;
  element_css_selector: string | null;
  element_fingerprint: ElementFingerprint;

  edit_type: EditType;
  original_text: string | null;
  new_text: string | null;
  original_html: string | null;
  new_html: string | null;
  style_changes: StyleChange[] | null;
  image_changes: ImageChange | null;
  meta_changes: MetaChange | null;

  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;

  applied_at: string | null;
  applied_method: AppliedMethod | null;
  pr_url: string | null;
  failure_reason: string | null;

  submitter_user_agent: string | null;
  submitter_viewport: ViewportInfo | null;

  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Inline Editor Config (matches inline_editor_config table)
// ---------------------------------------------------------------------------

export interface InlineEditorConfig {
  id: string;
  project_id: string;
  is_enabled: boolean;
  studio_id: string;
  allowed_domains: string[];
  require_auth: boolean;
  auto_apply: boolean;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Edit Submission (what the client script sends)
// ---------------------------------------------------------------------------

export interface EditSubmission {
  page_url: string;
  page_title: string | null;
  element_tag_name: string;
  element_css_selector: string | null;
  element_fingerprint: ElementFingerprint;
  edit_type: EditType;
  original_text?: string;
  new_text?: string;
  original_html?: string;
  new_html?: string;
  style_changes?: StyleChange[];
  image_changes?: ImageChange;
  meta_changes?: MetaChange;
  submitter_user_agent: string;
  submitter_viewport: ViewportInfo;
}

// ---------------------------------------------------------------------------
// API Request/Response Types
// ---------------------------------------------------------------------------

export interface EnableProjectRequest {
  repo_url: string;
  github_repo_full_name: string;
  default_branch: string;
  allowed_domains: string[];
}

export interface EnableProjectResponse {
  project_id: string;
  studio_id: string;
  config: InlineEditorConfig;
}

export interface InviteClientRequest {
  project_id: string;
  email: string;
}

export interface InviteClientResponse {
  invite_id: string;
  email: string;
}

export interface ValidateOriginRequest {
  studio_id: string;
  origin: string;
}

export interface ValidateOriginResponse {
  valid: boolean;
  project_id: string;
  config: InlineEditorConfig;
}

// ---------------------------------------------------------------------------
// Client/Project Membership
// ---------------------------------------------------------------------------

export interface ProjectClient {
  id: string;
  project_id: string;
  user_id: string;
  role: string;
  can_inline_edit: boolean;
  created_at: string;
  profile?: {
    email: string;
    full_name: string | null;
    avatar_url: string | null;
  };
}

export interface ProjectInvite {
  id: string;
  project_id: string;
  email: string;
  role: string;
  token: string;
  accepted_at: string | null;
  created_at: string;
}
