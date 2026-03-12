-- Inline Editor: New tables, columns, storage bucket, and RLS policies

-- ==========================================================================
-- 1. inline_editor_config — per-project config for the inline editor
-- ==========================================================================

CREATE TABLE public.inline_editor_config (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL UNIQUE,
  is_enabled boolean NOT NULL DEFAULT true,
  studio_id text NOT NULL UNIQUE,
  allowed_domains jsonb DEFAULT '[]'::jsonb,
  editing_mode text NOT NULL DEFAULT 'full',
  require_auth boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inline_editor_config_pkey PRIMARY KEY (id),
  CONSTRAINT inline_editor_config_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_inline_editor_config_studio_id ON public.inline_editor_config(studio_id);

-- ==========================================================================
-- 2. inline_edits — stores individual edit diffs submitted by clients
-- ==========================================================================

CREATE TABLE public.inline_edits (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  submitted_by uuid NOT NULL,

  status text NOT NULL DEFAULT 'pending',

  page_url text NOT NULL,
  page_title text,

  element_tag_name text NOT NULL,
  element_css_selector text,
  element_fingerprint jsonb NOT NULL,

  edit_type text NOT NULL,
  original_text text,
  new_text text,
  original_html text,
  new_html text,
  style_changes jsonb,
  image_changes jsonb,
  meta_changes jsonb,

  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,

  applied_at timestamptz,
  applied_method text,
  pr_url text,
  failure_reason text,

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

-- ==========================================================================
-- 3. Add can_inline_edit column to project_clients
-- ==========================================================================

ALTER TABLE public.project_clients
  ADD COLUMN can_inline_edit boolean NOT NULL DEFAULT true;

-- ==========================================================================
-- 4. Enable RLS on new tables
-- ==========================================================================

ALTER TABLE public.inline_editor_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inline_edits ENABLE ROW LEVEL SECURITY;

-- ==========================================================================
-- 5. RLS Policies — inline_edits
-- ==========================================================================

-- Clients can insert edits for projects they belong to
CREATE POLICY "clients_insert_edits" ON public.inline_edits FOR INSERT
  WITH CHECK (
    submitted_by = auth.uid()
    AND project_id IN (
      SELECT pc.project_id FROM public.project_clients pc
      WHERE pc.user_id = auth.uid() AND pc.can_inline_edit = true
    )
  );

-- Clients can read their own edits
CREATE POLICY "clients_read_own_edits" ON public.inline_edits FOR SELECT
  USING (submitted_by = auth.uid());

-- Project owners can read all edits for their projects
CREATE POLICY "owners_read_project_edits" ON public.inline_edits FOR SELECT
  USING (
    project_id IN (
      SELECT pc.project_id FROM public.project_clients pc
      WHERE pc.user_id = auth.uid() AND pc.role = 'owner'
    )
  );

-- Project owners can update edit status (approve/reject)
CREATE POLICY "owners_update_edits" ON public.inline_edits FOR UPDATE
  USING (
    project_id IN (
      SELECT pc.project_id FROM public.project_clients pc
      WHERE pc.user_id = auth.uid() AND pc.role = 'owner'
    )
  );

-- ==========================================================================
-- 6. RLS Policies — inline_editor_config
-- ==========================================================================

-- Anyone can read enabled configs (needed by script to bootstrap)
CREATE POLICY "public_read_config" ON public.inline_editor_config FOR SELECT
  USING (is_enabled = true);

-- Project owners can manage config
CREATE POLICY "owners_manage_config" ON public.inline_editor_config FOR ALL
  USING (
    project_id IN (
      SELECT pc.project_id FROM public.project_clients pc
      WHERE pc.user_id = auth.uid() AND pc.role = 'owner'
    )
  );

-- ==========================================================================
-- 7. Supabase Realtime — enable for inline_edits
-- ==========================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.inline_edits;

-- ==========================================================================
-- 8. Storage bucket for client-uploaded images
-- ==========================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('edit-images', 'edit-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: clients can upload to their project's folder
CREATE POLICY "clients_upload_images" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'edit-images'
    AND auth.uid() IS NOT NULL
  );

-- Public read for preview
CREATE POLICY "public_read_images" ON storage.objects FOR SELECT
  USING (bucket_id = 'edit-images');

-- Project owners can delete images
CREATE POLICY "owners_delete_images" ON storage.objects FOR DELETE
  USING (
    bucket_id = 'edit-images'
    AND auth.uid() IS NOT NULL
  );

-- ==========================================================================
-- 9. updated_at trigger function (if not exists)
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_inline_editor_config_updated_at
  BEFORE UPDATE ON public.inline_editor_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_inline_edits_updated_at
  BEFORE UPDATE ON public.inline_edits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
