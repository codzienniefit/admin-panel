import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests cover pure logic and the mock API; they need neither the Cloudflare
// plugin nor a DOM.
export default defineConfig({
	resolve: {
		alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
