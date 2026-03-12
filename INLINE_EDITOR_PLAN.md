# Inline Editor — Implementation Plan

## Overview

Add a client-facing inline editor to Ship Studio that allows developers to give their clients the ability to edit text, images, and page metadata directly on their live website. Edits are captured as structured diffs and sent back to the developer for review (Phase 1) or auto-applied via AI (Phase 2).

## Architecture Summary

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│   Client's Browser  │     │   Ship Studio API     │     │  Ship Studio Desktop│
│                     │     │   (SvelteKit on       │     │  (Tauri App)        │
│  inline-editor.js   │────▶│    Vercel)            │◀────│                     │
│  - Edit text/images │ POST│                       │  RT │  - "Edits" tab      │
│  - Capture diffs    │     │  - Edit storage       │     │  - Review edits     │
│  - Supabase Auth    │     │  - Invite emails      │     │  - Apply via Claude │
│  - Supabase RT      │     │  - Image uploads      │     │  - Manage clients   │
└────────┬────────────┘     └──────────────────────┘     └────────┬────────────┘
         │                           │                            │
         │                    ┌──────┴──────┐                     │
         └───────────────────▶│  Supabase   │◀────────────────────┘
           Direct connection  │  (existing) │  Direct connection
           (Auth, Realtime)   │  - Auth     │  (Auth, Realtime)
                              │  - Postgres │
                              │  - Storage  │
                              │  - Realtime │
                              └─────────────┘
