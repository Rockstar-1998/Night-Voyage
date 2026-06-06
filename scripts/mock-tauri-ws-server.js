#!/usr/bin/env node
/**
 * Mock Tauri WebSocket Server for Android Studio builds
 * 
 * This script mimics the WebSocket server that tauri CLI's `write_options` creates.
 * The android-studio-script command connects to this server to read CLI options.
 * 
 * Usage:
 *   node scripts/mock-tauri-ws-server.js [identifier] [port]
 * 
 * Example:
 *   node scripts/mock-tauri-ws-server.js com.nightvoyage.app 5056
 */

const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');

const identifier = process.argv[2] || 'com.nightvoyage.app';
const port = parseInt(process.argv[3] || '5056');

// CLI options that android-studio-script expects
const cliOptions = {
  dev: false,
  features: [],
  args: [],
  noise_level: 'polite', // or 'quiet'
  vars: {
    RUST_LOG_STYLE: 'always',
    CARGO_BUILD_JOBS: '1',
  },
  config: [],
  target_device: null
};

// Write server address to temp file (same format as Tauri CLI)
const tempDir = os.tmpdir();
const addrFile = path.join(tempDir, `${identifier}-server-addr`);
fs.writeFileSync(addrFile, `127.0.0.1:${port}`);
console.log(`[Mock WS] Wrote server address to: ${addrFile}`);

// Simple WebSocket server
const server = net.createServer((socket) => {
  console.log('[Mock WS] Client connected');

  let buffer = '';
  socket.on('data', (data) => {
    buffer += data.toString();
    
    // Check if we received a complete JSON-RPC request
    if (buffer.includes('"method":"options"')) {
      // Send JSON-RPC response with options
      const response = JSON.stringify({
        jsonrpc: '2.0',
        result: cliOptions,
        id: 1
      });
      
      // WebSocket text frame
      const frame = Buffer.allocUnsafe(2 + Buffer.byteLength(response));
      frame[0] = 0x81; // FIN=1, opcode=text
      frame[1] = Buffer.byteLength(response);
      Buffer.from(response).copy(frame, 2);
      
      socket.write(frame);
      console.log('[Mock WS] Sent CLI options');
      
      // Close connection after sending response
      setTimeout(() => socket.end(), 100);
    }
  });

  socket.on('end', () => {
    console.log('[Mock WS] Client disconnected');
  });

  socket.on('error', (err) => {
    console.error('[Mock WS] Socket error:', err.message);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[Mock WS] Server listening on 127.0.0.1:${port}`);
  console.log(`[Mock WS] Press Ctrl+C to stop`);
});

// Handle WebSocket handshake
server.on('connection', (socket) => {
  socket.once('data', (data) => {
    const str = data.toString();
    if (str.includes('Upgrade: websocket')) {
      const keyMatch = str.match(/Sec-WebSocket-Key: (.+)/);
      if (keyMatch) {
        const crypto = require('crypto');
        const key = keyMatch[1].trim();
        const accept = crypto.createHash('sha1')
          .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
          .digest('base64');
        
        const response = [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${accept}`,
          '',
          ''
        ].join('\r\n');
        
        socket.write(response);
      }
    }
  });
});

process.on('SIGINT', () => {
  console.log('\n[Mock WS] Shutting down...');
  try { fs.unlinkSync(addrFile); } catch {}
  server.close();
  process.exit(0);
});
