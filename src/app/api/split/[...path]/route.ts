import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { claimSchema, contributionSchema, createSchema, finalizedAmounts, hostClaimSchema, joinSchema, modeSchema, settlementSchema, transferStatusSchema, validatedSnapshot, type Room } from '@/lib/split';
import { inviteOrigin } from '@/lib/invite-url';

export const runtime = 'nodejs';
const uuid = z.string().uuid();
const token = z.string().regex(/^[a-f0-9]{64}$/);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = () => process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
function clients() {
  if (!url() || !publishable() || !process.env.SUPABASE_SECRET_KEY) throw new Error('CONFIG_MISSING');
  return {
    auth: createClient(url()!, publishable()!, { auth: { persistSession: false } }),
    admin: createClient(url()!, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } }),
  };
}
async function identity(request: Request, auth: ReturnType<typeof clients>['auth']) {
  const bearer = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
  if (!bearer) throw new Error('UNAUTHORIZED');
  const { data, error } = await auth.auth.getUser(bearer);
  if (error || !data.user) throw new Error('UNAUTHORIZED');
  return data.user.id;
}
async function body(request: Request) {
  if (Number(request.headers.get('content-length') ?? 0) > 50000) throw new Error('INVALID_INPUT');
  const raw = await request.text();
  if (raw.length > 50000) throw new Error('INVALID_INPUT');
  return JSON.parse(raw);
}
function failure(error: unknown) {
  const code = error instanceof z.ZodError || error instanceof SyntaxError ? 'INVALID_INPUT' : error instanceof Error ? error.message : 'SERVER_ERROR';
  const statuses: Record<string, number> = { INVALID_INPUT: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, FORBIDDEN_OR_EXPIRED: 403, INVITE_EXPIRED: 410, ROOM_EXPIRED: 410, ROOM_CLOSED: 409, ROOM_NOT_DRAFT: 409, ROOM_NOT_CLAIMING: 409, ROOM_NOT_FINALIZED: 409, INCOMPLETE_ALLOCATION: 409, VERSION_CONFLICT: 409, TOTAL_MISMATCH: 409, CONTRIBUTION_MISMATCH: 409, CONTRIBUTION_CONFLICT: 409, GROUP_CONFLICT: 409, ROOM_FULL: 409, CLAIM_CONFLICT: 409, ITEM_HAS_CLAIMS: 409, ITEM_NOT_FOUND: 404, ROOM_NOT_FOUND: 404, SETTLEMENT_NOT_FOUND: 404, TRANSFER_NOT_FOUND: 404, INVALID_CLAIM: 400, INVALID_MODE: 400, CONFIG_MISSING: 503, APP_URL_UNREACHABLE: 503, RATE_LIMITED: 429 };
  return json({ code: code in statuses ? code : 'SERVER_ERROR' }, statuses[code] ?? 500);
}
async function rpc(admin: ReturnType<typeof clients>['admin'], name: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new Error(/^[A-Z_]+$/.test(error.message) ? error.message : 'SERVER_ERROR');
  return data;
}
async function throttle(admin: ReturnType<typeof clients>['admin'], user: string, action: string) {
  const limits: Record<string, number> = { sessions: 5, join: 10, invites: 10, open: 10, mode: 30, claims: 60, 'host-claim': 60, finalize: 10, settlements: 30, contributions: 30, transfers: 30 };
  const allowed = await rpc(admin, 'split_throttle', { p_hash: hash(`${user}:${action}`), p_limit: limits[action] ?? 10 });
  if (!allowed) throw new Error('RATE_LIMITED');
}
type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const path = (await params).path;
    if (path.length !== 2 || path[0] !== 'preview') return json({ code: 'NOT_FOUND' }, 404);
    const invite = token.parse(path[1]);
    const { admin } = clients();
    const preview = await rpc(admin, 'split_invite_preview', { p_hash: hash(invite) });
    return preview ? json(preview) : json({ code: 'INVITE_EXPIRED' }, 410);
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    const path = (await params).path;
    const { auth, admin } = clients();
    const user = await identity(request, auth);
    const input = await body(request);
    await throttle(admin, user, path.length === 1 ? path[0] : path[1]);
    if (path.length === 1 && path[0] === 'sessions') {
      const parsed = createSchema.parse(input);
      const sessionId = parsed.bill.groupId
        ? await rpc(admin, 'split_create_group', { p_user: user, p_bill: validatedSnapshot(parsed.bill), p_host_name: parsed.hostName, p_group: parsed.bill.groupId })
        : await rpc(admin, 'split_create', { p_user: user, p_bill: validatedSnapshot(parsed.bill), p_host_name: parsed.hostName });
      return json({ sessionId });
    }
    if (path.length === 1 && path[0] === 'join') {
      const parsed = joinSchema.parse(input);
      const sessionId = await rpc(admin, 'split_join', { p_user: user, p_hash: hash(parsed.token), p_name: parsed.name });
      return json({ sessionId });
    }
    if (path.length !== 2) return json({ code: 'NOT_FOUND' }, 404);
    const sessionId = uuid.parse(path[0]);
    if (path[1] === 'invites') {
      const origin = inviteOrigin(request, process.env.NEXT_PUBLIC_APP_URL);
      const invite = randomBytes(32).toString('hex');
      const expiresAt = await rpc(admin, 'split_invite', { p_user: user, p_session: sessionId, p_hash: hash(invite) });
      return json({ url: `${origin}/join/${invite}`, expiresAt });
    }
    if (path[1] === 'open') { await rpc(admin, 'split_open', { p_user: user, p_session: sessionId }); return json({ ok: true }); }
    if (path[1] === 'mode') {
      const parsed = modeSchema.parse(input);
      await rpc(admin, 'split_mode', { p_user: user, p_session: sessionId, p_item: parsed.itemId, p_mode: parsed.mode });
      return json({ ok: true });
    }
    if (path[1] === 'claims') {
      const parsed = claimSchema.parse(input);
      if ((parsed.units === undefined) === (parsed.shared === undefined)) throw new Error('INVALID_INPUT');
      await rpc(admin, 'split_claim', { p_user: user, p_session: sessionId, p_item: parsed.itemId, p_units: parsed.units ?? null, p_shared: parsed.shared ?? null });
      return json({ ok: true });
    }
    if (path[1] === 'host-claim') {
      const parsed = hostClaimSchema.parse(input);
      if ((parsed.units === undefined) === (parsed.shared === undefined)) throw new Error('INVALID_INPUT');
      await rpc(admin, 'split_host_claim', { p_host: user, p_session: sessionId, p_item: parsed.itemId, p_participant: parsed.participantId, p_units: parsed.units ?? null, p_shared: parsed.shared ?? null });
      return json({ ok: true });
    }
    if (path[1] === 'finalize') {
      z.object({}).strict().parse(input);
      const session = await admin.from('split_sessions').select('*').eq('id', sessionId).single();
      if (session.error || !session.data || session.data.host_user_id !== user) throw new Error('FORBIDDEN');
      if (session.data.state === 'finalized') return json({ ok: true });
      const [items, participants, claims] = await Promise.all([
        admin.from('split_session_items').select('*').eq('session_id', sessionId).order('sort_order'),
        admin.from('split_participants').select('*').eq('session_id', sessionId),
        admin.from('split_item_claims').select('*').eq('session_id', sessionId),
      ]);
      if (items.error || participants.error || claims.error) throw new Error('SERVER_ERROR');
      const room = { session: session.data, items: items.data, participants: participants.data, claims: claims.data, summaries: [], settlements: [], contributions: [], transfers: [], me: user } as Room;
      const rows = finalizedAmounts(room);
      await rpc(admin, 'split_finalize_smart', { p_user: user, p_session: sessionId, p_expected_version: room.session.version, p_rows: rows });
      return json({ ok: true });
    }
    if (path[1] === 'contributions') {
      const parsed = contributionSchema.parse(input);
      await rpc(admin, 'split_set_contributions', { p_user: user, p_session: sessionId, p_expected_version: parsed.expectedVersion, p_rows: parsed.rows.map(row => ({ participant_id: row.participantId, amount_idr: row.amount })) });
      return json({ ok: true });
    }
    if (path[1] === 'transfers') {
      const parsed = transferStatusSchema.parse(input);
      await rpc(admin, 'split_set_transfer', { p_user: user, p_session: sessionId, p_transfer: parsed.transferId, p_status: parsed.status });
      return json({ ok: true });
    }
    if (path[1] === 'settlements') {
      const parsed = settlementSchema.parse(input);
      await rpc(admin, 'split_set_payment', { p_user: user, p_session: sessionId, p_participant: parsed.participantId, p_status: parsed.status });
      return json({ ok: true });
    }
    return json({ code: 'NOT_FOUND' }, 404);
  } catch (error) { return failure(error); }
}