```

**Note:** Both the inline editor script and the desktop app include the Supabase JS SDK and connect directly to Supabase for Auth, Realtime, Storage, and all CRUD operations (protected by RLS policies). The Ship Studio API is a slim SvelteKit service that only handles operations requiring the service role key (invites, project linking) and server-side logic (domain validation, Phase 2 AI application).

### Key Components

| Component | Tech | Hosting | Purpose |
|-----------|------|---------|---------|
| **Inline Editor Script** | TypeScript, Vite (IIFE) | Vercel Edge | 3rd-party `<script>` tag clients load on their site |
| **Ship Studio API** | SvelteKit | Vercel | Handles edit submissions, auth, project config |
| **Ship Studio Desktop** | React/Tauri (existing) | Local | Developer reviews/applies edits, manages clients |
| **Database** | PostgreSQL | Supabase (existing) | Stores edits, client permissions, project config |
| **Auth** | Supabase Auth | Supabase (existing) | Developer + client authentication |
| **Image Storage** | Supabase Storage | Supabase (existing) | Client-uploaded images for edits |

---

## Existing Schema We'll Build On

These tables already exist in Supabase and are directly relevant:

| Table | Relevance |
|-------|-----------|
| `profiles` | User profiles (linked to `auth.users`). Both developers and clients. |
| `projects` | Projects with `repo_url`, `github_token`, `default_branch`, `github_repo_full_name`. Already has what we need to link edits to repos. |
| `project_clients` | Maps users to projects with roles (`editor`). Already supports client access control. |
| `invites` | Email-based invite system with tokens. Already supports inviting clients to projects. |
| `edit_sessions` | Tracks editing sessions per project/user. Can extend or reference for inline edits. |

---

## New Database Tables

### `inline_editor_config`
Per-project configuration for the inline editor feature.

```sql
CREATE TABLE public.inline_editor_config (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL UNIQUE,
  is_enabled boolean NOT NULL DEFAULT true,
  studio_id text NOT NULL UNIQUE,           -- The ID used in the script tag (data-studio-id)
  allowed_domains jsonb DEFAULT '[]'::jsonb, -- Domains where the script is allowed to run
  editing_mode text NOT NULL DEFAULT 'full', -- 'full' | 'light' (text+images only)
  require_auth boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inline_editor_config_pkey PRIMARY KEY (id),
  CONSTRAINT inline_editor_config_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_inline_editor_config_studio_id ON public.inline_editor_config(studio_id);
```

### `inline_edits`
Stores individual edit diffs submitted by clients.

```sql
CREATE TABLE public.inline_edits (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  batch_id uuid NOT NULL,                    -- Groups edits submitted together
  submitted_by uuid NOT NULL,                -- The client who made the edit (auth.users)

  -- Status workflow
  status text NOT NULL DEFAULT 'pending',    -- pending | approved | applying | applied | rejected | failed

  -- Page context
  page_url text NOT NULL,
  page_title text,

  -- Element identification (multi-signal fingerprint for AI)
  element_tag_name text NOT NULL,
  element_css_selector text,
  element_fingerprint jsonb NOT NULL,        -- Full fingerprint object (classes, siblings, ancestors, etc.)

  -- The actual change
  edit_type text NOT NULL,                   -- text_change | text_delete | text_add | style_change | combined_change | image_change | meta_change
  original_text text,
  new_text text,
  original_html text,
  new_html text,
  style_changes jsonb,                       -- Array of {property, originalValue, newValue, category}
  image_changes jsonb,                       -- {originalSrc, newSrc (Supabase Storage URL), originalAlt, newAlt}
  meta_changes jsonb,                        -- {field, originalValue, newValue} for SEO metadata

  -- Review
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,

  -- Application result (Phase 2)
  applied_at timestamptz,
  applied_method text,                       -- 'claude_desktop' | 'claude_auto' | 'manual'
  pr_url text,
  failure_reason text,

  -- Submission metadata
  submitter_user_agent text,
  submitter_viewport jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT inline_edits_pkey PRIMARY KEY (id),
  CONSTRAINT inline_edits_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
  CONSTRAINT inline_edits_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES auth.users(id)
);

CREATE INDEX idx_inline_edits_project_status ON public.inline_edits(project_id, status);
CREATE INDEX idx_inline_edits_batch ON public.inline_edits(batch_id);
CREATE INDEX idx_inline_edits_created ON public.inline_edits(created_at DESC);
```

### No new tables needed for clients/invites
The existing `project_clients` and `invites` tables already handle:
- Adding clients to projects (`project_clients`)
- Email-based invitations (`invites`)
- Role-based access (`role` column)

We'll add one column to `project_clients`:

```sql
ALTER TABLE public.project_clients
  ADD COLUMN can_inline_edit boolean NOT NULL DEFAULT true;
```

---

## Phase 1: Manual Review in Ship Studio

### 1.1 — Data Access Architecture

Most data operations go **directly to Supabase** via the JS SDK (from both the inline editor script and the desktop app). Row Level Security (RLS) policies enforce access control at the database level.

A **slim SvelteKit API** (deployed on Vercel) handles only operations that require the Supabase service role key or complex server-side logic.

#### What Goes Direct to Supabase (via SDK + RLS)

| Operation | Who | Supabase Call |
|-----------|-----|---------------|
| Submit edits | Client (script) | `supabase.from('inline_edits').insert(edits)` |
| List edits for project | Developer (desktop) | `supabase.from('inline_edits').select().eq('project_id', x)` |
| Get edit detail | Developer (desktop) | `supabase.from('inline_edits').select().eq('id', x)` |
| Approve/reject edit | Developer (desktop) | `supabase.from('inline_edits').update({ status })` |
| Client edit history | Client (script) | `supabase.from('inline_edits').select().eq('submitted_by', userId)` |
| Get project config | Client (script) | `supabase.from('inline_editor_config').select().eq('studio_id', x)` |
| List project clients | Developer (desktop) | `supabase.from('project_clients').select().eq('project_id', x)` |
| Auth (login/logout) | Client (script) | `supabase.auth.signInWithPassword()` |
| Auth (OAuth) | Developer (desktop) | `supabase.auth.signInWithOAuth()` |
| Upload images | Client (script) | `supabase.storage.from('edit-images').upload()` |
| Realtime edits | Both | `supabase.channel().on('postgres_changes', ...).subscribe()` |

#### RLS Policies Required

```sql
-- Clients can insert edits for projects they belong to
CREATE POLICY "clients_insert_edits" ON inline_edits FOR INSERT
  WITH CHECK (
    submitted_by = auth.uid()
    AND project_id IN (
      SELECT project_id FROM project_clients WHERE user_id = auth.uid()
    )
  );

-- Clients can read their own edits
CREATE POLICY "clients_read_own_edits" ON inline_edits FOR SELECT
  USING (submitted_by = auth.uid());

-- Project owners can read all edits for their projects
CREATE POLICY "owners_read_project_edits" ON inline_edits FOR SELECT
  USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id = auth.uid()  -- assuming projects has user_id for owner
    )
  );

-- Project owners can update edit status (approve/reject)
CREATE POLICY "owners_update_edits" ON inline_edits FOR UPDATE
  USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id = auth.uid()
    )
  );

-- Anyone can read inline_editor_config (needed by script to bootstrap)
CREATE POLICY "public_read_config" ON inline_editor_config FOR SELECT
  USING (is_enabled = true);

-- Project owners can manage config
CREATE POLICY "owners_manage_config" ON inline_editor_config FOR ALL
  USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id = auth.uid()
    )
  );
