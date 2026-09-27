// Vite recognizes these relative asset and worker URLs and serves the WASM
// separately from the JavaScript application bundle.
const workerURL = new URL("./worker.js", import.meta.url);
const wasmURL = new URL("./tala.wasm", import.meta.url);

export class TALA {
  constructor() {
    this.worker = new Worker(workerURL, { type: "module" });
    this.pending = new Map();
    this.nextId = 0;
    this.disposed = false;
    this.worker.onmessage = ({ data }) => {
      if (data.type === "ready") {
        this.resolveReady();
        return;
      }
      if (data.type === "fatal") {
        const error = new Error(data.error);
        this.rejectReady(error);
        for (const request of this.pending.values()) request.reject(error);
        this.pending.clear();
        return;
      }
      const request = this.pending.get(data.id);
      if (!request) return;
      this.pending.delete(data.id);
      if (data.error) request.reject(new Error(data.error));
      else request.resolve(data.result);
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || "TALA worker failed");
      this.rejectReady(error);
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
    };
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    fetch(wasmURL).then((response) => {
      if (!response.ok) throw new Error(`WASM fetch failed: ${response.status}`);
      return response.arrayBuffer();
    }).then((wasm) => {
      if (!this.disposed) this.worker.postMessage({ type: "init", wasm }, [wasm]);
    }).catch(this.rejectReady);
  }

  async request(type, payload) {
    if (this.disposed) throw new Error("TALA instance has been disposed");
    await this.ready;
    if (this.disposed) throw new Error("TALA instance has been disposed");
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, payload });
    });
  }

  layout(graph) { return this.request("layout", graph); }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const error = new Error("TALA instance has been disposed");
    this.rejectReady(error);
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
    this.worker.terminate();
  }
}
