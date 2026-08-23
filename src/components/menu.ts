import { useEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';

/**
 * The open/closed state of a menu which floats over the page, and the two ways out of it that are
 * not a choice: a click anywhere else, and Escape.
 *
 * Hang {@link box} on the element which owns the menu — that is what "anywhere else" is measured
 * against. The listeners are mounted only while this menu is open, so the click which opens a
 * second one closes the first without either of them knowing about the other.
 */
export function useMenu(): {
  open: boolean;
  setOpen: (open: boolean) => void;
  box: RefObject<HTMLDivElement>;
} {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return { open, setOpen, box };
}