```

#### Ship Studio API (Slim — Server-Only Endpoints)

**New repo: `ship-studio-api`** (SvelteKit, deployed on Vercel)

Only handles operations requiring the **service role key** or **complex server logic**:

```
ship-studio-api/
├── src/
│   ├── lib/
│   │   └── server/
│   │       ├── supabase.ts          # Supabase admin client (service role)
│   │       └── validation.ts        # Domain/origin validation helpers
│   ├── routes/
│   │   ├── api/v1/
│   │   │   ├── projects/
│   │   │   │   └── enable/+server.ts        # POST: enable inline editor (link/create project + config)
│   │   │   ├── clients/
│   │   │   │   └── invite/+server.ts        # POST: invite client (admin.inviteUserByEmail)
│   │   │   ├── edits/
│   │   │   │   └── validate-origin/+server.ts  # POST: domain validation middleware
│   │   │   └── apply/+server.ts             # (Phase 2) POST: AI-apply edit
│   │   └── health/+server.ts
│   ├── hooks.server.ts              # CORS
│   └── app.d.ts
├── svelte.config.js
├── vite.config.ts
├── package.json
└── vercel.json
```

#### API Endpoints (Server-Only)

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| `POST` | `/api/v1/projects/enable` | Developer JWT | Link/create project + generate `studio_id` + create config |
| `POST` | `/api/v1/clients/invite` | Developer JWT | Call `supabase.auth.admin.inviteUserByEmail()` + create invite row |
| `POST` | `/api/v1/edits/validate-origin` | Studio ID | Validate script origin against `allowed_domains` (called by script on boot) |
| `POST` | `/api/v1/edits/apply` | Developer JWT | *(Phase 2)* AI-apply edit via Claude API + GitHub API |

#### Edit Submission Flow

```
Client browser (inline-editor.js)
  │
  ├── 1. Script loads, reads data-studio-id from script tag
  │
  ├── 2. User navigates to ?editor=true
  │
  ├── 3. Initialize Supabase client, check session
  │      └── supabase.auth.getSession() or show login modal
  │          └── supabase.auth.signInWithPassword({ email, password })
  │
  ├── 4. Validate origin + load config
  │      ├── POST /api/v1/edits/validate-origin (server checks allowed_domains)
  │      └── supabase.from('inline_editor_config').select().eq('studio_id', x)
  │
  ├── 5. Subscribe to Realtime for edit status updates
  │      └── supabase.channel('my-edits').on('postgres_changes', ...).subscribe()
  │
  ├── 6. Editor activates (hover highlights, click to edit)
  │
  ├── 7. Client makes edits, clicks Submit
  │      └── supabase.from('inline_edits').insert(edits)  ← direct via RLS
  │
  └── 8. Developer sees edit instantly via Realtime in desktop app
```

### 1.2 — Inline Editor Script

**Location**: Monorepo — lives in `packages/editor/` within the `ship-studio` desktop app repo.

**Why monorepo**: The editor script and the desktop app share TypeScript types (edit diffs, element fingerprints, edit statuses). Keeping them in one repo means one source of truth, one branch per feature, and no cross-repo coordination. A GitHub Action builds the IIFE bundle and deploys it to the CDN separately from the Tauri build.

#### Script Architecture (adapted from Edict patterns)

```
packages/shared/
├── src/
│   ├── types.ts              # ContentDiff, ElementFingerprint, EditStatus, etc.
│   └── index.ts              # Re-exports
├── tsconfig.json
└── package.json

packages/editor/
├── src/
│   ├── index.ts              # Entry point, reads config, bootstraps
│   ├── core/
│   │   ├── state.ts          # State machine (idle → active → editing → submitting)
│   │   ├── editor.ts         # contentEditable management, edit capture
│   │   ├── differ.ts         # Diff builder (text, style, image, meta)
│   │   ├── selector.ts       # Element fingerprinting (CSS selector, siblings, ancestors)
│   │   ├── highlighter.ts    # Hover overlay on editable elements
│   │   └── meta-editor.ts    # Page metadata (title, description, OG tags) editing
│   ├── ui/
│   │   ├── auth-modal.ts     # Login form (email/password)
│   │   ├── toolbar.ts        # Pending edits count, submit button
│   │   ├── style-panel.ts    # CSS property editor
│   │   ├── image-panel.ts    # Image src/alt editor
│   │   ├── meta-panel.ts     # SEO metadata editor (title, description, OG)
│   │   ├── history-panel.ts  # Client's past edits with status (pending/approved/rejected)
│   │   ├── toast.ts          # Success/error notifications
│   │   └── styles.ts         # All CSS (injected into Shadow DOM)
│   ├── api/
│   │   ├── client.ts         # HTTP client (submit edits, fetch history)
│   │   └── supabase.ts       # Supabase client init (Auth, Realtime, Storage)
│   └── utils/
│       ├── dom.ts            # DOM helpers
│       └── shadow.ts         # Shadow DOM container management
├── vite.config.ts            # IIFE build → inline-editor.js
└── package.json
```

#### Script Tag Format

```html
<script
  src="https://api.ship.studio/inline-editor.js"
  data-studio-id="proj_a1b2c3d4"
  defer
