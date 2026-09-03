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
      <InPlayConnectionColumn
        label="Made by"
        flows={connections.outputs}
        interfaceFlow={inputRate === undefined ? undefined : { label: '[input]', rate: inputRate }}
        onRecipeHover={onRecipeHover}
      />
      <InPlayConnectionColumn
        label="Used by"
        flows={connections.inputs}
        interfaceFlow={
          outputRate === undefined ? undefined : { label: '[output]', rate: outputRate }
        }
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

function InPlayConnectionColumn({
  label,
  flows,
  interfaceFlow,
  onRecipeHover,
}: {
  label: string;
  flows: InternalFlow[];
  interfaceFlow: { label: '[input]' | '[output]'; rate: number } | undefined;
  onRecipeHover: (recipe: string | undefined) => void;
}) {
  return (
    <section class="cell-connection-column">
      <strong>{label}</strong>
      {flows.length || interfaceFlow ? (
        <div class="cell-connection-flows">
          {interfaceFlow ? (
            <span
              class="cell-in-play-connection-flow cell-in-play-interface-flow"
              title={`${fmt(interfaceFlow.rate)}/s ${interfaceFlow.label}`}
            >
              <span>{interfaceFlow.label}</span>
              <span>{fmt(interfaceFlow.rate)}/s</span>
            </span>
          ) : null}
          {flows.map(({ recipe, rate }) => {
            const data = staticData.recipes[recipe];
            return (
              <span
                class="cell-in-play-connection-flow"
                key={recipe}
                title={`${fmt(rate)}/s ${recipeName(recipe)}`}
                onMouseEnter={() => onRecipeHover(recipe)}
                onMouseLeave={() => onRecipeHover(undefined)}
              >
                <span
                  class="recipe-icon"
                  style={data ? recipeIconStyle(recipe, data) : undefined}
                  aria-hidden="true"
                />
                <span>{recipeName(recipe)}</span>
                <span>{fmt(rate)}/s</span>
              </span>
            );
          })}
        </div>
      ) : (
        <p>—</p>
      )}
    </section>
  );
}
