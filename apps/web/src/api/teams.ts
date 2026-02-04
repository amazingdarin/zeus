import { getServerUrl } from '../config/api';
import { getAuthHeaders } from './auth';

export interface Team {
  id: string;
  slug: string;
  name: string;
  description: string;
  avatar_url?: string;
  owner_id: string;
  status: string;
  created_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  joined_at: string;
  user?: {
    id: string;
    username: string;
    display_name: string;
    avatar_url?: string;
  };
}

export interface TeamInvitation {
  id: string;
  team_id: string;
  email: string;
  role: string;
  invited_by: string;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  expires_at: string;
  created_at: string;
}

export interface CreateTeamRequest {
  name: string;
  slug: string;
  description?: string;
}

export interface UpdateTeamRequest {
  name?: string;
  description?: string;
  avatar_url?: string;
}

export interface InviteMemberRequest {
  email: string;
  role: 'admin' | 'member' | 'viewer';
}

async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...options.headers,
    },
  });
  return response;
}

export async function listTeams(): Promise<Team[]> {
  const response = await fetchWithAuth(`${getServerUrl()}/api/teams`);
  if (!response.ok) {
    throw new Error('Failed to fetch teams');
  }
  return response.json();
}

export async function getTeam(slug: string): Promise<Team> {
  const response = await fetchWithAuth(`${getServerUrl()}/api/teams/${slug}`);
  if (!response.ok) {
    throw new Error('Failed to fetch team');
  }
  return response.json();
}

export async function createTeam(data: CreateTeamRequest): Promise<Team> {
  const response = await fetchWithAuth(`${getServerUrl()}/api/teams`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to create team');
  }
  return response.json();
}

export async function updateTeam(slug: string, data: UpdateTeamRequest): Promise<Team> {
  const response = await fetchWithAuth(`${getServerUrl()}/api/teams/${slug}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to update team');
  }
  return response.json();
}

export async function deleteTeam(slug: string): Promise<void> {
  const response = await fetchWithAuth(`${getServerUrl()}/api/teams/${slug}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to delete team');
  }
}

export async function listTeamMembers(slug: string): Promise<TeamMember[]> {
  const response = await fetchWithAuth(`${getServerUrl()}/api/teams/${slug}/members`);
  if (!response.ok) {
    throw new Error('Failed to fetch team members');
  }
  return response.json();
}

export async function addTeamMember(slug: string, userId: string, role: string): Promise<void> {
  const response = await fetchWithAuth(`${getServerUrl()}/api/teams/${slug}/members`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, role }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to add member');
  }
}

export async function updateMemberRole(slug: string, userId: string, role: string): Promise<void> {
  const response = await fetchWithAuth(`${getServerUrl()}/api/teams/${slug}/members/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to update role');
  }
}

export async function removeMember(slug: string, userId: string): Promise<void> {
  const response = await fetchWithAuth(`${getServerUrl()}/api/teams/${slug}/members/${userId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to remove member');
  }
}

export async function listInvitations(slug: string): Promise<TeamInvitation[]> {
  const response = await fetchWithAuth(`${getServerUrl()}/api/teams/${slug}/invitations`);
  if (!response.ok) {
    throw new Error('Failed to fetch invitations');
  }
  return response.json();
}

export async function inviteMember(slug: string, data: InviteMemberRequest): Promise<TeamInvitation> {
  const response = await fetchWithAuth(`${getServerUrl()}/api/teams/${slug}/invitations`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to invite member');
  }
  return response.json();
}

export async function getPendingInvitations(): Promise<TeamInvitation[]> {
  const response = await fetchWithAuth(`${getServerUrl()}/api/invitations/pending`);
  if (!response.ok) {
    throw new Error('Failed to fetch invitations');
  }
  return response.json();
}

export async function acceptInvitation(invitationId: string): Promise<void> {
  const response = await fetchWithAuth(`${getServerUrl()}/api/invitations/${invitationId}/accept`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to accept invitation');
  }
}
