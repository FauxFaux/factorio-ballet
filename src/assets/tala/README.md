# TALA graph layout in the browser

From the D2 repository root, run:

```sh
./d2js/tala/build.sh
```

The script requires the Go toolchain specified by `go.mod`. It writes a local
package to `d2js/tala/dist` by default. Pass an absolute output directory as
the first argument to put the package elsewhere. The package contains an ES
module, a worker, Go's matching `wasm_exec.js`, and a separate `tala.wasm` asset.
Vite serves the WASM as a file rather than embedding it in application JavaScript.

Install the output directory as a local package in a Vite application, then:

```js
import { TALA } from "@d2lang/tala-wasm";

const tala = new TALA();
await tala.ready;

const result = await tala.layout({
  direction: "right",
  nodes: [
    { id: "a", width: 100, height: 60 },
    { id: "b", width: 100, height: 60 },
  ],
  edges: [{ id: "ab", source: "a", target: "b", targetArrow: true }],
});

// result.nodes: [{ id, x, y, width, height, labelPosition? }, ...]
// result.edges: [{ id, points: [{ x, y }, ...], labelPosition?, labelPercentage? }, ...]
await tala.dispose();
```

`layout` accepts unique node IDs, explicit node sizes, optional parent IDs for
containers, and edges referring to node IDs. A node may also provide a D2 shape
name. Node and edge labels can be supplied as `{ text, width, height }`; the
caller measures those dimensions. A missing label means no label. The optional
`direction` is `up`, `down`, `left`, or `right`. Optional `seeds` selects TALA's
deterministic layout attempts; omitting it uses TALA defaults.

The result contains final node boxes and edge route points. Container boxes may
grow during layout. Label placement fields are returned when TALA sets them.
Input node IDs cannot contain dots because D2 uses dots to identify nested
objects. Input array order determines stable object and edge ordering; each edge
must also have a unique ID. Calls run in a worker, keeping layout computation
off the UI thread.

This entry point does not import D2's compiler, layout orchestration, exporter,
or SVG renderer. It uses TALA's public `Layout` method, which validates and
translates a D2 graph, tries its configured seeds, and applies the selected
result. The bridge constructs D2's required in-memory graph links from the
JSON request. There is no D2 source parsing or SVG output.

**Size caveat:** TALA's public adapter uses `d2graph`, and `d2graph` imports
`d2fonts`. The current WASM font package embeds fonts during initialization.
This bridge does not measure text, but fully removing font data from the WASM
requires separating that dependency in D2 or exposing a direct TALA graph API.
