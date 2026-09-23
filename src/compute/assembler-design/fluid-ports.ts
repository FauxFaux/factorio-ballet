import type { DesignDirection } from '../design.ts';
import type { KernelProblem } from '../kernel-problems.ts';
import { rotatedSize } from './strategy.ts';

export function fluidRotation(
  specification: KernelProblem['assemblers'][number],
  firstFlow: 'input' | 'output',
  firstTarget: DesignDirection,
  secondFlow?: 'input' | 'output',
  secondTarget?: DesignDirection,
): DesignDirection | undefined {
  if (!specification.fluidBoxes) return undefined;
  return (['north', 'east', 'south', 'west'] as const).find(
    (direction) =>
      hasRotatedFluidPort(specification, firstFlow, firstTarget, direction) &&
      (!secondFlow ||
        !secondTarget ||
        hasRotatedFluidPort(specification, secondFlow, secondTarget, direction)),
  );
}

export function centeredFluidRotation(
  specification: KernelProblem['assemblers'][number],
  firstFlow: 'input' | 'output',
  firstTarget: 'east' | 'west',
  secondFlow?: 'input' | 'output',
  secondTarget?: 'east' | 'west',
): DesignDirection | undefined {
  return (['north', 'east', 'south', 'west'] as const).find(
    (direction) =>
      hasRotatedCenteredFluidPort(specification, firstFlow, firstTarget, direction) &&
      (!secondFlow ||
        !secondTarget ||
        hasRotatedCenteredFluidPort(specification, secondFlow, secondTarget, direction)),
  );
}

function hasRotatedCenteredFluidPort(
  specification: KernelProblem['assemblers'][number],
  flow: 'input' | 'output',
  target: 'east' | 'west',
  rotation: DesignDirection,
): boolean {
  if (!specification.size) return false;
  const halfWidth = Math.floor(rotatedSize(specification.size, rotation).width / 2);
  const targetPosition = { x: target === 'east' ? halfWidth : -halfWidth, y: 0 };
  return Boolean(
    specification.fluidBoxes?.some(
      (box) =>
        (box.productionType === flow || box.productionType === 'input-output') &&
        box.connections.some((connection) => {
          const position = rotatePosition(connection.position, rotation);
          return (
            (connection.flowDirection === flow || connection.flowDirection === 'input-output') &&
            rotateDirection(connection.direction, rotation) === target &&
            position.x === targetPosition.x &&
            position.y === targetPosition.y
          );
        }),
    ),
  );
}

function hasRotatedFluidPort(
  specification: KernelProblem['assemblers'][number],
  flow: 'input' | 'output',
  target: DesignDirection,
  rotation: DesignDirection,
): boolean {
  return Boolean(
    specification.fluidBoxes?.some(
      (box) =>
        (box.productionType === flow || box.productionType === 'input-output') &&
        box.connections.some(
          (connection) =>
            (connection.flowDirection === flow || connection.flowDirection === 'input-output') &&
            rotateDirection(connection.direction, rotation) === target,
        ),
    ),
  );
}

export function rotatedPortBoxIndex(
  specification: KernelProblem['assemblers'][number],
  flow: 'input' | 'output',
  target: DesignDirection,
  position: { x: number; y: number },
  rotation: DesignDirection,
): number | undefined {
  const index = specification.fluidBoxes?.findIndex(
    (box) =>
      (box.productionType === flow || box.productionType === 'input-output') &&
      box.connections.some((connection) => {
        const rotated = rotatePosition(connection.position, rotation);
        return (
          (connection.flowDirection === flow || connection.flowDirection === 'input-output') &&
          rotateDirection(connection.direction, rotation) === target &&
          rotated.x === position.x &&
          rotated.y === position.y
        );
      }),
  );
  return index === -1 ? undefined : index;
}

export function trunkFacesOnlyFluidInputs(
  specification: KernelProblem['assemblers'][number],
  side: 'east' | 'west',
  rotation: DesignDirection,
): boolean {
  const edgeX = side === 'east' ? 1 : -1;
  const ports = specification.fluidBoxes!.flatMap((box) =>
    box.connections.flatMap((connection) => {
      const position = rotatePosition(connection.position, rotation);
      return rotateDirection(connection.direction, rotation) === side && position.x === edgeX
        ? [{ box, connection }]
        : [];
    }),
  );
  return (
    ports.length > 0 &&
    ports.every(
      ({ box, connection }) =>
        (box.productionType === 'input' || box.productionType === 'input-output') &&
        (connection.flowDirection === 'input' || connection.flowDirection === 'input-output'),
    )
  );
}

function rotateDirection(direction: DesignDirection, rotation: DesignDirection): DesignDirection {
  const directions: DesignDirection[] = ['north', 'east', 'south', 'west'];
  return directions[(directions.indexOf(direction) + directions.indexOf(rotation)) % 4];
}

function rotatePosition(
  position: { x: number; y: number },
  rotation: DesignDirection,
): { x: number; y: number } {
  let rotated = position;
  const turns = ['north', 'east', 'south', 'west'].indexOf(rotation);
  for (let turn = 0; turn < turns; turn += 1) {
    rotated = { x: -rotated.y, y: rotated.x };
  }
  return rotated;
}
