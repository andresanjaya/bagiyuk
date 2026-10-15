# MVP 3 gap audit — 15 October 2026

This is a repository audit before MVP 3 implementation. The attached PRD is a specification, not evidence that a deployed backend works.

| Feature | Current repository support | Gap | Minimal changes | Migration risk / evidence |
| --- | --- | --- | --- | --- |
| QR invitation and guest join | `split_invite`, `split_join`, `/api/split`, `JoinRoom`, QR component | Not deployed to configured project | Preserve | Supabase `split_sessions` returned `PGRST205`; anonymous sign-in flag is false. |
| Claims and room Realtime | `split_claim`, versioned `split_sessions` publication, room subscription | No live proof | Preserve/refetch new settlement state | Live two-client test blocked until Phase A/B migrations and Auth are enabled. |
| MVP 2 finalization | Phase B `split_finalize` writes immutable per-person summaries | No live proof | Extend atomically for contributions/transfers, retain existing RPC signature/path as compatibility path | Never rewrite old summaries. |
| MVP 2 Paid/Unpaid | `split_settlements` is one record per participant; host share defaults paid | Cannot model debtor-to-creditor edges or payment events | Add transfer-edge table and host-only status RPC; retain legacy read path | Historical Paid/Unpaid rows must not be synthesized or reset. |
| Private saved groups | None | No group tables, RLS, UI | Add `friend_groups`, `friend_group_members`, owner RLS, `/groups` views | Anonymous identity loss prevents recovery; names are templates, not identities. |
| Start from group | MVP 1 local `useBills` draft; MVP 2 cloud create copies a saved local bill | No group selection or session association | Seed an optional local draft with selected name templates; pass verified group reference to cloud session | Group roster edits cannot mutate old bill labels or authorize guests. |
| Multiple upfront payers | Single host implied by legacy settlement | No contribution storage or reconciliation | Server-validated contributions and transactional finalization | Sum must equal immutable grand total. |
| Transfer plan | None | No who-owes-whom edges | Deterministic integer calculator + persisted authoritative edges | Lock/version guard, idempotency, and no duplicate transfers. |
| Manual reminders | Existing generic sharing only | No per-transfer copy/share text | User-initiated copy/native share/WhatsApp | No automatic message and no invitation/secret in text. |

The repository has no `AGENTS.md`. The previous mobile changes (visible header and removed bottom menu) are already uncommitted and must remain intact. Existing local MVP 1 history is stored under `bagiyuk.v1`; `useBills` provides drafts and saved bills. Existing Supabase identity comes from `cloudIdentity` anonymous sign-in, while routes verify its JWT. The configured Supabase project currently has neither the Phase A/B tables nor anonymous sign-in; API keys alone do not grant SQL migration access. No cloud mutation or two-device test has run in this audit.

## Implementation update

An additive third migration now defines private groups, name-template RPCs, optional session group association, upfront contributions, transfer edges, and host-only status changes with an event log. The MVP 2 summary and settlement tables remain intact. Group routes, home shortcut, seeded local drafts, contribution inputs, server-authoritative finalization, transfer tracker, and user-initiated reminder actions were added. The pure integer transfer calculator has unit tests; the SQL RPC independently creates canonical edges in the same transaction as MVP 2 finalization. These are repository changes only until all migrations and Auth are enabled in the configured project.
