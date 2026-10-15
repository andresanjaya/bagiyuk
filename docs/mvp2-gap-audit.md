# MVP 2 gap audit — 15 Oktober 2026

Audit of the current repository before Phase B changes. “Backend present” means code exists; it does not mean a Supabase project has been configured or tested.

| Capability | Existing UI? | Backend present? | DB persistence proven? | Cross-device proven? | Gap / root cause | Files to change |
| --- | --- | --- | --- | --- | --- | --- |
| Create cloud split session | Yes | Phase A RPC and route | No | No | Supabase variables absent locally; migration application unverified | Setup docs, cloud tests |
| Generate shareable link | Yes | Random token, hash-only invite RPC | No | No | Needs a configured app URL and live database | Setup docs, cloud tests |
| Generate scannable QR | Yes | `qrcode` encodes the returned URL | No | No | URL cannot be issued without backend; camera scan unverified | Cloud/device tests |
| Guest join without visible login | Yes | Anonymous Auth and transactional join RPC | No | No | Anonymous Sign-Ins and database setup unverified | Setup docs, cloud tests |
| Claim/unclaim item | Yes | Transactional RPC with session-row lock | No | No | No connected test project; no live contention proof | Cloud tests |
| Shared item / quantity | Yes | Shared-member and absolute-unit claim RPC | No | No | Server path exists; live allocation unverified | Cloud tests |
| Realtime subscription | Yes | Room-scoped `split_sessions` change subscription and refetch | No | No | Publication and RLS not verified in deployed DB; connection status incomplete | `src/components/split-together.tsx`, cloud tests |
| Finalize bill | No | No | No | No | No validation, immutable summary, or finalize transaction | `src/lib/split.ts`, API route, new migration, UI, tests |
| Mark paid/unpaid | No | No | No | No | No settlement table or host-only mutation | API route, new migration, UI, tests |
| Settlement summary | No | No | No | No | No persisted totals/remaining balances | `src/lib/split.ts`, UI, new migration, tests |

Additional findings:

- No `AGENTS.md` or earlier `PROMPT_MVP2_BAGIYUK.md` is present in this repository.
- `.env.local` has no Supabase URL, publishable key, or server secret. Deployment variables and existence of a Supabase project cannot be inspected from this workspace. `.env.example` has placeholders only.
- Online identity is a Supabase anonymous Auth session per browser. The server validates bearer tokens using `getUser`. User names are display text, not authorization.
- Online session, invite, participant, item, and claim tables are defined in `202610140001_split_together_phase_a.sql`. Their deployment and RLS behavior remain unverified. MVP 1's local data stays in localStorage.
- The invite route returns a random 32-byte token in a full URL; only its SHA-256 hash is persisted. The QR uses that URL. A valid guest route exists, but no camera or second-device check has run.
- The join RPC checks the invite and inserts one participant per authenticated user. The claim RPC locks the session row, checks capacity, and writes desired absolute quantities.
- Realtime subscribes to version updates on the session row and refetches on subscribe, browser focus, and network return. Actual publication delivery and RLS need a live database check.
- There is no paid/unpaid toggle yet. The Phase A migration closes direct browser writes through RLS; the new tables must do the same.
- Shell and workspace access work. No workspace/sandbox failure was observed during this audit.

External activation remains necessary: configure a dedicated Supabase project, enable anonymous sign-in, apply both migrations, confirm Realtime publication and RLS, and set local/Vercel environment variables. Do not treat code-only checks as DB or two-device proof.

## Implementation and verification update

- The repository now has a Phase B migration with member-readable final summaries and settlements, host-only server RPCs, atomic finalization, and a version check against concurrent claims. The API and UI now expose review/finalize and payment tracking. The Phase A invite/claim code remains in place.
- The provided Supabase URL and keys are stored in ignored `.env.local`. No key was added to tracked files. No production app URL was supplied.
- Read-only GET requests to the supplied project returned `PGRST205` for `split_sessions`, `split_finalized_summaries`, and `split_settlements`; neither migration has been applied there. `split_finalize` and `split_set_payment` returned `PGRST202`. The public Auth settings report `external.anonymous_users = false`. A HEAD response of 204 was initially misread as proof of table availability; GET and the empty OpenAPI resource list corrected that conclusion.
- The workspace has no Supabase CLI, management access token, or database password. Consequently, SQL deployment, Auth configuration, live RLS, two-identity Realtime, QR camera scanning, PWA installation, and paid/unpaid persistence remain unverified. Cloud tests must run only against a project confirmed to be disposable for test accounts and sessions.
- Local TypeScript check and production build passed. The full local suite passed 18/18 using a temporary Node `os.userInfo` workaround because this Windows environment returns `uv_os_get_passwd ENOMEM` before `tsx` starts. The old UI flow test was updated to use “Lihat semua” after the earlier bottom-menu removal.
