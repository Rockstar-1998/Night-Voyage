const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

function createInspectDbTool(config) {
  return {
    name: 'nv_inspect_db',
    description:
      'Inspect Night Voyage SQLite database (tables, schemas, session states, migrations, and gate selections).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'summary',
            'tables',
            'session_states',
            'preset_schemas',
            'conversations',
            'gate_selections',
            'migrations',
            'query',
          ],
          description: 'The inspection action to perform',
          default: 'summary',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of rows to return (default: 10)',
          default: 10,
        },
        customSql: {
          type: 'string',
          description: 'Read-only custom SQL query when action="query"',
        },
      },
    },
    async execute(args = {}) {
      const action = args.action || 'summary';
      const limit = Math.min(Math.max(args.limit || 10, 1), 100);

      if (!fs.existsSync(config.sqliteDbPath)) {
        return {
          success: false,
          error: `Database file not found at: ${config.sqliteDbPath}`,
          dbPath: config.sqliteDbPath,
        };
      }

      let db;
      try {
        db = new DatabaseSync(config.sqliteDbPath, { open: true, readOnly: true });

        if (action === 'tables') {
          const tables = db
            .prepare(
              "SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name"
            )
            .all();
          return {
            success: true,
            totalTables: tables.length,
            tables: tables.map((t) => ({ name: t.name })),
          };
        }

        if (action === 'migrations') {
          const migrations = db
            .prepare(
              'SELECT version, description, success, installed_on FROM _sqlx_migrations ORDER BY version DESC LIMIT ?'
            )
            .all(limit);
          return { success: true, count: migrations.length, migrations };
        }

        if (action === 'preset_schemas') {
          const hasTable = db
            .prepare(
              "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='preset_schemas'"
            )
            .get();
          if (!hasTable || hasTable.count === 0) {
            return {
              success: false,
              error: 'Table preset_schemas does not exist in the database',
            };
          }
          const schemas = db
            .prepare(
              'SELECT id, preset_id, schema_id, name, description, retention_depth, fields_json, created_at, updated_at FROM preset_schemas ORDER BY id DESC LIMIT ?'
            )
            .all(limit);
          const parsed = schemas.map((s) => {
            let fields = [];
            try {
              fields = JSON.parse(s.fields_json || '[]');
            } catch {
              fields = s.fields_json;
            }
            return {
              id: s.id,
              preset_id: s.preset_id,
              schema_id: s.schema_id,
              name: s.name,
              description: s.description,
              retention_depth: s.retention_depth,
              fields,
              created_at: s.created_at,
            };
          });
          return { success: true, count: parsed.length, schemas: parsed };
        }

        if (action === 'session_states') {
          const hasTable = db
            .prepare(
              "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='session_states'"
            )
            .get();
          if (!hasTable || hasTable.count === 0) {
            return {
              success: false,
              error: 'Table session_states does not exist in the database',
            };
          }
          const states = db
            .prepare(
              'SELECT session_id, state_json, updated_at FROM session_states ORDER BY session_id DESC LIMIT ?'
            )
            .all(limit);
          const parsed = states.map((s) => {
            let dataContainer = null;
            try {
              dataContainer = JSON.parse(s.state_json || '{}');
            } catch {
              dataContainer = s.state_json;
            }
            return {
              session_id: s.session_id,
              updated_at: s.updated_at,
              dataContainer,
            };
          });
          return { success: true, count: parsed.length, session_states: parsed };
        }

        if (action === 'conversations') {
          const convs = db
            .prepare(
              'SELECT id, title, chat_mode, memory_mode, preset_id, created_at, updated_at FROM conversations ORDER BY id DESC LIMIT ?'
            )
            .all(limit);
          return { success: true, count: convs.length, conversations: convs };
        }

        if (action === 'gate_selections') {
          const hasTable = db
            .prepare(
              "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='preset_gate_selections'"
            )
            .get();
          if (!hasTable || hasTable.count === 0) {
            return {
              success: false,
              error: 'Table preset_gate_selections does not exist',
            };
          }
          const selections = db
            .prepare(
              'SELECT id, preset_id, node_id, selected_keys, updated_at FROM preset_gate_selections ORDER BY id DESC LIMIT ?'
            )
            .all(limit);
          const parsed = selections.map((s) => {
            let selectedKeys = [];
            try {
              selectedKeys = JSON.parse(s.selected_keys || '[]');
            } catch {
              selectedKeys = s.selected_keys;
            }
            return {
              id: s.id,
              preset_id: s.preset_id,
              node_id: s.node_id,
              selected_keys: selectedKeys,
              updated_at: s.updated_at,
            };
          });
          return { success: true, count: parsed.length, selections: parsed };
        }

        if (action === 'query') {
          if (!args.customSql) {
            return { success: false, error: 'customSql parameter is required' };
          }
          const sqlTrimmed = args.customSql.trim();
          if (!sqlTrimmed.toLowerCase().startsWith('select')) {
            return {
              success: false,
              error: 'Only SELECT statements are permitted for read-only inspection',
            };
          }
          const rows = db.prepare(sqlTrimmed).all();
          return { success: true, rowCount: rows.length, rows: rows.slice(0, limit) };
        }

        // Summary action: audit presence and health of new architecture tables
        const allTables = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
          )
          .all()
          .map((r) => r.name);

        const hasPresetSchemas = allTables.includes('preset_schemas');
        const hasSessionStates = allTables.includes('session_states');
        const hasGateSelections = allTables.includes('preset_gate_selections');
        const hasConversations = allTables.includes('conversations');

        let schemasCount = 0;
        let sessionStatesCount = 0;
        let conversationsCount = 0;
        let latestMigration = null;

        if (hasPresetSchemas) {
          schemasCount = db.prepare('SELECT count(*) as c FROM preset_schemas').get().c;
        }
        if (hasSessionStates) {
          sessionStatesCount = db.prepare('SELECT count(*) as c FROM session_states').get().c;
        }
        if (hasConversations) {
          conversationsCount = db.prepare('SELECT count(*) as c FROM conversations').get().c;
        }
        if (allTables.includes('_sqlx_migrations')) {
          latestMigration = db
            .prepare(
              'SELECT version, description, success FROM _sqlx_migrations ORDER BY version DESC LIMIT 1'
            )
            .get();
        }

        return {
          success: true,
          dbPath: config.sqliteDbPath,
          schemaAudit: {
            hasPresetSchemas,
            hasSessionStates,
            hasGateSelections,
            hasConversations,
            presetSchemasRows: schemasCount,
            sessionStatesRows: sessionStatesCount,
            conversationsRows: conversationsCount,
            latestMigration,
          },
          status:
            hasPresetSchemas && hasSessionStates && hasGateSelections
              ? 'HEALTHY_SCHEMA_ACTIVE'
              : 'TABLES_MISSING',
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        if (db) {
          try {
            db.close();
          } catch {
            // ignore close error
          }
        }
      }
    },
  };
}

module.exports = { createInspectDbTool };
