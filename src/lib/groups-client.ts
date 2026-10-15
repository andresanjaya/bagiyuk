import { browserSupabase } from './supabase';
import { cloudIdentity } from './split-client';

export type FriendGroup = { id: string; name: string; archived_at: string | null; last_used_at: string | null; created_at: string; member_count: number };
export type GroupMember = { id: string; group_id: string; display_name: string; sort_order: number };

export async function listGroups(createIdentity = true): Promise<FriendGroup[]> {
  await cloudIdentity(createIdentity);
  const { data, error } = await browserSupabase().from('friend_groups').select('id,name,archived_at,last_used_at,created_at,friend_group_members(count)').is('archived_at', null).order('updated_at', { ascending: false });
  if (error) throw new Error('Grup belum bisa dimuat. Periksa koneksi dan migrasi MVP 3.');
  return data.map(({ friend_group_members, ...group }) => ({ ...group, member_count: friend_group_members[0]?.count ?? 0 }));
}

export async function loadGroup(id: string): Promise<{ group: FriendGroup; members: GroupMember[] }> {
  await cloudIdentity(false);
  const client = browserSupabase();
  const [group, members] = await Promise.all([
    client.from('friend_groups').select('id,name,archived_at,last_used_at,created_at').eq('id', id).is('archived_at', null).single(),
    client.from('friend_group_members').select('id,group_id,display_name,sort_order').eq('group_id', id).order('sort_order'),
  ]);
  if (group.error || !group.data || members.error) throw new Error('Grup tidak tersedia untuk identitas browser ini.');
  return { group: group.data as FriendGroup, members: members.data as GroupMember[] };
}

export async function saveGroup(id: string | null, name: string, members: { id: string; display_name: string }[]) {
  await cloudIdentity(true);
  const { data, error } = await browserSupabase().rpc('split_group_save', { p_group: id, p_name: name, p_members: members });
  if (error) throw new Error(error.message === 'FORBIDDEN' ? 'Kamu tidak punya akses ke grup ini.' : 'Grup belum bisa disimpan. Periksa nama dan koneksi.');
  return data as string;
}

export async function archiveGroup(id: string) {
  await cloudIdentity(false);
  const { error } = await browserSupabase().rpc('split_group_archive', { p_group: id });
  if (error) throw new Error('Grup belum bisa diarsipkan. Coba lagi.');
}
