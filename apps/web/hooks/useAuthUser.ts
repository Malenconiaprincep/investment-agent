'use client';

import { useEffect, useState } from 'react';
import type { AppPermission, AppPlan, AppRole } from '@/lib/permissions';

export type AuthUser = {
  username: string;
  label: string;
  role: AppRole;
  plan: AppPlan;
  permissions: AppPermission[];
};

export function useAuthUser() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
          if (!cancelled) setUser(null);
          return;
        }
        const data = (await res.json()) as AuthUser;
        if (!cancelled) setUser(data);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function can(permission: AppPermission): boolean {
    if (user?.role === 'admin') return true;
    return user?.permissions.includes(permission) ?? false;
  }

  return { user, loading, can };
}
