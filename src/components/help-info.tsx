import './help-info.css';
import { InfoIcon } from '@primer/octicons-react';
import { createPortal } from 'preact/compat';
import type { ComponentChildren } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';

interface HelpInfoContentProps {
  /** An accessible name describing the subject of the help. */
  label: string;
  children: ComponentChildren;
}

export type HelpInfoProps = HelpInfoContentProps &
  (
    | {
        open?: undefined;
        onDismiss?: undefined;
      }
    | {
        /**
         * Opens the help from application code. While this is true, incidental outside clicks and
         * Escape cannot close it: a tutorial step has to be acknowledged with the Dismiss button.
         */
        open: boolean;
        /** Called when a help panel opened by application code is explicitly dismissed. */
        onDismiss: () => void;
      }
  );

interface Position {
  left: number;
  top: number;
}

const VIEWPORT_MARGIN = 16;
const PANEL_GAP = 6;

/**
 * Progressive help attached to a compact info icon. Ordinary help behaves like a menu; help opened
 * through `open` behaves like a tutorial step and requires an explicit acknowledgement.
 */
export function HelpInfo({ label, children, open = false, onDismiss }: HelpInfoProps) {
  const [locallyOpen, setLocallyOpen] = useState(false);
  const [position, setPosition] = useState<Position>();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const dismiss = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const visible = open || locallyOpen;

  const place = () => {
    if (!trigger.current || !panel.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const popup = panel.current.getBoundingClientRect();
    const maximumLeft = Math.max(
      VIEWPORT_MARGIN,
      window.innerWidth - popup.width - VIEWPORT_MARGIN,
    );
    const left = Math.min(Math.max(anchor.left, VIEWPORT_MARGIN), maximumLeft);
    const roomBelow = window.innerHeight - anchor.bottom - PANEL_GAP - VIEWPORT_MARGIN;
    const roomAbove = anchor.top - PANEL_GAP - VIEWPORT_MARGIN;
    const top =
      popup.height <= roomBelow || roomBelow >= roomAbove
        ? Math.min(anchor.bottom + PANEL_GAP, window.innerHeight - popup.height - VIEWPORT_MARGIN)
        : Math.max(VIEWPORT_MARGIN, anchor.top - PANEL_GAP - popup.height);
    setPosition({ left, top: Math.max(VIEWPORT_MARGIN, top) });
  };

  useLayoutEffect(() => {
    if (!visible) {
      setPosition(undefined);
      return;
    }
    place();
  }, [visible, children]);

  useEffect(() => {
    if (!visible) return;
    const reposition = () => place();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible || open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !panel.current?.contains(target)) {
        setLocallyOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLocallyOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [visible, open]);

  useEffect(() => {
    if (open) dismiss.current?.focus();
  }, [open]);

  return (
    <span class="help-info">
      <button
        ref={trigger}
        type="button"
        class="help-info-trigger"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={visible}
        aria-controls={visible ? panelId : undefined}
        title={label}
        onClick={() => {
          if (!open) setLocallyOpen((wasOpen) => !wasOpen);
        }}
      >
        <InfoIcon />
      </button>
      {visible
        ? createPortal(
            <div
              ref={panel}
              id={panelId}
              class="help-info-panel"
              role="dialog"
              aria-label={label}
              style={position ? { left: position.left, top: position.top } : undefined}
            >
              <div class="help-info-content">{children}</div>
              {open ? (
                <button
                  ref={dismiss}
                  type="button"
                  class="help-info-dismiss"
                  onClick={() => {
                    setLocallyOpen(false);
                    onDismiss?.();
                    trigger.current?.focus();
                  }}
                >
                  Dismiss
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
