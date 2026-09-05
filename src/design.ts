/** A cardinal direction on the design grid, independent of Factorio's encoded directions. */
export type DesignDirection = 'north' | 'east' | 'south' | 'west';

/** The tile at an entity's top-left corner. */
export interface DesignPosition {
  x: number;
  y: number;
}

/** A rectangle measured in whole grid tiles. */
export interface DesignSize {
  width: number;
  height: number;
}

interface DesignEntityBase {
  /** The entity's top-left tile, except for one-tile entities where it is their only tile. */
  position: DesignPosition;
}

/** A recipe-running machine. Its bounds are {@link position} plus {@link size}. */
export interface DesignAssembler extends DesignEntityBase {
  kind: 'assembler';
  size: DesignSize;
  /** The recipe prototype id, as used by {@link CellEntry}. */
  recipe: string;
}

export interface DesignBelt extends DesignEntityBase {
  kind: 'belt';
  direction: DesignDirection;
}

export interface DesignUndergroundBelt extends DesignEntityBase {
  kind: 'underground-belt';
  direction: DesignDirection;
  end: 'input' | 'output';
}

export interface DesignSplitter extends DesignEntityBase {
  kind: 'splitter';
  direction: DesignDirection;
}

export interface DesignPipe extends DesignEntityBase {
  kind: 'pipe';
}

export interface DesignUndergroundPipe extends DesignEntityBase {
  kind: 'underground-pipe';
  direction: DesignDirection;
}

export interface DesignInserter extends DesignEntityBase {
  kind: 'inserter';
  direction: DesignDirection;
}

/** An entity the simplified factory blueprint can place on a {@link DesignColumn}. */
export type DesignEntity =
  | DesignAssembler
  | DesignBelt
  | DesignUndergroundBelt
  | DesignSplitter
  | DesignPipe
  | DesignUndergroundPipe
  | DesignInserter;

/** One independently arranged vertical slice of a cell's factory design. */
export interface DesignColumn {
  entities: DesignEntity[];
}

/** The editable factory blueprint attached to a cell. */
export interface FactoryDesign {
  columns: DesignColumn[];
}

/** Start a design with its first blank column. */
export function newFactoryDesign(): FactoryDesign {
  return { columns: [{ entities: [] }] };
}