></script>
```

- `data-studio-id` — maps to `inline_editor_config.studio_id`
- No API key exposed in the script tag (auth handled via Supabase Auth in the script)
- Script includes `@supabase/supabase-js` (~45-50KB total bundle) for direct Auth, Realtime, and Storage
- Script is inert until `?editor=true` is in the URL

#### Editor Activation Flow

```
1. Script loads on every page (~45-50KB with Supabase SDK)
2. Checks URL for ?editor=true parameter
3. If not present → script stays dormant (zero overhead, SDK not initialized)
4. If present:
   a. Initialize Supabase client
   b. POST /api/v1/edits/validate-origin to verify domain is allowed
   c. Check for existing Supabase session (supabase.auth.getSession())
   d. If no session → show login modal (email/password via supabase.auth.signInWithPassword())
   e. On valid session → query inline_editor_config + project_clients via Supabase to verify access
   f. Subscribe to Supabase Realtime for edit status updates
   g. Activate editor (show toolbar, enable hover highlights)
```

#### Edit Types Supported

| Type | Description | Captured Data |
|------|-------------|---------------|
| `text_change` | Modified text content | originalText, newText, elementFingerprint |
| `image_change` | Changed image src/alt | originalSrc, newSrc (Supabase Storage URL), originalAlt, newAlt |
| `style_change` | Modified CSS properties | Array of {property, oldValue, newValue} |
| `meta_change` | Updated page metadata | field (title/description/og:*), oldValue, newValue |

#### Element Fingerprinting

Critical for the developer (or AI) to locate the element in source code. Captured per edit:

```typescript
interface ElementFingerprint {
  cssSelector: string;           // "main > section:nth-child(2) > h2"
  tagName: string;               // "h2"
  textContent: string;           // Exact visible text (before edit)
  parentText: string;            // Parent element text (200 chars)
  previousSiblingText: string;   // Sibling context
  nextSiblingText: string;
  nearestIdAncestor: string | null;
  classList: string[];
  dataAttributes: Record<string, string>;
  ariaLabel: string | null;
  src: string | null;            // For images
}
```

#### Image Upload Flow

When a client changes an image, the new image is uploaded to Supabase Storage:

```
1. Client clicks image → Image panel opens
2. Client selects new image file (or drags and drops)
3. Script uploads to Supabase Storage via SDK:
   supabase.storage.from('edit-images').upload(
     `${studioId}/${batchId}/${filename}`, file
   )
4. Public URL returned and used as newSrc in the edit diff
5. When developer applies the edit, Claude downloads the image
   and places it in the project's /public folder
```

**Storage bucket:** `edit-images` (public, organized by `studioId/batchId/`)
**Retention:** Images cleaned up after edit is applied or rejected (via API background job)

### 1.3 — Ship Studio Desktop App Changes

#### 1.3.1 Developer Authentication with Supabase

Ship Studio currently uses GitHub CLI auth only (no user accounts). We need to add Supabase authentication so the desktop app can communicate with the API.

**Approach**: Add a lightweight login flow that connects the developer's Ship Studio desktop app to their Supabase account. This will likely piggyback on the existing GitHub OAuth — since developers already connect GitHub via `gh auth login`, we can use GitHub OAuth through Supabase Auth.

**New files:**

```
src/lib/supabase.ts              # Supabase client initialization
src/lib/auth.ts                  # Login/logout, session management
src/hooks/useAuth.ts             # React hook for auth state
src/components/AuthGate.tsx      # Wraps features that require login
src/components/LoginModal.tsx    # Login UI (GitHub OAuth button)
```

**Auth flow:**
1. Developer clicks "Sign in" (new button in header/settings)
2. Opens browser for GitHub OAuth via Supabase Auth
3. Supabase handles OAuth callback, creates/links profile
4. Desktop app receives session token via deep link (`shipstudio://auth/callback`)
5. Token stored securely (Tauri secure store or keychain)
6. Subsequent API calls include token in Authorization header

