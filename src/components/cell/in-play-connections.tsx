import { recipeName, resourceName, staticData } from '../../data/index.ts';
import { fmt } from '../../ts.ts';
import type { ResourceId } from '../../types.ts';
import { recipeIconStyle } from '../icon.tsx';
import type { InternalConnections, InternalFlow } from './internal-calc.ts';

/** The recipe flow breakdown shown when an in-play resource is expanded. */
export function InPlayConnectionsView({
  id,
  connections,
  inputRate,
  outputRate,
  solved,
  onRecipeHover,
}: {
  id: ResourceId;
  connections: InternalConnections;
  inputRate: number | undefined;
  outputRate: number | undefined;
  solved: boolean;
  onRecipeHover: (recipe: string | undefined) => void;
}) {
  const resource = staticData.resources[id];

  if (!solved) {
    return (
      <div class="cell-connections cell-connections-pending">
        <ResourceDetails id={id} stackSize={resource?.stackSize} />
        Recipes appear once the cell is worked out.
      </div>
    );
  }
  return (
    <div class="cell-connections cell-in-play-connections">
      <ResourceDetails id={id} stackSize={resource?.stackSize} />
      <InPlayConnectionTable
        outputs={connections.outputs}
        inputs={connections.inputs}
        inputRate={inputRate}
        outputRate={outputRate}
        onRecipeHover={onRecipeHover}
      />
    </div>
  );
}

function ResourceDetails({ id, stackSize }: { id: ResourceId; stackSize?: number }) {
  return (
    <div class="cell-in-play-resource-details">
      <strong>{resourceName(id)}</strong>
      <span>
        {' · '}
        {id} · stack size {stackSize ?? 'fluid'}
      </span>
    </div>
  );
}

function InPlayConnectionTable({
  outputs,
  inputs,
  inputRate,
  outputRate,
  onRecipeHover,
}: {
  outputs: InternalFlow[];
  inputs: InternalFlow[];
  inputRate: number | undefined;
  outputRate: number | undefined;
  onRecipeHover: (recipe: string | undefined) => void;
}) {
  const outputFlows =
    inputRate === undefined
      ? outputs
      : [{ recipe: undefined, label: '[input]' as const, rate: inputRate }, ...outputs];
  const inputFlows =
    outputRate === undefined
      ? inputs
      : [...inputs, { recipe: undefined, label: '[output]' as const, rate: outputRate }];
  const rowCount = Math.max(outputFlows.length, inputFlows.length, 1);

  return (
    <div class="cell-in-play-connection-table">
      <strong class="cell-in-play-connection-heading cell-in-play-connection-made-by">
        Made by
      </strong>
      <strong class="cell-in-play-connection-heading cell-in-play-connection-used-by">
        Used by
      </strong>
      {Array.from({ length: rowCount }, (_, index) => {
        const output = outputFlows[index];
        const input = inputFlows[index];
        return (
          <div class="cell-in-play-connection-row" key={index}>
            <ConnectionRecipeFlow flow={output} onRecipeHover={onRecipeHover} />
            <ConnectionRate flow={output} />
            <ConnectionRate flow={input} />
            <ConnectionRecipeFlow flow={input} onRecipeHover={onRecipeHover} />
          </div>
        );
      })}
    </div>
  );
}

type ConnectionFlow = { recipe: string | undefined; rate: number; label?: '[input]' | '[output]' };

function ConnectionRecipeFlow({
  flow,
  onRecipeHover,
}: {
  flow: ConnectionFlow | undefined;
  onRecipeHover: (recipe: string | undefined) => void;
}) {
  if (!flow) return <span class="cell-in-play-connection-recipe">—</span>;
  if (!flow.recipe) {
    return (
      <span class="cell-in-play-connection-recipe cell-in-play-interface-flow">{flow.label}</span>
    );
  }
  const data = staticData.recipes[flow.recipe];
  return (
    <span
      class="cell-in-play-connection-recipe"
      title={`${fmt(flow.rate)}/s ${recipeName(flow.recipe)}`}
      onMouseEnter={() => onRecipeHover(flow.recipe)}
      onMouseLeave={() => onRecipeHover(undefined)}
    >
      <span
        class="recipe-icon"
        style={data ? recipeIconStyle(flow.recipe, data) : undefined}
        aria-hidden="true"
      />
      <span>{recipeName(flow.recipe)}</span>
    </span>
  );
}

function ConnectionRate({ flow }: { flow: ConnectionFlow | undefined }) {
  return <span class="cell-in-play-connection-rate">{flow ? `${fmt(flow.rate)}/s` : ''}</span>;
}
