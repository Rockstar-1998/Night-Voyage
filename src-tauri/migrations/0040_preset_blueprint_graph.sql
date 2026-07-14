-- 蓝图编辑器：preset 表新增 blueprint_graph 列，存储蓝图 JSON 字符串
-- blueprint_graph 为完整 BlueprintGraph 序列化 JSON（version=2），由图执行器运行时反序列化
-- 迁移期保留旧字段（blocks / structured_output_schema / semantic_groups 等），旧字段删除在 Task 12
ALTER TABLE presets ADD COLUMN blueprint_graph TEXT;
