import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Sheet } from '../../shared/ui';
import { useWideScreen } from '../../shared/useWideScreen';

/**
 * A DETAIL IS A PANEL ON A DESK AND A SHEET IN A HAND.
 *
 * Pressing "Open" on a row rendered a stack of panels UNDER the table. At a desk that is right: the
 * list stays visible above the thing you opened, which is how somebody compares one row against the
 * next. On a phone it is not a detail view at all — the panels land below twenty rows of table, off
 * the bottom of a screen nobody has scrolled, and the honest report of that is the one we got: press
 * Open and nothing happens.
 *
 * So below the sidebar line it is the shared `Sheet` — the same slide-up this console already uses for
 * its navigation and the seven field apps use for everything. Above it the panels stay where they are
 * and are SCROLLED TO, because "nothing happened" is a fair complaint at any width when the thing that
 * happened is two screens down.
 *
 * `openKey` is what makes the scroll bearable: it fires when a DIFFERENT row is opened, not on every
 * re-render, so typing into the form the panel contains does not keep yanking the page back.
 */
export function ConsoleDetail({
  openKey,
  title,
  onClose,
  children,
}: {
  openKey: string;
  title: string;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const wide = useWideScreen();
  const top = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!wide) return;
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [openKey, wide]);

  if (!wide) {
    return (
      <Sheet open onClose={onClose} title={title}>
        {children}
      </Sheet>
    );
  }

  return (
    <div class="twr-detail" ref={top}>
      {children}
    </div>
  );
}
