import { defineConfig } from "vite";
import path from "node:path";
import avenxPlugin from "../src/index.js";

export default defineConfig({
  plugins: [
    avenxPlugin({
      debug: true,
    }),
  ],

  resolve: {
    alias: {
      "avenx-core/core": path.resolve(
        __dirname,
        "../../lib/core/index.js"
      ),

      "avenx-core/runtime": path.resolve(
        __dirname,
        "../../lib/core/index.js"
      ),
    },
  },
});