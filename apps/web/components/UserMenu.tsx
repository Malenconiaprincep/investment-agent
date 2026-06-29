'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthUser } from '@/hooks/useAuthUser';
import './UserMenu.css';

type UserMenuProps = {
  user: AuthUser | null;
};

function avatarInitial(label: string, username: string): string {
  const trimmed = label.trim();
  if (trimmed.length >= 1) return trimmed.slice(0, 1).toUpperCase();
  return username.slice(0, 1).toUpperCase();
}

export function UserMenu({ user }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const toggle = useCallback(() => {
    setOpen((v) => !v);
  }, []);

  if (!user) {
    return (
      <div className="user-menu user-menu--loading" aria-hidden>
        <span className="user-menu__avatar user-menu__avatar--placeholder" />
      </div>
    );
  }

  const initial = avatarInitial(user.label, user.username);
  const isAdmin = user.role === 'admin';
  const canManageUsers = user.permissions.includes('admin');

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        type="button"
        className={`user-menu__trigger${open ? ' user-menu__trigger--open' : ''}`}
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`账号 ${user.label}`}
      >
        <span className="user-menu__avatar" aria-hidden>
          {initial}
        </span>
        <span className="user-menu__name">{user.label}</span>
        {isAdmin ? (
          <span className="user-menu__role-badge">Pro</span>
        ) : null}
        <span className="user-menu__chevron" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="user-menu__dropdown" role="menu">
          <div className="user-menu__meta">
            <span className="user-menu__meta-label">{user.label}</span>
            {isAdmin ? (
              <span className="user-menu__meta-role">管理员 · 完整功能</span>
            ) : (
              <span className="user-menu__meta-role">标准账号</span>
            )}
          </div>
          <Link
            href="/settings"
            className="user-menu__item"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            设置
          </Link>
          {canManageUsers ? (
            <Link
              href="/admin/users"
              className="user-menu__item"
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              用户管理
            </Link>
          ) : null}
          <form action="/api/auth/logout" method="post" role="none">
            <button type="submit" className="user-menu__item user-menu__item--danger" role="menuitem">
              退出登录
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
