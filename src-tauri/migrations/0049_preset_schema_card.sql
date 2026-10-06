-- 0049_preset_schema_card.sql
-- M5 产物通道：Schema 资产的 card 扩展（spec §2.4）。
-- card_json 为 NULL 表示该 Schema 不配置产物卡（向后兼容既有资产行）。

ALTER TABLE preset_schemas ADD COLUMN card_json TEXT;
