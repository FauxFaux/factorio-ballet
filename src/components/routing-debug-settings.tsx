import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_ROUTING_OPTIONS } from '../compute/routing/conflict-search.ts';
import type { RoutingOptions } from '../compute/routing/types.ts';

const budgets = [
  { key: 'maxPathStates', label: 'Total A* states' },
  { key: 'maxNodes', label: 'Conflict search nodes' },
  { key: 'maxReservationStates', label: 'Reservation A* states' },
] as const;

function draftOptions(options?: RoutingOptions) {
  return {
    undergroundEnabled: options?.undergroundBeltReach !== undefined,
    undergroundBeltReach: String(options?.undergroundBeltReach ?? 4),
    reservationFirst: options?.reservationFirst ?? DEFAULT_ROUTING_OPTIONS.reservationFirst,
    maxPathStates: String(options?.maxPathStates ?? DEFAULT_ROUTING_OPTIONS.maxPathStates),
    maxNodes: String(options?.maxNodes ?? DEFAULT_ROUTING_OPTIONS.maxNodes),
    maxReservationStates: String(
      options?.maxReservationStates ?? DEFAULT_ROUTING_OPTIONS.maxReservationStates,
    ),
  };
}

export function RoutingDebugSettings({
  options,
  onApply,
}: {
  options?: RoutingOptions;
  onApply: (options?: RoutingOptions) => void;
}) {
  const [draft, setDraft] = useState(() => draftOptions(options));
  const [error, setError] = useState('');

  useEffect(() => {
    setDraft(draftOptions(options));
    setError('');
  }, [options]);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const { undergroundBeltReach: _oldReach, ...otherOptions } = options ?? {};
        const reach = Number(draft.undergroundBeltReach);
        if (
          draft.undergroundEnabled &&
          (!draft.undergroundBeltReach.trim() || !Number.isSafeInteger(reach) || reach < 0)
        ) {
          setError(
            'Belt reach must be a whole number of hidden tiles from zero to ' +
              Number.MAX_SAFE_INTEGER +
              '.',
          );
          return;
        }
        const next = {
          ...otherOptions,
          ...(draft.undergroundEnabled ? { undergroundBeltReach: reach } : {}),
          reservationFirst: draft.reservationFirst,
          maxPathStates: Number(draft.maxPathStates),
          maxNodes: Number(draft.maxNodes),
          maxReservationStates: Number(draft.maxReservationStates),
        };
        if (
          budgets.some(
            ({ key }) => !draft[key].trim() || !Number.isSafeInteger(next[key]) || next[key] < 0,
          )
        ) {
          setError(
            'Search budgets must be whole numbers from zero to ' + Number.MAX_SAFE_INTEGER + '.',
          );
          return;
        }
        setError('');
        onApply(next);
      }}
    >
      <fieldset class="routing-debug-search">
        <legend>Routing search</legend>
        <label>
          Routing strategy
          <select
            value={draft.reservationFirst ? 'reservation-first' : 'conflict-only'}
            onChange={(event) =>
              setDraft({
                ...draft,
                reservationFirst: event.currentTarget.value === 'reservation-first',
              })
            }
          >
            <option value="reservation-first">Reservations, then conflict search</option>
            <option value="conflict-only">Conflict search only</option>
          </select>
        </label>
        <label>
          Underground belts
          <select
            value={draft.undergroundEnabled ? 'enabled' : 'disabled'}
            onChange={(event) =>
              setDraft({ ...draft, undergroundEnabled: event.currentTarget.value === 'enabled' })
            }
          >
            <option value="disabled">Disabled</option>
            <option value="enabled">Enabled</option>
          </select>
        </label>
        <label>
          Belt reach (hidden tiles)
          <input
            type="number"
            min="0"
            max={Number.MAX_SAFE_INTEGER}
            step="1"
            required
            disabled={!draft.undergroundEnabled}
            value={draft.undergroundBeltReach}
            onInput={(event) =>
              setDraft({ ...draft, undergroundBeltReach: event.currentTarget.value })
            }
          />
        </label>
        {budgets.map(({ key, label }) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min="0"
              max={Number.MAX_SAFE_INTEGER}
              step="1"
              required
              value={draft[key]}
              onInput={(event) => setDraft({ ...draft, [key]: event.currentTarget.value })}
            />
          </label>
        ))}
        <button type="submit">Apply routing settings</button>
        <button
          type="button"
          onClick={() => {
            setDraft(draftOptions());
            setError('');
            onApply(undefined);
          }}
        >
          Reset routing defaults
        </button>
        <p class="routing-debug-hint">
          Belt reach counts hidden tiles between the underground entry and exit.
        </p>
        <p class="routing-debug-hint">
          Reservation states count toward the total A* budget and use at most a quarter of its
          remaining states.
        </p>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
