# Blueprint book notes

These notes describe Factorio 2.x blueprint books, using `balancers-truncated.json` as the primary
fixture. The fixture and other files in this directory are authoritative when they disagree with the
older `../blueprint.wiki`. See `RAIL.md` for the modern entity, direction, wire, and rail rules that
still apply to blueprints stored inside a book.

## Documents and wrappers

A blueprint exchange document has exactly one top-level wrapper key:

```json
{ "blueprint": { "item": "blueprint", "version": 562949958205441 } }
```

or:

```json
{ "blueprint_book": { "item": "blueprint-book", "version": 562949958205441 } }
```

The wrapper is part of the exchange format. Do not pass only its value to the encoder. A book is a
container and does not merge its children's entities, tiles, wires, schedules, or coordinates. Each
child blueprint remains an independent document body with its own local entity numbers and
positions.

Factorio 2.x can import this JSON directly. The compact exchange string contains the same complete
document: serialize it as JSON, zlib-compress its UTF-8 bytes, base64-encode the compressed bytes,
then prefix the result with the exchange-string version character `0`. This leading `0` is not the
book's numeric `version` field.

## Book shape

A book body has this shape:

```ts
interface BlueprintBook {
  item: "blueprint-book";
  version: number;
  label?: string;
  label_color?: Color;
  description?: string;
  icons?: Icon[];
  blueprints: BlueprintBookEntry[];
  active_index: number;
}

type BlueprintBookEntry =
  { index: number; blueprint: Blueprint } | { index: number; blueprint_book: BlueprintBook };
```

`blueprints` is the historical name of the child-entry array even though an entry can itself be a
book. Nesting is recursive. The discriminator is the key beside `index`: exactly one of `blueprint`
or `blueprint_book` should be present.

The important fields are:

- `item`: `"blueprint-book"` for every book body. The wrapper key uses an underscore while the item
  prototype uses a hyphen.
- `blueprints`: ordered child entries. Array order is the serialized order, while each entry's
  `index` is its book slot.
- `index`: a zero-based slot belonging to the enclosing book. It is unrelated to an entity's
  one-based `entity_number` and to an icon's one-based `index`.
- `active_index`: the selected child slot in this book, also zero-based. Each nested book has its
  own value.
- `version`: the Factorio map version written on the book. Generated books should normally copy a
  known-compatible fixture version rather than inventing one.
- `icons`: optional display icons. Icon indexes are one-based; a signal's omitted `type` means an
  item in Factorio 2.x.
- `label`, `description`, and `label_color`: optional presentation metadata. Rich text such as
  `[item=express-splitter]` may occur in labels or descriptions and should be retained verbatim.

Do not infer an entry's slot from its array position or renumber slots merely to make them dense.
Sparse indexes are valid and useful when a larger book has been truncated. Likewise, do not assume
that `active_index` is bounded by `blueprints.length - 1`; validate it against the entry indexes
that actually exist.

## The truncated balancer fixture

`balancers-truncated.json` contains one outer book and three child books:

| Outer entry index | Child label | Leaf count | Leaf indexes |
| ----------------: | ----------- | ---------: | ------------ |
|                 0 | `1 to x`    |         10 | `0..9`       |
|                 1 | `2 to x`    |         11 | `0..10`      |
|                 9 | `3 to x`    |         12 | `0..11`      |

The outer `0, 1, 9` indexes are intentionally not dense: this is a truncated extract of a larger
book, not evidence that the third entry should be changed to index `2`. The outer book and all three
child books select index `0`. All observed book and leaf versions are `562949958205441`.

Each leaf entry contains a normal blueprint. For example, the first `1 to x` entry is structurally:

```json
{
  "index": 0,
  "blueprint": {
    "item": "blueprint",
    "label": "1-1 TU lane balancer",
    "description": "...",
    "icons": ["..."],
    "entities": ["..."],
    "version": 562949958205441
  }
}
```

The strings above abbreviate arrays only for exposition; generated JSON must contain the actual
objects. The fixture's leaves have entities but no tiles or snapping fields. That is a property of
these blueprints, not a restriction imposed by books.

## Generating books in `rail-blueprint.ts`

The script already has the two I/O operations a book generator needs:

