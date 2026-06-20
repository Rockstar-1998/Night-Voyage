import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const platform = process.env.TAURI_ENV_PLATFORM;
const isAndroid = platform === 'android';

const viteBin = resolve(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');

if (isAndroid) {
    console.log('[build-frontend] Detected Android platform, using mobile config...');
    execSync(`node "${viteBin}" build --config vite.config.mobile.ts`, {
        stdio: 'inherit',
        cwd: resolve(__dirname, '..'),
    });
} else {
    console.log('[build-frontend] Using desktop config...');
    execSync(`node "${viteBin}" build`, {
        stdio: 'inherit',
        cwd: resolve(__dirname, '..'),
    });
}
