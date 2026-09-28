import type { ELK, ElkNode } from 'elkjs/lib/elk-api';
import type { LayoutRequest, LayoutResult } from '../../assets/tala/index.js';

let elkInstance: Promise<ELK> | undefined;

/** Convert the shared flow graph into ELK's layered graph and SVG-ready routes. */
export async function elkLayout(graph: LayoutRequest): Promise<LayoutResult> {
  elkInstance ??= import('elkjs/lib/elk.bundled.js')
    .then(({ default: ELK }) => new ELK())
    .catch((error: unknown) => {
      elkInstance = undefined;
      throw error;
    });
  const elk = await elkInstance;
  const input: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction':
        graph.direction === 'left'
          ? 'LEFT'
          : graph.direction === 'up'
            ? 'UP'
            : graph.direction === 'down'
              ? 'DOWN'
              : 'RIGHT',
    },
    children: graph.nodes.map(({ id, width, height }) => ({ id, width, height })),
    edges: graph.edges.map(({ id, source, target }) => ({
      id,
      sources: [source],
      targets: [target],
    })),
  };
  const result = await elk.layout(input);
  return {
    nodes: (result.children ?? []).map((node) => {
      if (
        node.x === undefined ||
        node.y === undefined ||
        node.width === undefined ||
        node.height === undefined
      ) {
        throw new Error(`ELK omitted coordinates for ${node.id}`);
      }
      return { id: node.id, x: node.x, y: node.y, width: node.width, height: node.height };
    }),
    edges: (result.edges ?? []).flatMap((edge) =>
      (edge.sections ?? []).map((section, index) => ({
        id: `${edge.id}_${index}`,
        points: [section.startPoint, ...(section.bendPoints ?? []), section.endPoint],
      })),
    ),
  };
}