**Rust-side changes:**
- New command module: `src-tauri/src/commands/auth.rs`
  - `start_supabase_auth()` — opens browser for OAuth
  - `handle_auth_callback(token)` — stores session
  - `get_auth_session()` — returns current session
  - `logout()` — clears session
- Deep link handler for `shipstudio://auth/callback`

#### 1.3.2 Project ↔ Supabase Linking

Ship Studio projects are identified by local file path. To enable inline editing, we need to link each project to a Supabase `projects` row.

**Linking flow (triggered when developer enables inline editor):**
1. Developer clicks "Enable Inline Editor" in project settings
2. Desktop app reads the local git remote URL (e.g., `github.com/acme/website`)
3. API checks: does a `projects` row with matching `repo_url` or `github_repo_full_name` exist?
4. If found → link to it. If not → auto-create a new `projects` row with repo info from local git.
5. API creates `inline_editor_config` row with generated `studio_id`
6. Store `remote_project_id` (the Supabase `projects.id`) in `.shipstudio/project.json`

**Schema change** — add to `.shipstudio/project.json`:
```json
{
  "remote_project_id": "uuid-from-supabase",
  "studio_id": "proj_a1b2c3d4e5f6"
}
```

#### 1.3.3 Inline Editor Config Panel

New UI in project settings for configuring the inline editor.

**Location**: New section in the existing `ProjectSettingsModal` component.

**UI Elements:**
- Toggle: Enable/disable inline editor for this project
- Studio ID: Auto-generated, displayed read-only with copy button
- Script tag: Copyable `<script>` snippet
- Allowed domains: Editable list of domains where the script should work
- Editing mode: Full (text + styles + images) vs Light (text + images only)

**New files:**
```
src/components/InlineEditorConfig.tsx    # Config panel (rendered inside ProjectSettingsModal)
src/lib/inline-editor.ts                # API calls for config management
```

**Flow:**
1. Developer opens project settings
2. Clicks "Enable Inline Editor"
3. App reads git remote, calls API to link/create project + config
4. Shows copyable script tag
5. Developer pastes into their site's HTML

#### 1.3.4 Client Management

UI for developers to invite and manage clients who can use the inline editor.

**Location**: Within the inline editor config section or a "Clients" tab.

**UI Elements:**
- List of current clients (name, email, role, status)
- "Invite Client" button → email input
- Remove client button
- Pending invitations list

**Leverages existing tables:** `project_clients` and `invites`.

**Client invite flow:**
1. Developer enters client's email in Ship Studio
2. API calls `supabase.auth.admin.inviteUserByEmail(email, { redirectTo })`
3. Supabase sends invite email with password setup link
4. API creates `invites` row (project_id, email, token)
5. Client clicks link → sets password → account created in Supabase Auth
6. API webhook/trigger adds row to `project_clients` (linking user to project)
7. Client can now visit `site.com?editor=true` and log in

**New files:**
```
src/components/ClientManagement.tsx      # Client list + invite UI
src/components/InviteClientModal.tsx     # Invite form
```

#### 1.3.5 Client Edits Workspace Tab

The core developer UX for reviewing edits. New tab in the workspace.

**Location**: 5th tab in workspace tab bar: `[Preview] [Code] [Branches] [PRs] [Edits •3]`

**Implementation**: Extend `workspaceTab` type in `useWorkspaceLayout.ts` from `'preview' | 'code' | 'branches' | 'prs'` to include `'edits'`. Add tab button in `WorkspaceView.tsx` tab bar. Badge shows pending edit count.

**UI Elements:**

```
┌─────────────────────────────────┐
│ Client Edits           3 pending│
├─────────────────────────────────┤
│ ┌─────────────────────────────┐ │
│ │ Text Change                 │ │
│ │ "Welcome to our site"       │ │
│ │  → "Welcome to Acme Corp"   │ │
│ │ by jane@acme.com · 2h ago   │ │
│ │ Page: /about                │ │
│ │ [Approve] [Reject] [View]   │ │
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │ Image Change                │ │
│ │ hero-banner.jpg → new.jpg   │ │
│ │ by jane@acme.com · 3h ago   │ │
│ │ Page: /                     │ │
│ │ [Approve] [Reject] [View]   │ │
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │ Meta Change                 │ │
│ │ title: "Home" → "Acme Home" │ │
│ │ by bob@acme.com · 5h ago    │ │
│ │ Page: /                     │ │
│ │ [Approve] [Reject] [View]   │ │
│ └─────────────────────────────┘ │
├─────────────────────────────────┤
│ Filter: [All ▾] [Pending ▾]    │
└─────────────────────────────────┘
```

