-- Add apply_steps column to track real-time progress of auto-apply pipeline
ALTER TABLE inline_edits
ADD COLUMN IF NOT EXISTS apply_steps jsonb DEFAULT '[]'::jsonb;
