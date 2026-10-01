import './routing-debug.css';
import { useEffect, useId, useState } from 'preact/hooks';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  GrabberIcon,
  SquareIcon,
  TrashIcon,
} from '@primer/octicons-react';
import type { RoutingDebugEntity, RoutingDebugState } from '../boot/url-handler.tsx';
import type { State } from '../ts.ts';
import { RoutingDebugGrid } from './routing-debug-grid.tsx';
import {
  availableEntity,
  connectionIsClear,
  connectionTile,
  containsTile,
  type RoutingDebugMode,
} from './routing-debug-interactions.ts';

const tools = [
  { mode: 'normal', label: 'Normal', Icon: GrabberIcon },
  { mode: 'source', label: 'Add source', Icon: ArrowRightIcon },
  { mode: 'sink', label: 'Add sink', Icon: ArrowLeftIcon },
  { mode: 'rectangle', label: 'Reserve space', Icon: SquareIcon },
  { mode: 'delete', label: 'Delete', Icon: TrashIcon },
] as const;

function gridDimension(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function RoutingDebug({ state }: { state: State<RoutingDebugState | undefined> }) {
  const [settings, setSettings] = state;
  const width = gridDimension(settings?.width, 96);
  const height = gridDimension(settings?.height, 64);
  const [draftWidth, setDraftWidth] = useState(String(width));
  const [draftHeight, setDraftHeight] = useState(String(height));
  const [mode, setMode] = useState<RoutingDebugMode>('normal');
  const [selection, setSelection] = useState<{ x: number; y: number }>();
  const [draftItem, setDraftItem] = useState('item-1');
  const [draftRate, setDraftRate] = useState('5');
  const [draftDirection, setDraftDirection] = useState<RoutingDebugEntity['direction']>('east');
  const [sizeError, setSizeError] = useState('');
  const itemListId = useId();
  const entities = settings?.entities ?? [];
  const rectangles = settings?.rectangles ?? [];
  const selected = entities.find((entity) => entity.x === selection?.x && entity.y === selection.y);
  const showEditor = mode === 'source' || mode === 'sink' || selected !== undefined;

  const entityProperties = () => {
    const item = draftItem.trim();
    const rate = Number(draftRate);
    return item && Number.isFinite(rate) && rate > 0
      ? { item, rate, direction: draftDirection }
      : undefined;
  };

  const updateSelected = (
    properties: Partial<Pick<RoutingDebugEntity, 'item' | 'rate' | 'direction'>>,
  ) => {
    if (!selected) return;
    if (properties.direction && !connectionIsClear({ ...selected, ...properties }, rectangles))
      return;
    setSettings((previous) => ({
      ...previous,
      entities: previous?.entities?.map((entity) =>
        entity.x === selected.x && entity.y === selected.y ? { ...entity, ...properties } : entity,
      ),
    }));
  };

  const deleteRectangle = (index: number) => {
    setSettings((previous) => ({
      ...previous,
      rectangles: previous?.rectangles?.filter((_, rectangleIndex) => rectangleIndex !== index),
    }));
    setSelection(undefined);
    setSizeError('');
  };

  const clickTile = (x: number, y: number) => {
    const entity = entities.find((entity) => entity.x === x && entity.y === y);
    if (mode === 'normal') {
      setSelection(entity ? { x, y } : undefined);
      if (entity) {
        setDraftItem(entity.item);
        setDraftRate(String(entity.rate));
        setDraftDirection(entity.direction);
      }
    } else if (mode === 'delete') {
      if (!entity) {
        const index = rectangles.findLastIndex((rectangle) => containsTile(rectangle, { x, y }));
        if (index !== -1) deleteRectangle(index);
        return;
      }
      setSettings((previous) => ({
        ...previous,
        entities: previous?.entities?.filter((entity) => entity.x !== x || entity.y !== y),
      }));
      setSelection(undefined);
      setSizeError('');
    } else if (mode === 'source' || mode === 'sink') {
      const properties = entityProperties();
      if (!properties) return;
      const kind = mode;
      const candidate = { kind, x, y, ...properties };
      if (!availableEntity(candidate, entities, rectangles)) return;
      setSettings((previous) => {
        const current = previous?.entities ?? [];
        if (!availableEntity(candidate, current, previous?.rectangles ?? [])) return previous;
        return { ...previous, entities: [...current, candidate] };
      });
    }
  };

  useEffect(() => {
    setDraftWidth(String(width));
    setDraftHeight(String(height));
  }, [width, height]);

  return (
    <section class="routing-debug" aria-labelledby="routing-debug-title">
      <h2 id="routing-debug-title">Routing debug</h2>
      <div class="routing-debug-controls">
        <div class="routing-debug-control-columns">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const nextWidth = Number(draftWidth);
              const nextHeight = Number(draftHeight);
              if (
                !Number.isSafeInteger(nextWidth) ||
                nextWidth < 1 ||
                !Number.isSafeInteger(nextHeight) ||
                nextHeight < 1
              )
                return;
              if (entities.some((entity) => entity.x >= nextWidth || entity.y >= nextHeight)) {
                setSizeError(
                  'Delete sources and sinks outside the new size before shrinking the grid.',
                );
                return;
              }
              if (
                rectangles.some(
                  (rectangle) =>
                    rectangle.x + rectangle.width > nextWidth ||
                    rectangle.y + rectangle.height > nextHeight,
                )
              ) {
                setSizeError('Reserved space extends outside the new size.');
                return;
              }
              setSizeError('');
              setSettings((previous) => ({ ...previous, width: nextWidth, height: nextHeight }));
            }}
          >
            <fieldset class="routing-debug-size">
              <legend>Grid size</legend>
              <label>
                Width
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={draftWidth}
                  onInput={(event) => setDraftWidth(event.currentTarget.value)}
                />
              </label>
              <span aria-hidden="true">×</span>
              <label>
                Height
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={draftHeight}
                  onInput={(event) => setDraftHeight(event.currentTarget.value)}
                />
              </label>
              <span>tiles</span>
              <button type="submit">Resize grid</button>
            </fieldset>
            {sizeError && <p role="alert">{sizeError}</p>}
          </form>
          <form
            class="routing-debug-editor"
            style={{ visibility: showEditor ? 'visible' : 'hidden' }}
            aria-hidden={!showEditor}
            onSubmit={(event) => event.preventDefault()}
          >
            <fieldset class="routing-debug-entity-controls" disabled={!showEditor}>
              <legend>
                {selected
                  ? `${selected.kind === 'source' ? 'Source' : 'Sink'} at (${selected.x}, ${selected.y})`
                  : showEditor
                    ? `New ${mode}`
                    : 'Source or sink'}
              </legend>
              <label>
                {mode === 'source' || selected?.kind === 'source'
                  ? 'Provided item'
                  : 'Consumed item'}
                <input
                  type="text"
                  required
                  pattern=".*\S.*"
                  list={itemListId}
                  value={draftItem}
                  onInput={(event) => {
                    const item = event.currentTarget.value;
                    setDraftItem(item);
                    if (item.trim()) updateSelected({ item: item.trim() });
                  }}
                />
              </label>
              <datalist id={itemListId}>
                {[...new Set(entities.map((entity) => entity.item))].map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
              <label>
                Rate (items/s)
                <input
                  type="number"
                  min="0"
                  step="any"
                  required
                  value={draftRate}
                  onInput={(event) => {
                    const draft = event.currentTarget.value;
                    setDraftRate(draft);
                    const rate = Number(draft);
                    if (Number.isFinite(rate) && rate > 0) updateSelected({ rate });
                  }}
                />
              </label>
              <label>
                Direction
                <select
                  value={draftDirection}
                  onChange={(event) => {
                    const direction = event.currentTarget.value as RoutingDebugEntity['direction'];
                    if (selected && !connectionIsClear({ ...selected, direction }, rectangles)) {
                      event.currentTarget.value = draftDirection;
                      return;
                    }
                    setDraftDirection(direction);
                    updateSelected({ direction });
                  }}
                >
                  {(['north', 'east', 'south', 'west'] as const).map((direction, index) => (
                    <option
                      key={direction}
                      value={direction}
                      disabled={
                        selected !== undefined &&
                        !connectionIsClear({ ...selected, direction }, rectangles)
                      }
                    >
                      {['North ↑', 'East →', 'South ↓', 'West ←'][index]}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
          </form>
        </div>
        <div class="routing-debug-toolbar" role="toolbar" aria-label="Routing tools">
          {tools.map(({ mode: toolMode, label, Icon }) => (
            <button
              key={toolMode}
              type="button"
              aria-pressed={mode === toolMode}
              title={label}
              onClick={() => {
                setMode(toolMode);
                setSelection(undefined);
              }}
            >
              <Icon aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        <p class="routing-debug-hint">
          {mode === 'normal'
            ? 'Click a source or sink to edit it, or drag it to move.'
            : mode === 'delete'
              ? 'Click a source, sink, or reserved rectangle to delete it.'
              : mode === 'rectangle'
                ? 'Drag from one corner to another to reserve space.'
                : entityProperties()
                  ? `Click an empty tile to add a ${mode}. Arrows show the direction items travel.`
                  : 'Enter an item name and a rate greater than zero before placing.'}
        </p>
      </div>
      <RoutingDebugGrid
        width={width}
        height={height}
        entities={entities}
        rectangles={rectangles}
        selection={selection}
        mode={mode}
        onClickTile={clickTile}
        onDeleteRectangle={deleteRectangle}
        onMoveEntity={(origin, destination) => {
          const entity = entities.find((entity) => entity.x === origin.x && entity.y === origin.y);
          if (
            !entity ||
            !availableEntity({ ...entity, ...destination }, entities, rectangles, origin)
          )
            return;
          setSettings((previous) => ({
            ...previous,
            entities: previous?.entities?.map((entity) =>
              entity.x === origin.x && entity.y === origin.y
                ? { ...entity, ...destination }
                : entity,
            ),
          }));
          setSelection(destination);
        }}
        onAddRectangle={(rectangle) => {
          setSettings((previous) => {
            if (
              previous?.entities?.some((entity) => containsTile(rectangle, connectionTile(entity)))
            )
              return previous;
            return { ...previous, rectangles: [...(previous?.rectangles ?? []), rectangle] };
          });
        }}
      />
    </section>
  );
}
