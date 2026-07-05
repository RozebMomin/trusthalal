# trusthalal-brand

Landing page for the bare `trusthalal.org` domain. Routes visitors to the surface that matches their role:

- **Diners** → [halalfoodnearme.com](https://halalfoodnearme.com)
- **Restaurant owners** → [owner.trusthalal.org](https://owner.trusthalal.org)
- **Verifiers** → [halalfoodnearme.com/become-a-verifier](https://halalfoodnearme.com/become-a-verifier)

Kept intentionally lean: one page, no api client, no analytics, no shared design system. Same warm palette as the family of apps but its Tailwind footprint is self-contained.

## Local dev

```
cd apps/brand
npm install
npm run dev
```

Runs on port `3005` (so it doesn't collide with the consumer app on 3003, admin on 3001, owner on 3002).

## Scripts

- `npm run dev` — dev server on `:3005`
- `npm run build` — production build
- `npm run start` — serve the production build
- `npm run lint` — eslint
- `npm run typecheck` — tsc

## Deployment

Deployed to Vercel as a separate project pointed at `trusthalal.org` (bare domain). Zero env vars needed — the page has no runtime API calls.
