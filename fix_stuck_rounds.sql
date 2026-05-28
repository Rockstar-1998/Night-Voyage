-- 修复卡住的 round（状态为 streaming 或 queued 但没有活跃流的 round）
-- 先查看有哪些 round 卡住了
SELECT id, conversation_id, round_index, status, updated_at 
FROM message_rounds 
WHERE status IN ('streaming', 'queued')
ORDER BY conversation_id, round_index;

-- 如果需要，将卡住的 round 标记为 failed（谨慎执行！）
-- UPDATE message_rounds 
-- SET status = 'failed', updated_at = strftime('%s', 'now') * 1000
-- WHERE status IN ('streaming', 'queued');
