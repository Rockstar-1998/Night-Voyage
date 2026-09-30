-- 0048_session_ui_layouts.sql
-- 会话级常驻 HUD 布局绑定。
--
-- 一个预设可以有多套 UI 布局（右侧仪表盘 / 顶部吸顶栏 / 浮动画中画…），
-- 但每个会话在运行期只能渲染一套。这里记录"这个会话当前用哪套"，
-- 使 `preset_ui_layout_for_conversation` 能给出确定答案，
-- 而不是靠"取最新一条"之类的隐式规则。

CREATE TABLE IF NOT EXISTS session_ui_layouts (
    session_id INTEGER PRIMARY KEY NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    layout_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_ui_layouts_layout_id
ON session_ui_layouts(layout_id);
