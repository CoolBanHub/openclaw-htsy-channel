import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

const { setRuntime: setHtsyRuntime, getRuntime: getHtsyRuntime } =
  createPluginRuntimeStore("HTSY Open runtime not initialized");

export { setHtsyRuntime, getHtsyRuntime };
