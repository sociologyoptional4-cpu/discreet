# Phase 2 results (backend + vertical slice)

Run on 2026-11-24 against **scratch PostgreSQL 14** with a small auth/storage shim (`supabase/tests/shim.sql`).
Docker is not installed on this machine, so the full Supabase local stack (GoTrue, Storage, Realtime) was **not** run.

| Check | Result |
|---|---|
| Access matrix (`supabase/tests/access_matrix.sql`): anonymous, unrelated user, participant, blocked user, suspended user, paused user | 57 passed, 0 failed |
| Simultaneous accept → one conversation, same id for both callers (`tests/concurrency.sh`) | passed |
| Send racing a block → send waits for the lock, then fails; 0 rows saved | passed |
| App unit tests (`mobile`, jest-expo): age gate, SecureStore chunking, error mapping, photo keys | 15 passed |
| `tsc --noEmit` (strict) | 0 errors |
| `expo export --platform ios` (Metro + Hermes bytecode) | success, 5.2 MB bundle |

## Not verified
- Anything that needs the real Supabase stack: email OTP delivery, Storage upload and signed-URL policies end to end, Realtime policy.
  The storage policies were exercised only through the shim's `storage.objects` table.
- Anything on a device: the app has not been launched in the iOS Simulator or on an iPhone. Two real accounts have not yet completed request → accept → message.
- Server-side photo re-encoding (Phase 3/4): today the client re-encodes and the bucket enforces JPEG and 600 KB.
- Performance targets (Phase 4, release build).
