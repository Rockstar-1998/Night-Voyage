/* @refresh reload */
import { render } from 'solid-js/web';
import './index.css';
import { initBrowserBridge } from './lib/backend/browserBridge';
import App from './App';

initBrowserBridge();

const root = document.getElementById('root');

if ((import.meta as any).env?.DEV && !(root instanceof HTMLElement)) {
    throw new Error(
        'Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?',
    );
}

render(() => <App />, root!);
