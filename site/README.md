# filegrc site

The filegrc marketing site. Astro builds static HTML for Cloudflare Pages. Blog
posts use Astro content collections and MDX.

## Develop

From the repository root:

```sh
npm install
npm run site:dev
```

The site opens at `http://localhost:3000`.
The site toolchain requires Node.js 22.12 or newer. filegrc workspaces still
support Node.js 20 or newer.

## Validate and build

```sh
npm run site:validate
npm run site:build
```

Set `SITE_URL` when building for a domain other than `https://filegrc.com`.

## Blog

Blog posts live in `src/content/blog/`, render at `/blogs/<slug>`, and appear on
the `/blog` index. The content collection validates post metadata, FAQ entries,
and related reading links.

## Deploy

Connect the repository to Cloudflare Pages with:

- Build command: `npm run site:build`
- Output directory: `site/dist`

You can also deploy from `site/` with Wrangler after the build finishes.