- `readBlueprint()` reads the complete JSON wrapper as a `BlueprintDocument`.
- `encodeBlueprintDocument()` serializes, zlib-compresses, base64-encodes, and prefixes any complete
  document, including a book.

Its `unwrap()` helper deliberately rejects books because the existing inspection and rail-layout
commands operate on one blueprint. A book command should recurse or construct a book; it should not
use `unwrap()` on the result.

First make the model in `src/bp/decode.ts` recursive. Its current `BlueprintBookEntry` permits only
`{ index, blueprint }`, so it does not describe this fixture even though `decodeDocument()` retains
the runtime JSON. A suitable model is the union shown above. A named recursive union avoids trying
to treat a nested book as a blueprint.

Then add small constructors to `scripts/rail-blueprint.ts`. For example:

```ts
type BookChild =
  { index: number; blueprint: Blueprint } | { index: number; blueprint_book: BlueprintBook };

function makeBook(label: string, children: BookChild[], version: number): BlueprintBook {
  const indexes = new Set<number>();
  for (const child of children) {
    if (!Number.isInteger(child.index) || child.index < 0) {
      throw new Error(`invalid book index ${child.index}`);
    }
    if (indexes.has(child.index)) throw new Error(`duplicate book index ${child.index}`);
    indexes.add(child.index);
  }
  return {
    item: "blueprint-book",
    label,
    blueprints: children,
    active_index: children[0]?.index ?? 0,
    version,
  };
}

function blueprintEntry(index: number, document: BlueprintDocument): BookChild {
  if (!("blueprint" in document)) throw new Error("expected a blueprint leaf");
  return { index, blueprint: structuredClone(document.blueprint) };
}

function bookEntry(index: number, book: BlueprintBook): BookChild {
  return { index, blueprint_book: structuredClone(book) };
}
```

A balancer-like hierarchy can then be assembled bottom-up:

```ts
const oneToX = makeBook(
  "1 to x",
  oneToXDocuments.map((document, index) => blueprintEntry(index, document)),
  version,
);
const twoToX = makeBook(
  "2 to x",
  twoToXDocuments.map((document, index) => blueprintEntry(index, document)),
  version,
);
const threeToX = makeBook(
  "3 to x",
  threeToXDocuments.map((document, index) => blueprintEntry(index, document)),
  version,
);

const document: BlueprintDocument = {
  blueprint_book: makeBook(
    "generated balancers",
    [bookEntry(0, oneToX), bookEntry(1, twoToX), bookEntry(9, threeToX)],
    version,
  ),
};
```

The arrays `oneToXDocuments`, `twoToXDocuments`, and `threeToXDocuments` can come from generated
rail blueprints already in memory or from `Promise.all(paths.map(readBlueprint))`. Clone inserted
bodies if later generation stages may mutate their source documents. Choose child indexes from the
intended book layout; use dense `0..n-1` indexes for a new compact book, or preserve source indexes
when reproducing or truncating an existing one.

A CLI command can write both forms exactly as the existing `stack` command does:

```ts
await writeFile(jsonPath, `${JSON.stringify(document, null, 2)}\n`);
await writeFile(base64Path, `${encodeBlueprintDocument(document)}\n`);
```

Keeping JSON as a generated artifact is valuable: it makes structural review and diffs possible,
while the `.base64` file is the compact form convenient for sharing and importing in the game UI.

## Validation

Before writing a generated book, recursively check:

1. Every body has the matching `item` value and a compatible `version`.
2. Every entry has exactly one child key and a unique, non-negative integer `index` within its
   parent.
3. Every non-empty book's `active_index` names an existing child. Decide explicitly how an empty
   book should be handled rather than assuming Factorio accepts it.
4. Every leaf independently satisfies the modern blueprint rules. In particular, entity numbers are
   local to that leaf, and all `wires`, schedules, neighbours, and circuit connections refer to
   entities in the same leaf. See `RAIL.md` for rail-specific geometry checks.
5. Encoding and decoding is lossless:

```ts
expect(decodeDocument(encodeBlueprintDocument(document))).toEqual(document);
```

For an integration check, import the generated JSON or exchange string into Factorio 2.x and verify
the nesting, labels, icons, selected entries, and placement of representative leaves. A successful
decode proves the transport format round-trips; it does not prove that every prototype exists or
that every rail layout is connected in the game.
