# Nearby Chat

An 18+ iPhone app for discovering people nearby and starting private text conversations.

```
prototype/   Phase 1: clickable design prototype (static HTML, open index.html)
supabase/    Phase 2: migrations, config, synthetic seed, security tests
mobile/      Phase 2: Expo SDK 58 + TypeScript + Expo Router app
docs/        design tokens and test results
```

## Status
Phase 1 (design) approved. Phase 2 (auth, profiles, private gallery uploads, city discovery, request → accept → message)
is **built and tested against scratch Postgres**, not yet run against a hosted Supabase project or a device. See `docs/phase2-results.md`.

## Run it
1. Create a **dedicated** Supabase project. In Auth, enable Email and set a 6-digit code; use the template in `supabase/templates/otp.html`.
   Configure transactional SMTP for real testers (the built-in mailer is rate-limited).
2. `supabase link --project-ref <ref> && supabase db push`  (applies `supabase/migrations/*`).
3. `cd mobile && cp .env.example .env` and fill in the project URL and the **publishable** key. Never put a service key in the app.
4. `npm install && npx expo start` (iOS development build for native modules: `npx expo run:ios`).

## Tests
```
# backend: needs any local Postgres, no Docker
export PGHOST=... PGPORT=... PGUSER=postgres
supabase/tests/run.sh            # builds a scratch DB, applies shim + migrations
psql -d nc_test -f supabase/tests/access_matrix.sql
supabase/tests/concurrency.sh    # two sessions racing
# app
cd mobile && npm test && npm run typecheck
```

## How it is built
- **No direct table access for clients.** Tables are locked by RLS and revoked grants; everything goes through
  `SECURITY DEFINER` functions that read identity from `auth.uid()` and apply block, status and rate rules in one place.
- **Messages** carry a client-generated id; `(sender_id, client_id)` is unique so retries never duplicate.
  `send_message` locks the conversation row, so a committed block always wins over a concurrent send.
- **Requests**: one pending request per unordered pair (partial unique index); accepting creates or reuses the single conversation in one transaction.
- **Photos**: private bucket, JPEG only, 600 KB cap, owner-folder write policy, read policy reuses the profile visibility rules (so a block stops new signed URLs). Max four slots by constraint.
- **Privacy**: date of birth is in `account_private` (own-row read only); discovery returns age, never birthday or location. Push jobs hold identifiers only.
- **Polling** every 4–8 s is a Phase 2 stand-in; Phase 3 replaces it with private Realtime hints plus the same cursor catch-up.

## Known gaps (next phases)
Phase 3: Realtime, push, report, account deletion, moderator workflow, server-side photo re-encode.
Phase 4: approximate location and distance bands, performance profiling on a release build, TestFlight.
Bundle identifier `com.example.nearbychat` is a placeholder.
