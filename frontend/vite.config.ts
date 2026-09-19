import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Sandboxed previews reach the dev server through a tunnel host; Vite 7 blocks unknown
// hosts unless they are allow-listed. `VITE_ALLOWED_HOSTS=true` allows all.
const allowedHostsEnv = process.env.VITE_ALLOWED_HOSTS;
const allowedHosts: true | string[] | undefined =
  allowedHostsEnv === "true"
    ? true
    : allowedHostsEnv
      ? allowedHostsEnv.split(",").map((h) => h.trim())
      : undefined;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          flow: ["@xyflow/react"],
          motion: ["framer-motion"],
          ui: ["@radix-ui/react-dialog", "@radix-ui/react-tooltip", "sonner", "lucide-react"],
        },
      },
    },
  },
  server: {
    port: 5173,
    allowedHosts,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});