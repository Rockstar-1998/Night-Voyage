import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';
import { createSqliteIpcMiddleware } from './scripts/sqlite_ipc_middleware.mjs';

const startupProbePlugin = {
    name: 'night-voyage-startup-probe',
    configureServer(server: any) {
        server.middlewares.use(createSqliteIpcMiddleware());
        server.middlewares.use((req: any, res: any, next: any) => {
            const url = req.url ?? '';
            const isInterestingRequest =
                url === '/' ||
                url.startsWith('/src/index.css') ||
                url.startsWith('/src/index.tsx') ||
                url.startsWith('/src/App.tsx');

            if (!isInterestingRequest) {
                next();
                return;
            }

            const startAt = Date.now();
            res.on('finish', () => {
                console.log(
                    `[vite-probe] ${req.method ?? 'GET'} ${url} -> ${res.statusCode ?? 0} in ${Date.now() - startAt}ms`,
                );
            });
            next();
        });
    },
};

export default defineConfig({
    plugins: [startupProbePlugin, tailwindcss(), solidPlugin()],
    server: {
        port: 1420,
        strictPort: true,
        host: '0.0.0.0',
        watch: {
            ignored: [
                '**/src-tauri/**',
                '**/.cache/**',
                '**/target/**',
                '**/dist/**',
                '**/sillytavern/**',
                '**/ST2NV-Converter-Web/**',
                '**/aisandboxgame-master/**',
                '**/MEM0/**',
                '**/node_modules/**',
                '**/.git/**',
                '**/Walkthrough/**',
            ]
        }
    },
    clearScreen: false,
    envPrefix: ['VITE_', 'TAURI_ENV_*'],
    optimizeDeps: {
        include: ['solid-js', 'solid-js/web', 'solid-js/store'],
    },
    build: {
        target: process.env.TAURI_ENV_PLATFORM == 'windows' ? 'chrome105' : 'safari13',
        minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
        sourcemap: !!process.env.TAURI_ENV_DEBUG,
        reportCompressedSize: false,
        cssMinify: 'esbuild',
        rollupOptions: {
            maxParallelFileOps: 500,
            output: {
                manualChunks: {
                    'vendor-solid': ['solid-js'],
                    'vendor-tauri': ['@tauri-apps/api', '@tauri-apps/plugin-opener'],
                },
            },
        },
    }
});
