import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		// Must come before react().
		tanstackRouter({ target: "react", autoCodeSplitting: true }),
		react(),
		babel({ presets: [reactCompilerPreset()] }),
		tailwindcss(),
		cloudflare(),
	],
	// Pre-bundled up front. Otherwise the dev server discovers each one the
	// first time a screen uses it, re-bundles and reloads mid-session.
	optimizeDeps: {
		include: [
			"@base-ui/react/combobox",
			"@base-ui/react/dialog",
			"@base-ui/react/menu",
			"@base-ui/react/switch",
		],
	},
	resolve: {
		alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
	},
});
