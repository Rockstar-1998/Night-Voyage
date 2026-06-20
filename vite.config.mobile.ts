import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { renameSync, existsSync } from 'fs';
import type { Plugin } from 'vite';

const renameMobileHtmlPlugin: Plugin = {
    name: 'rename-mobile-html',
    async closeBundle() {
        const distDir = resolve(__dirname, 'dist');
        const oldPath = resolve(distDir, 'index-mobile.html');
        const newPath = resolve(distDir, 'index.html');
        if (existsSync(oldPath)) {
            renameSync(oldPath, newPath);
        }
    },
};

export default defineConfig({
    plugins: [renameMobileHtmlPlugin, tailwindcss(), solidPlugin()],
    root: resolve(__dirname),
    server: {
        port: 1421,
        strictPort: true,
        host: '0.0.0.0',
        watch: {
            ignored: ['**/src-tauri/**', '**/.cache/**', '**/src/**']
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
            input: resolve(__dirname, 'index-mobile.html'),
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
