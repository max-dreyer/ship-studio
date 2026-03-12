-- Add auto_merge option to inline editor config
ALTER TABLE inline_editor_config
ADD COLUMN IF NOT EXISTS auto_merge boolean NOT NULL DEFAULT false;
