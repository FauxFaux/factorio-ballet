import { machineName } from '../data.ts';
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
