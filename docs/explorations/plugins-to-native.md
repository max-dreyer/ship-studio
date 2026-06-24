# Exploration: Plugins → Native Features

**Status: 🧪 EXPLORATORY — this may not ship.**

This branch (`plugin-removal`) is a spike, not a committed direction. It exists to
pressure-test an idea and see what the code actually looks like. Do not treat it
as a planned release, and do not assume it will merge.

## The idea

Ship Studio is open source. The plugin system was built to let the core stay
small while third parties (and we) extend it — most visibly the **Vercel,
Cloudflare, and Netlify hosting plugins**, which install per-project into
`.shipstudio/plugins/<id>/`.

But if the project is open source and we're going to build and maintain the
core anyway, the plugin layer starts to look like **redundant surface area**:

- It's a second way of doing things (a sandboxed React-bundle-over-blob-URL
  loader, a host API, an allow-listed `invoke` bridge, per-plugin storage, a
  crash/auto-uninstall harness) that has to be maintained alongside the native
  app.
- Hosting "plugins" are really just first-class product features wearing a
  plugin costume. Users expect deploy to *be* part of the app, not something
  they install.
- Native features get the full design system, the command palette, real tests,
  and don't need the isolation/escape-hatch machinery a third-party sandbox does.

So the question this branch explores: **what if hosting (and possibly more)
became native features, and the general-purpose plugin host went away?**

> Note: **MCP and Skills are NOT plugins.** They live in `components/plugins/`
> by folder convention only and are fully decoupled from the plugin host (gated
> by agent capability, with their own libs/commands/CSS). They stay regardless.

## What's in this branch so far

**Phase 1 — native Hosting picker (done, additive).**

- `Cmd+K → "Hosting"` opens a native modal to choose this project's provider
  (Vercel / Cloudflare / Netlify), persisted to `.shipstudio/project.json`
  (`hosting_provider`).
- Backend: `get/set/detect_hosting_provider` (`src-tauri/src/commands/projects/hosting.rs`).
- Frontend: `HostingModal`, `'hosting'` modal id, Cmd+K command, TS wrappers,
  feature CSS.

This phase is **purely additive** — the existing plugin system is untouched, so
nothing regresses while we evaluate the idea.

## Backwards compatibility (a hard requirement if this ever ships)

Existing users have hosting plugins installed in many projects and `.vercel` /
`.netlify` link configs on disk. The rule for this exploration:

- **Never make a configured project re-configure itself.** `detect_hosting_provider`
  infers a default from a real link config (`.vercel` / `.netlify`) or an
  installed hosting plugin dir, so old projects pre-select the correct provider
  automatically.
- **Don't regress before parity.** Removing the plugin host before native
  hosting can actually deploy would delete users' working deploy buttons. So the
  sequence is strictly: build native → reach parity → only then remove plugins.
- Orphaned `.shipstudio/plugins/` dirs left after a removal are inert (nothing
  reads them); a migration could clean them up, but it isn't required for
  correctness.

## Rough phased shape (if it graduates from spike to plan)

1. **Native Hosting selector** — _done in this branch._ Persist the choice.
2. **Deploy routing** — the Publish flow reads `hosting_provider` and routes:
   Vercel = the existing git-push (Vercel's GitHub integration auto-deploys);
   Netlify/Cloudflare = local build + native CLI deploy (`netlify deploy`,
   `wrangler pages deploy`), recording real URLs into the existing
   `PublishRecord` schema. This is the bulk of the work — each provider is a
   non-trivial state machine (CLI detect/install/auth → account/team select →
   link/create → deploy → status → URLs → disconnect).
3. **Plugin teardown** — only after parity: delete the loader/manager/slots,
   relocate `McpModal`/`SkillsModal` out of `components/plugins/`, and migrate
   away orphan plugin dirs.

## Open questions

- Is full removal of the general plugin host worth it, or do we keep it for
  genuine third-party extensions and only make *hosting* native?
- Cloudflare has no surviving plugin source — its native flow is derived by
  analogy to Netlify (`wrangler` Pages). Worth validating against a real account.
- How much of the plugins' live deploy-status polling do users actually rely on
  vs. "push and check the dashboard"?

## Bottom line

A real, working first slice that proves the native path is clean — kept entirely
additive so it costs nothing to walk away from. Whether plugins actually get
removed is still an open product call.