**Actions:**
- **Approve** → Marks edit as approved. In Phase 1, developer then manually applies it using Claude in the terminal.
- **Reject** → Marks as rejected with optional note (sent back to client).
- **View** → Expands to show full diff detail, element fingerprint, and a "Apply with Claude" button that pre-fills a Claude prompt.

**"Apply with Claude" button behavior (Phase 1):**
1. Constructs a prompt with the edit context (original text, new text, element fingerprint, page URL)
2. Sends it to the Claude terminal as a pre-filled message
3. Claude uses the diff + fingerprint to locate and modify the correct file
4. Developer reviews Claude's changes and commits

**Prompt template:**
```
The client requested the following change on page "{pageUrl}":

Element: {tagName} at {cssSelector}
Context: {parentText}

Change type: {editType}
Original: "{originalText}"
New: "{newText}"

Element fingerprint:
- Nearest ID ancestor: {nearestIdAncestor}
- Classes: {classList}
- Siblings: {previousSiblingText} | [ELEMENT] | {nextSiblingText}

Please find this element in the codebase and make the requested change.
```

**New files:**
```
src/components/ClientEditsPanel.tsx      # Main sidebar panel
src/components/EditCard.tsx              # Individual edit card
src/components/EditDetailModal.tsx       # Expanded edit view
src/lib/inline-edits.ts                 # API calls for fetching/managing edits
src/hooks/useClientEdits.ts             # Hook for polling/managing edit state
```

**Realtime updates:**
- Subscribe to Supabase Realtime on `inline_edits` table filtered by `project_id`
- New edits appear instantly in the tab without polling
- Badge count updates in real-time on the "Edits" tab
- Falls back to polling (via existing `src/lib/polling.ts`) if Realtime connection drops

#### 1.3.6 Rust Backend Changes

Minimal Rust changes needed since most logic is in the API service:

```
src-tauri/src/commands/auth.rs           # Supabase auth (OAuth, session, deep link)
src-tauri/src/commands/inline_editor.rs  # Proxy calls to Ship Studio API (optional, could go direct from frontend)
```

The desktop app's frontend will call the Ship Studio API directly (via `fetch`) for edit-related operations. The Rust backend is needed mainly for:
- Secure session storage (keychain integration)
- Deep link handling for OAuth callback
- Optionally proxying API calls to add the auth token

---

## Phase 2: Auto-Apply via AI

Phase 2 adds automatic edit application — when a client submits an edit, it can be automatically applied without developer intervention.

### 2.1 — AI Edit Applier (API-side)

Add to the Ship Studio API:

```
src/lib/server/ai/
├── applier.ts           # Claude API integration for applying edits
├── prompts.ts           # System + user prompts for each edit type
└── file-finder.ts       # Locate correct source file via GitHub API
```

#### Application Flow

```
1. Edit submitted (or approved)
2. If auto-apply enabled for project:
   a. Fetch project's GitHub repo info
   b. Search for files containing original text/element (via GitHub code search)
   c. Fetch candidate file contents
   d. Send to Claude API with edit context + file content
   e. Claude returns modified file
   f. Validate changes (minimal diff, correct replacement)
   g. Create branch + commit + PR via GitHub API
   h. Update edit status to 'applied' with PR URL
3. Developer sees PR in Ship Studio (existing PR panel)
4. Developer merges PR → changes go live
```

#### Auto-Apply Config

Add to `inline_editor_config`:

```sql
ALTER TABLE public.inline_editor_config
  ADD COLUMN auto_apply boolean NOT NULL DEFAULT false,
  ADD COLUMN auto_apply_types text[] DEFAULT '{}',  -- Which edit types to auto-apply
  ADD COLUMN require_approval boolean NOT NULL DEFAULT true; -- Require dev approval before auto-apply
```

**Modes:**
- `auto_apply: false` — Phase 1 behavior (manual review only)
- `auto_apply: true, require_approval: true` — AI applies after developer approves
- `auto_apply: true, require_approval: false` — AI applies immediately on submission (creates PR for review)

### 2.2 — GitHub App Integration

For auto-apply to create PRs, the API needs GitHub access to the project's repo. Options:

**Option A: Use existing `projects.github_token`**
The existing `projects` table already has `github_token` and `github_installation_id`. If the developer has already connected their repo (via the marketing site or template marketplace), we can reuse this.

**Option B: GitHub App Installation**
Create a "Ship Studio" GitHub App that developers install on their repos. More secure (scoped permissions) and doesn't require personal access tokens.

**Recommendation**: Start with Option A (reuse existing tokens), migrate to Option B later.

### 2.3 — Desktop App Changes for Phase 2

