const fs = require('node:fs');
const path = require('node:path');

function createInspectLogsTool(config) {
  return {
    name: 'nv_inspect_logs',
    description:
      'Inspect and analyze Night Voyage runtime logs (LLM request/response payloads, agent debug logs, chat logs).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'list',
            'read_latest_llm_request',
            'read_latest_llm_response',
            'read_file',
            'search',
          ],
          description: 'Log inspection action',
          default: 'list',
        },
        logType: {
          type: 'string',
          enum: ['llm', 'agent', 'chat', 'all'],
          description: 'Type of log directory to target (default: "llm")',
          default: 'llm',
        },
        fileName: {
          type: 'string',
          description: 'Specific file name to read (when action="read_file")',
        },
        searchQuery: {
          type: 'string',
          description: 'Keyword or regex to search across log files',
        },
        limit: {
          type: 'number',
          description: 'Max number of items to return',
          default: 5,
        },
      },
    },
    async execute(args = {}) {
      const action = args.action || 'list';
      const logType = args.logType || 'llm';
      const limit = Math.min(Math.max(args.limit || 5, 1), 50);

      const dirs = [];
      if (logType === 'llm' || logType === 'all') dirs.push({ type: 'llm', path: config.llmLogsDir });
      if (logType === 'agent' || logType === 'all') dirs.push({ type: 'agent', path: config.agentLogsDir });
      if (logType === 'chat' || logType === 'all') dirs.push({ type: 'chat', path: config.chatLogsDir });

      function getSortedFiles(dirPath, filterPrefix = '') {
        if (!fs.existsSync(dirPath)) return [];
        return fs
          .readdirSync(dirPath)
          .filter((f) => !filterPrefix || f.startsWith(filterPrefix))
          .map((f) => {
            const fullPath = path.join(dirPath, f);
            try {
              const stat = fs.statSync(fullPath);
              return { name: f, fullPath, size: stat.size, mtime: stat.mtime };
            } catch {
              return null;
            }
          })
          .filter(Boolean)
          .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
      }

      if (action === 'list') {
        const result = {};
        for (const d of dirs) {
          const files = getSortedFiles(d.path).slice(0, limit);
          result[d.type] = {
            dir: d.path,
            exists: fs.existsSync(d.path),
            count: files.length,
            recentFiles: files.map((f) => ({
              name: f.name,
              size: f.size,
              updatedAt: f.mtime.toISOString(),
            })),
          };
        }
        return { success: true, logDirectories: result };
      }

      if (action === 'read_latest_llm_request') {
        const files = getSortedFiles(config.llmLogsDir, 'llm_req_');
        if (files.length === 0) {
          return { success: false, error: 'No llm_req_* files found in llm_debug_logs' };
        }
        const latest = files[0];
        try {
          const content = fs.readFileSync(latest.fullPath, 'utf-8');
          let parsed;
          try {
            parsed = JSON.parse(content);
          } catch {
            parsed = content;
          }
          return {
            success: true,
            fileName: latest.name,
            size: latest.size,
            updatedAt: latest.mtime.toISOString(),
            payload: parsed,
          };
        } catch (err) {
          return { success: false, error: String(err) };
        }
      }

      if (action === 'read_latest_llm_response') {
        const files = getSortedFiles(config.llmLogsDir, 'llm_resp_');
        if (files.length === 0) {
          return { success: false, error: 'No llm_resp_* files found in llm_debug_logs' };
        }
        const latest = files[0];
        try {
          const content = fs.readFileSync(latest.fullPath, 'utf-8');
          let parsed;
          try {
            parsed = JSON.parse(content);
          } catch {
            parsed = content;
          }
          return {
            success: true,
            fileName: latest.name,
            size: latest.size,
            updatedAt: latest.mtime.toISOString(),
            payload: parsed,
          };
        } catch (err) {
          return { success: false, error: String(err) };
        }
      }

      if (action === 'read_file') {
        if (!args.fileName) {
          return { success: false, error: 'fileName argument is required' };
        }
        for (const d of dirs) {
          const candidate = path.join(d.path, args.fileName);
          if (fs.existsSync(candidate)) {
            try {
              const content = fs.readFileSync(candidate, 'utf-8');
              let parsed;
              try {
                parsed = JSON.parse(content);
              } catch {
                parsed = content;
              }
              return { success: true, fileName: args.fileName, dir: d.path, content: parsed };
            } catch (err) {
              return { success: false, error: String(err) };
            }
          }
        }
        return { success: false, error: `File not found in inspected dirs: ${args.fileName}` };
      }

      if (action === 'search') {
        const query = (args.searchQuery || '').trim();
        if (!query) {
          return { success: false, error: 'searchQuery argument is required' };
        }
        const matches = [];
        for (const d of dirs) {
          const files = getSortedFiles(d.path).slice(0, 30);
          for (const file of files) {
            try {
              const text = fs.readFileSync(file.fullPath, 'utf-8');
              if (text.includes(query)) {
                matches.push({
                  dirType: d.type,
                  fileName: file.name,
                  size: file.size,
                  updatedAt: file.mtime.toISOString(),
                });
                if (matches.length >= limit) break;
              }
            } catch {
              // ignore read errors
            }
          }
          if (matches.length >= limit) break;
        }
        return { success: true, query, totalMatches: matches.length, matches };
      }

      return { success: false, error: `Unknown action: ${action}` };
    },
  };
}

module.exports = { createInspectLogsTool };
