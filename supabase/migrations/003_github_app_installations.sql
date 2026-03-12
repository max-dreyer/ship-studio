-- Store GitHub App installation data.
-- When a developer installs the Ship Studio GitHub App on their repos,
-- we store the installation_id so we can generate scoped access tokens
-- to read files and create PRs for the auto-apply feature.

CREATE TABLE public.github_app_installations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,                          -- The Ship Studio user who installed the app
  installation_id bigint NOT NULL UNIQUE,          -- GitHub's installation ID
  github_account_login text NOT NULL,              -- GitHub username or org name
  github_account_id bigint NOT NULL,               -- GitHub account ID
  github_account_type text NOT NULL DEFAULT 'User', -- 'User' or 'Organization'
  repository_selection text NOT NULL DEFAULT 'selected', -- 'all' or 'selected'
  suspended_at timestamptz,                        -- Non-null if installation is suspended
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT github_app_installations_pkey PRIMARY KEY (id),
  CONSTRAINT github_app_installations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE INDEX idx_github_installations_user ON public.github_app_installations(user_id);
CREATE INDEX idx_github_installations_account ON public.github_app_installations(github_account_login);

-- Track which repos each installation has access to (for 'selected' mode)
CREATE TABLE public.github_app_installation_repos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  installation_id bigint NOT NULL,
  repo_id bigint NOT NULL,                         -- GitHub repo ID
  repo_full_name text NOT NULL,                    -- e.g. "acme/website"
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT github_app_installation_repos_pkey PRIMARY KEY (id),
  CONSTRAINT github_app_installation_repos_installation_fkey
    FOREIGN KEY (installation_id)
    REFERENCES public.github_app_installations(installation_id)
    ON DELETE CASCADE,
  CONSTRAINT github_app_installation_repos_unique UNIQUE (installation_id, repo_id)
);

CREATE INDEX idx_github_repos_installation ON public.github_app_installation_repos(installation_id);
CREATE INDEX idx_github_repos_full_name ON public.github_app_installation_repos(repo_full_name);

-- RLS policies

ALTER TABLE public.github_app_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_app_installation_repos ENABLE ROW LEVEL SECURITY;

-- Users can read their own installations
CREATE POLICY "users_read_own_installations" ON public.github_app_installations
  FOR SELECT USING (user_id = auth.uid());

-- Users can read repos for their own installations
CREATE POLICY "users_read_own_installation_repos" ON public.github_app_installation_repos
  FOR SELECT USING (
    installation_id IN (
      SELECT installation_id FROM public.github_app_installations
      WHERE user_id = auth.uid()
    )
  );
