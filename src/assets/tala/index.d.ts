export interface LabelInput {
  text: string;
  width: number;
  height: number;
}

export interface NodeInput {
  id: string;
  parent?: string;
  width: number;
  height: number;
  shape?: string;
  label?: LabelInput;
}

export interface EdgeInput {
  id: string;
  source: string;
  target: string;
  sourceArrow?: boolean;
  targetArrow?: boolean;
  label?: LabelInput;
}

export interface LayoutRequest {
  nodes: NodeInput[];
  edges: EdgeInput[];
  direction?: "up" | "down" | "left" | "right";
  seeds?: number[];
}

export interface LayoutResult {
  nodes: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    labelPosition?: string;
  }>;
  edges: Array<{
    id: string;
    points: Array<{ x: number; y: number }>;
    labelPosition?: string;
    labelPercentage?: number;
  }>;
}

export class TALA {
  readonly ready: Promise<void>;
  layout(graph: LayoutRequest): Promise<LayoutResult>;
  dispose(): Promise<void>;
}
