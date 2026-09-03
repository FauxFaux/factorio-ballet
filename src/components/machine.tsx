import './machine.css';
import { machineName, type MachineMatch } from '../data/index.ts';
import { useMenu } from './menu.ts';
import { fmt } from '../ts.ts';
import type { Machine, MachineId } from '../types.ts';
import { machineIconStyle } from './icon.tsx';

/**
 * A machine as an icon and its crafting speed: the multiplier to apply to a recipe quoted at 1×.
 * Inert by default — a card listing what *could* run a recipe — and a button when the caller has
 * something for a click to do, as choosing the machine for a cell's entry does.
 */
export function MachineChip({
  id,
  machine,
  active,
  title,
  onClick,
  onMouseEnter,
}: {
  id: MachineId;
  machine: Machine;
  /** The machine currently standing for the numbers on show: hovered, or chosen. */
  active?: boolean;
  title?: string;
  onClick?: () => void;
  onMouseEnter?: () => void;
}) {
  const speed = `${fmt(machine.speed)}×`;
  const classes = active ? 'machine is-active' : 'machine';
  const label = title ?? `${machineName(id)} (${id}) at ${speed}`;
  const inner = (
    <>
      <span class="machine-icon" style={machineIconStyle(id, machine)} aria-hidden="true" />
      <span class="machine-speed">{speed}</span>
    </>
  );

  return onClick ? (
    <button
      type="button"
      class={classes}
      title={label}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      {inner}
    </button>
  ) : (
    <span class={classes} title={label} onMouseEnter={onMouseEnter}>
      {inner}
    </span>
  );
}

/**
 * Which machine runs a recipe, as a dropdown: the one in use, and the whole list only when asked
 * for. A cell is a list of these down the page, so the horizontal row of every candidate — right
 * for a search result, which is asking "what could run this?" — was most of the width of a row
 * spent on choices already made. The menu floats over the page rather than opening into it, so
 * nothing below a cell moves while you pick.
 */
export function MachinePicker({
  machines,
  chosen,
  pinned,
  onChoose,
}: {
  machines: MachineMatch[];
  /** The machine in use, whether that was chosen or defaulted. */
  chosen?: MachineId;
  /** Whether {@link chosen} was the user's choice rather than the default standing in for one. */
  pinned: boolean;
  onChoose: (id: MachineId | undefined) => void;
}) {
  const { open, setOpen, box } = useMenu();

  if (machines.length === 0) return null;

  const current = machines.find(({ id }) => id === chosen);
  const label = current
    ? `${machineName(current.id)} at ${fmt(current.machine.speed)}×${pinned ? '' : ', by default for this progress'}`
    : 'No machine can run this';

  const choose = (id: MachineId | undefined) => {
    onChoose(id);
    setOpen(false);
  };

  return (
    <div class="machine-picker" ref={box}>
      <button
        type="button"
        class={pinned ? 'machine is-active' : 'machine'}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${label} — click to change`}
        onClick={() => setOpen(!open)}
      >
        {current ? (
          <>
            <span
              class="machine-icon"
              style={machineIconStyle(current.id, current.machine)}
              aria-hidden="true"
            />
            <span class="machine-speed">{fmt(current.machine.speed)}×</span>
          </>
        ) : (
          <span class="machine-speed">—</span>
        )}
        <span class="machine-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div class="machine-menu" role="listbox" aria-label="Machine">
          {/* Not the same choice as the machine it currently resolves to: it follows the progress
              slider, which is what "auto" is for. Named as the count box's placeholder is, since
              both mean the same thing — nobody has decided, so something else will. */}
          <button
            type="button"
            class={pinned ? 'machine-option' : 'machine-option is-chosen'}
            role="option"
            aria-selected={!pinned}
            title="Whichever machine suits how far through the game you are"
            onClick={() => choose(undefined)}
          >
            <span class="machine-icon" aria-hidden="true" />
            <span class="machine-option-speed">—</span>
            <span class="machine-option-name">auto</span>
          </button>
          {machines.map(({ id, machine }) => (
            <button
              key={id}
              type="button"
              class={pinned && id === chosen ? 'machine-option is-chosen' : 'machine-option'}
              role="option"
              aria-selected={pinned && id === chosen}
              title={id}
              onClick={() => choose(id)}
            >
              <span class="machine-icon" style={machineIconStyle(id, machine)} aria-hidden="true" />
              <span class="machine-option-speed">{fmt(machine.speed)}×</span>
              <span class="machine-option-name">{machineName(id)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
