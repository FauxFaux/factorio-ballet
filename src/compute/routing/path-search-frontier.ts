export type Entry = {
  state: number;
  cost: number;
  steps: number;
  turns: number;
  estimate: number;
  estimatedSteps: number;
};

function precedes(a: Entry, b: Entry): boolean {
  return (
    a.estimate < b.estimate ||
    (a.estimate === b.estimate &&
      (a.estimatedSteps < b.estimatedSteps ||
        (a.estimatedSteps === b.estimatedSteps &&
          (a.turns < b.turns ||
            (a.turns === b.turns &&
              (a.steps > b.steps || (a.steps === b.steps && a.state < b.state)))))))
  );
}

/** Binary min-heap; obsolete entries are discarded when popped. */
export class Frontier {
  private entries: Entry[] = [];

  push(entry: Entry): void {
    let index = this.entries.length;
    this.entries.push(entry);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!precedes(entry, this.entries[parent])) break;
      this.entries[index] = this.entries[parent];
      index = parent;
    }
    this.entries[index] = entry;
  }

  pop(): Entry | undefined {
    const first = this.entries[0];
    const last = this.entries.pop();
    if (!last || !this.entries.length) return first;
    let index = 0;
    while (index * 2 + 1 < this.entries.length) {
      let child = index * 2 + 1;
      if (child + 1 < this.entries.length && precedes(this.entries[child + 1], this.entries[child]))
        child++;
      if (!precedes(this.entries[child], last)) break;
      this.entries[index] = this.entries[child];
      index = child;
    }
    this.entries[index] = last;
    return first;
  }
}
