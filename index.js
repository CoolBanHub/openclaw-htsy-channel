import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { htsyOpenPlugin } from "./src/channel.js";

export default defineChannelPluginEntry({
  id: "htsy-open",
  name: "HTSY Open",
  description: "HTSY Open channel plugin",
  plugin: htsyOpenPlugin,
});