- Add "Auto-apply" toggle in inline editor config
- Edit cards show "Applied" status with PR link
- Notification when auto-apply fails (falls back to manual)

---

## Implementation Order

### Sprint 1: Foundation (Week 1-2)

1. **Database migrations** — Add `inline_editor_config` and `inline_edits` tables, alter `project_clients`
2. **RLS policies** — Write and test all Row Level Security policies for direct Supabase access
3. **Supabase Storage** — Create `edit-images` bucket with upload/read policies
4. **Slim API scaffold** — SvelteKit project with 3 endpoints: enable project, invite client, validate origin

### Sprint 2: Inline Editor Script (Week 2-3)

5. **Script scaffold** — Vite IIFE build, Shadow DOM container, state machine
6. **Auth modal** — Email/password login form in Shadow DOM
7. **Text editing** — contentEditable, diff capture, element fingerprinting
8. **Image editing** — Image panel for src/alt changes
9. **Meta editing** — Page title/description/OG tag editor
10. **Submit flow** — Toolbar with pending count, submit to API

### Sprint 3: Desktop App Integration (Week 3-4)

11. **Supabase auth in desktop app** — GitHub OAuth via Supabase, deep link callback, session storage
12. **Inline editor config UI** — Enable/disable, script tag copy, domain config
13. **Client management UI** — Invite clients, list/remove, pending invites
14. **Client edits sidebar panel** — Poll for edits, display cards, approve/reject
15. **"Apply with Claude" flow** — Construct prompt, send to terminal

### Sprint 4: Polish & Phase 2 Prep (Week 4-5)

16. **Edit detail view** — Expanded diff view with full context
17. **Notifications** — Badge counts, attention indicators
18. **Client-side UX polish** — Toast messages, loading states, error handling
19. **Phase 2: AI applier** — Claude API integration, file finder, PR creation
20. **Phase 2: Auto-apply config** — Toggle in settings, per-type configuration

---

## Key Technical Decisions

### 1. Script ↔ Supabase Authentication

The inline editor script includes `@supabase/supabase-js` and authenticates clients directly:
- Client logs in via `supabase.auth.signInWithPassword({ email, password })`
- Session managed by Supabase SDK (stored in localStorage, auto-refreshed)
- API calls include the Supabase JWT in `Authorization: Bearer <jwt>`
- API validates JWT via Supabase admin client, checks `project_clients` for project access
- Supabase Realtime channel subscriptions use the same authenticated session

**Why not API keys?** API keys in the script tag would be visible in page source. User-based auth ensures only invited clients can edit.

**Why include Supabase SDK in the script?** Direct Supabase connection gives us native Realtime subscriptions, automatic token refresh, and Supabase Storage uploads for images — all without proxying through the API.

### 2. Studio ID Format

`studio_id` is a unique identifier embedded in the script tag. Format: `proj_` + 12 random alphanumeric chars.

Example: `proj_a1b2c3d4e5f6`

Generated server-side when inline editor is enabled for a project. Maps 1:1 with `projects.id` via `inline_editor_config`.

### 3. CORS Strategy

The API must handle CORS since the script runs on arbitrary client domains:
- `inline_editor_config.allowed_domains` lists permitted origins
- API checks `Origin` header against allowed domains
- Supports wildcards: `*.example.com`
- Strict in production, permissive in development

### 4. Script Loading Strategy

The script should be as lightweight as possible on pages where `?editor=true` is NOT present:

```typescript
// index.ts - Entry point (~1KB)
(function() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('editor')) return; // Exit immediately

  // Only load full editor when needed
  import('./editor-full.ts').then(m => m.boot());
})();
```

**Build strategy**: Vite code-splitting with a tiny entry chunk and a lazy-loaded main chunk. On non-editor pages, only ~1KB is parsed.

### 5. Supabase Realtime

Use Supabase Realtime for both the desktop app and the inline editor:

**Desktop app** — Subscribe to `inline_edits` inserts/updates filtered by `project_id`. New edits appear in the sidebar instantly without polling.

**Inline editor script** — Subscribe to edit status changes for the current client. When a developer approves/rejects an edit, the client sees the update in their history panel in real-time.

**Collaboration awareness** — When multiple clients are editing the same page, Supabase Realtime Presence can show who else is active (optional, nice-to-have for later).

```typescript
// Desktop app example
const channel = supabase
  .channel('project-edits')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'inline_edits',
    filter: `project_id=eq.${projectId}`
  }, (payload) => {
    addEditToPanel(payload.new);
  })
  .subscribe();
```

### 6. Where Claude Prompt is Constructed

