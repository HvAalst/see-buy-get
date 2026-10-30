import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon, type IconName } from '../../shared/ui';

export interface MenuEntry {
  key: string;
  icon: IconName;
  label: string;
  /** Sign out, and anything else that ends something. Drawn in the danger colour, below a hairline. */
  danger?: boolean;
  onGo: () => void;
}

/**
 * THE ACCOUNT MENU — one control in the masthead instead of three buttons and a sentence.
 *
 * The header carried "Signed in as X", the company, an unverified tag, then Change password, Help and
 * Sign out: six things of four different weights competing along one line, and the identity — the thing
 * an operator checks before a decision that names them — was the quietest of them. The user pointed at
 * BondBridge's topbar, which is right: a brand on the left, one avatar button on the right, and
 * everything about the account behind it.
 *
 * Its numbers are BondBridge's, because the point of being shown a reference is to use it: a 220px
 * panel, an identity block with a hairline under it, rows of 10/16 at 13px with a 16px icon column, and
 * the ending action alone at the bottom under another hairline.
 *
 * THE AVATAR IS INITIALS, not a photograph. This console has no picture of anybody and inventing a
 * placeholder face for a company administrator would be furniture; two letters in the brand navy say
 * which account you are in, which is the whole job.
 *
 * Closes on an outside mousedown, on Escape, and on choosing anything. Escape and focus-return matter
 * here more than in most menus: the last row signs you out.
 */
export function ConsoleMenu({ name, under, warn, entries }: { name: string; under?: string; warn?: string; entries: MenuEntry[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  return (
    <div class={`cmenu${open ? ' cmenu--open' : ''}`} ref={root}>
      <button type="button" ref={trigger} class="cmenu__btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        <span class="cmenu__face" aria-hidden="true">
          {initials(name)}
        </span>
        <span class="cmenu__name">{name}</span>
        {/* The one thing that must be visible without opening anything: a name typed beside a shared
            setup key proves nothing, and every decision taken here is attributed to it. */}
        {warn ? <span class="ctag ctag--warn">{warn}</span> : null}
        <Icon name="chevronRight" size={14} class="cmenu__caret" />
      </button>

      {open ? (
        <div class="cmenu__pop" role="menu">
          <div class="cmenu__id">
            <span class="cmenu__idname">{name}</span>
            {under ? <span class="cmenu__idsub">{under}</span> : null}
          </div>
          <div class="cmenu__list">
            {entries
              .filter((e) => !e.danger)
              .map((e) => (
                <MenuRow key={e.key} entry={e} onDone={() => { trigger.current?.focus(); setOpen(false); }} />
              ))}
          </div>
          {entries.some((e) => e.danger) ? (
            <div class="cmenu__list cmenu__list--end">
              {entries
                .filter((e) => e.danger)
                .map((e) => (
                  <MenuRow key={e.key} entry={e} onDone={() => { trigger.current?.focus(); setOpen(false); }} />
                ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MenuRow({ entry, onDone }: { entry: MenuEntry; onDone: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      class={`cmenu__item${entry.danger ? ' cmenu__item--danger' : ''}`}
      onClick={() => {
        onDone();
        entry.onGo();
      }}
    >
      <Icon name={entry.icon} size={16} />
      {entry.label}
    </button>
  );
}

/** Two letters from a name. One word gives one letter rather than a letter and a comma. */
export function initials(name: string): string {
  const words = (name ?? '')
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export type { ComponentChildren };
