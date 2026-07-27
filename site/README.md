# FileGRC site

The FileGRC marketing site. Astro builds static HTML for Cloudflare Pages.

## Develop

From the repository root:

```sh
npm install
npm run site:dev
```

The site opens at `http://localhost:3000`.
The site toolchain requires Node.js 22.12 or newer. FileGRC workspaces still
support Node.js 20 or newer.

## Validate and build

```sh
npm run site:validate
npm run site:build
```

Set `SITE_URL` when building for a domain other than `https://filegrc.com`.

## Deploy

Connect the repository to Cloudflare Pages with:

- Build command: `npm run site:build`
- Output directory: `site/dist`

You can also deploy from `site/` with Wrangler after the build finishes.
