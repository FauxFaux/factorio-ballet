import "./wasm_exec.js";

let api;

self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try {
      // The imported Go runtime must match the compiler that produced tala.wasm.
      const go = new Go();
      const { instance } = await WebAssembly.instantiate(data.wasm, go.importObject);
      self.onWasmInitialized = () => {
        api = self.d2Tala;
        self.postMessage({ type: "ready" });
      };
      go.run(instance).catch((error) => {
        self.postMessage({ type: "fatal", error: error.message });
      });
    } catch (error) {
      self.postMessage({ type: "fatal", error: error.message });
    }
    return;
  }
  try {
    if (data.type !== "layout") throw new Error(`Unknown request: ${data.type}`);
    const response = JSON.parse(api.layout(JSON.stringify(data.payload)));
    self.postMessage({ id: data.id, result: response.data, error: response.error?.message });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};
