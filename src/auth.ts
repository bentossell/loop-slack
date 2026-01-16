import { getConfig } from './config.js';

export type Role = 'admin' | 'operator' | 'viewer';

export function getUserRole(userId: string): Role {
  const config = getConfig();
  
  if (config.auth.admins.includes(userId)) {
    return 'admin';
  }
  
  if (config.auth.operators.includes(userId)) {
    return 'operator';
  }
  
  return 'viewer';
}

export function canStartLoop(userId: string): boolean {
  const role = getUserRole(userId);
  return role === 'admin' || role === 'operator';
}

export function canStopLoop(userId: string, loopStartedBy?: string): boolean {
  const role = getUserRole(userId);
  if (role === 'admin') return true;
  if (role === 'operator') {
    // Operators can stop their own loops or any loop
    return true;
  }
  return false;
}

export function canCreateTask(userId: string): boolean {
  const role = getUserRole(userId);
  return role === 'admin' || role === 'operator';
}

export function canEditConfig(userId: string): boolean {
  return getUserRole(userId) === 'admin';
}

export function canApprove(userId: string): boolean {
  const role = getUserRole(userId);
  return role === 'admin' || role === 'operator';
}

export function formatRole(role: Role): string {
  switch (role) {
    case 'admin': return '👑 Admin';
    case 'operator': return '🔧 Operator';
    case 'viewer': return '👀 Viewer';
  }
}
