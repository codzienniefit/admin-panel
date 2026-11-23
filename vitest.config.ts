import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests cover pure logic, the mock API, the HTTP client against fake answers
// and the Worker's handlers called directly; they need neither the
// Cloudflare plugin nor a DOM, and none of them makes a network request.
export default defineConfig({
	resolve: {
		alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts", "worker/**/*.test.ts"],
	},
});
