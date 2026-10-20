# Deployment (24/7 cloud)

Local runs use PM2 (see README). To keep the app live when your machine is off, deploy the single
service to Render free + MongoDB Atlas free. The repo ships a `render.yaml` blueprint, so Render
creates everything automatically once the repo is connected.

## One-service model

`server/src/app.js` serves, on one port:
- `/api/v1/*` REST + `/socket.io` realtime (same origin → no CORS/proxy config)
- `/media/*` — locally the fetched clips + posters; with `MEDIA_MODE=remote` the three mp4s
  302-redirect to their public open-license archive.org sources (same URLs `scripts/fetch-media.sh`
  uses). Posters/SVGs ship in the repo, so they always serve locally.
- the built React app (`client/dist`) with SPA fallback for client-side routes.

## Steps

1. **MongoDB Atlas (free M0)** — create an organization/project, a FREE cluster, a database user
   (readWrite), Network Access = `0.0.0.0/0`, and copy the srv connection string.
2. **Seed it** from your machine (the seed data + authored timelines are code, not dumps):
   ```bash
   cd server
   MONGO_URI="<atlas srv string>" JWT_ACCESS_SECRET=x JWT_REFRESH_SECRET=x npm run seed
   ```
3. **Render (free web service)** — New > Blueprint > connect this GitHub repo. Render reads
   `render.yaml`. Fill `MONGO_URI` with the Atlas string when prompted. After the first deploy
   Render shows the public URL (`https://<name>.onrender.com`) — put that exact value into
   `CLIENT_ORIGIN` in the Render dashboard and redeploy.
4. Open the URL, log in with the demo accounts (README), join/create a watch space.

## Free-tier notes

- Render free sleeps after ~15 min without traffic; the first request after that cold-starts in
  ~30–60 s. Keep-alive pings or upgrading removes this.
- Atlas M0 has 512 MB storage — the seeded demo data is ~a few MB.
- Secrets live only in Render's env panel / Atlas — never in git (PRD §10.1).

## Verification after deploy

```bash
curl -s https://<name>.onrender.com/api/v1/health          # {"ok":true,...}
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" \
  https://<name>.onrender.com/media/sintel.mp4             # 302 -> archive.org
curl -s https://<name>.onrender.com/ | head -3             # SPA index.html
```

Then in a browser: two tabs in the same room — host play/pause/seek must mirror in the guest with
the drift badge staying green, chat must deliver, and the AI panel must answer with a CITED chip.
