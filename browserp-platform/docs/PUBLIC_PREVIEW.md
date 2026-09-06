# Preview local code with published public data

From `browserp-platform`, using Node.js 24:

```sh
npm ci
npm run dev:public
```

Open `http://127.0.0.1:8082/servers` or `http://127.0.0.1:8082/blog`. The command binds only to loopback, on macOS or Windows. Set `PORT` in your shell if 8082 is already occupied. Stop it with Ctrl+C.

The preview serves the files in your current checkout. Directory, game, listing and journal documents use the same server-rendered page handlers as the application, supplied with anonymous published API responses. Browser requests for the public directory, platforms, categories, overview, content, adverts, announcements, journal and listing images read from the fixed `https://www.browserp.com` origin.

The upstream receives only GET requests and an Accept header. Incoming cookies, Authorization, other headers and bodies are never forwarded; redirects are not followed. Writes to those public data endpoints receive 405. Staff, authentication and private APIs keep their local behaviour and are never proxied. The command refuses to start in production or Vercel environments.

Failed upstream reads remain errors; there is no invented catalogue or empty-content fallback. Counts and ranking can change while you browse. This preview requires internet access and is not an offline snapshot. Account linking, authenticated saves, staff access and production integrations need their own configured environment.

Preview responses carry a noindex header. Local HTTP keeps the normal document CSP except for `upgrade-insecure-requests`, so WebKit can load local assets without an HTTPS certificate. This exception exists only in this opt-in preview wrapper; production policy and normal development are unchanged.

`npm run dev` still uses the normal local configuration and intentionally empty catalogue when no backend is configured. Use `dev:public` for public design and content review without copying production credentials.
