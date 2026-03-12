-- Add auto_apply setting to inline_editor_config
-- When enabled, client-submitted edits are automatically applied without manual review.

ALTER TABLE public.inline_editor_config
  ADD COLUMN auto_apply boolean NOT NULL DEFAULT false;
