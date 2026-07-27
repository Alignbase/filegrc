# FileGRC site

This directory contains the static Astro marketing site for FileGRC. Read the
repository root `AGENTS.md` before changing product claims or setup commands.

## Stack

- Astro 7 with static output
- Plain Astro components and CSS
- No client framework
- Cloudflare Pages output under `dist/`

## Product and writing

- Describe FileGRC as a Git-native GRC workspace for SOC 2 work.
- State that JSON holds structured records, Markdown holds long-form work, and
  Git supplies the change history.
- Make clear that starter records are proposals, not compliance claims.
- Do not imply that FileGRC replaces infrastructure, identity, monitoring,
  endpoint, backup, training, signature, procurement, or auditor systems.
- Do not imply that FileGRC decides whether audit evidence is sufficient.
- Keep sentences short and speak directly to engineers.
- Follow the writing style rules in the repository root `AGENTS.md`.

## Design

- Use the FileGRC palette: deep navy, electric indigo, soft lavender, green for
  valid state, and amber for work that needs attention.
- Keep headings editorial and body copy direct.
- Reuse the generic product screenshots from `public/`.
- Keep the homepage useful without JavaScript. JavaScript may support the mobile
  menu and copy buttons.

## Checks

Run `npm run site:validate` and `npm run site:build` from the repository root.