Phase 1 constructs the prompt in the desktop app frontend (`src/lib/inline-edits.ts`), not in Rust. This keeps it flexible and easy to iterate on. The prompt is sent to the existing Claude terminal.

---

## Security Considerations

1. **No secrets in the script tag** — Only `studio_id` and Supabase anon key are exposed (anon key is designed to be public).
2. **Supabase RLS** — Row Level Security policies on `inline_edits` ensure clients can only read their own edits and developers can only access edits for their projects.
3. **Domain validation** — API rejects edit submissions from non-allowed origins (checked against `inline_editor_config.allowed_domains`).
4. **JWT validation** — API validates Supabase JWT and checks `project_clients` for project-level access control.
5. **Rate limiting** — API applies per-user rate limits on edit submissions.
6. **Input sanitization** — All edit content is sanitized before storage (no XSS in stored HTML).
7. **CORS** — Strict origin checking against `allowed_domains`.
8. **Storage policies** — Supabase Storage bucket `edit-images` uses policies: clients can upload to their project's folder, read is public (for preview), delete only by project owner.
9. **Desktop auth tokens** — Stored in OS keychain via `keyring` crate, never in plaintext files.

---

## Decisions (Resolved)

1. **Billing**: Free for now. No usage tracking/limits needed initially.
2. **Edit history**: Yes — clients should see their past edits and status (approved/rejected). Add a history view to the inline editor script.
3. **Collaboration**: Yes — use Supabase Realtime for concurrent editing awareness. Multiple clients can edit the same page simultaneously.
4. **Undo/Revert**: Not needed for initial release.
5. **Preview**: Yes — clients edit inline (text is contentEditable, images are replaced live, metadata edits show in a panel). Changes are visible immediately on the page before submitting.
6. **Versioning/Conflicts**: Not needed for initial release.

---

## File Impact Summary

### New Repos/Packages
- `ship-studio-api/` — SvelteKit API service (new repo)
- `packages/editor/` — Inline editor script (IIFE build, lives in this repo)
- `packages/shared/` — Shared TypeScript types used by both the desktop app and the editor script (edit diffs, fingerprints, statuses)

### Ship Studio Desktop Changes

**New files:**
| File | Purpose |
|------|---------|
| `src/lib/supabase.ts` | Supabase client init (Auth + Realtime) |
| `src/lib/auth.ts` | Auth helpers (login via Supabase OAuth, logout, session) |
| `src/lib/inline-edits.ts` | API calls for edits (fetch, approve, reject) + Realtime subscription |
| `src/lib/inline-editor.ts` | API calls for editor config + project linking |
| `src/hooks/useAuth.ts` | Auth state hook |
| `src/hooks/useClientEdits.ts` | Client edits state + Realtime subscription management |
| `src/components/LoginModal.tsx` | Developer login UI (GitHub OAuth via Supabase) |
| `src/components/AuthGate.tsx` | Wraps features that require Supabase auth |
| `src/components/InlineEditorConfig.tsx` | Editor config panel (inside ProjectSettingsModal) |
| `src/components/ClientManagement.tsx` | Client list + invite UI |
| `src/components/InviteClientModal.tsx` | Invite form (email input) |
| `src/components/ClientEditsPanel.tsx` | "Edits" workspace tab content |
| `src/components/EditCard.tsx` | Individual edit card |
| `src/components/EditDetailModal.tsx` | Expanded edit view with Apply with Claude |
| `src-tauri/src/commands/auth.rs` | Supabase OAuth + keychain session storage + deep link handler |

**Modified files:**
| File | Change |
|------|--------|
| `src/App.tsx` | Add auth state, pass to workspace |
| `src/hooks/useWorkspaceLayout.ts` | Add `'edits'` to `workspaceTab` type |
| `src/components/WorkspaceView.tsx` | Add "Edits" tab button + content panel |
| `src/components/ProjectSettingsModal.tsx` | Add inline editor config section |
| `src-tauri/src/lib.rs` | Register new auth commands |
| `src-tauri/src/commands/projects/metadata.rs` | Add `remote_project_id` and `studio_id` to metadata schema |
| `src-tauri/Cargo.toml` | Add `keyring` crate for secure token storage |
| `package.json` | Add `@supabase/supabase-js` dependency |

### Database Changes
| Change | Table |
|--------|-------|
| New table | `inline_editor_config` |
| New table | `inline_edits` |
| New Storage bucket | `edit-images` (for client image uploads) |
| Add column | `project_clients.can_inline_edit` |
| (Phase 2) Add columns | `inline_editor_config.auto_apply`, `auto_apply_types`, `require_approval` |
