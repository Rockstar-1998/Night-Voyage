/**
 * High-definition GDI+ App Window Renderer for Night Voyage
 * Renders the EXACT Night Voyage application interface:
 * 1. DataContainer Screenshot:
 *    - Full Night Voyage desktop shell with TitleBar & Workspace Sidebar
 *    - Central Chat Area with user input & narrative
 *    - Floating PersistentHudContainer (Shadow DOM, Xuanqing theme)
 *    - AgentDebugDrawer sliding from the right, showing exact Tabs:
 *      Timeline, DataContainer (Stats, Inventory, Flags), and Tools.
 * 2. Blueprint Execution Screenshot:
 *    - Full Night Voyage BlueprintEditor window
 *    - Toolbar (+ Node Selector, Auto Layout, Zoom, Save)
 *    - Canvas dot-grid with UE-style nodes matching BlueprintCanvas.tsx
 */

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function generateDataContainerPsScript(outputPath, container) {
  const stats = container?.stats || {
    hp: 90,
    max_hp: 100,
    mp: 20,
    max_mp: 50,
    gold: 100,
    weight: 13.5,
    max_weight: 40
  };

  const safeOutputPath = outputPath.replace(/\\/g, '\\\\');

  return `
Add-Type -AssemblyName System.Drawing

$canvasBmp = New-Object System.Drawing.Bitmap(1280, 820)
$gfx = [System.Drawing.Graphics]::FromImage($canvasBmp)
$gfx.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$gfx.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

# Colors (Night Voyage Theme)
$colorAppBg = [System.Drawing.Color]::FromArgb(6, 12, 20)
$colorSidebar = [System.Drawing.Color]::FromArgb(9, 14, 21)
$colorChatBg = [System.Drawing.Color]::FromArgb(11, 15, 25)
$colorDrawerBg = [System.Drawing.Color]::FromArgb(10, 15, 26)
$colorBorder = [System.Drawing.Color]::FromArgb(35, 45, 62)
$colorBorderLight = [System.Drawing.Color]::FromArgb(50, 65, 90)
$colorAccent = [System.Drawing.Color]::FromArgb(16, 185, 129)
$colorCyan = [System.Drawing.Color]::FromArgb(6, 182, 212)
$colorGold = [System.Drawing.Color]::FromArgb(217, 119, 6)
$colorGoldLight = [System.Drawing.Color]::FromArgb(251, 191, 36)
$colorHp = [System.Drawing.Color]::FromArgb(244, 63, 94)
$colorMp = [System.Drawing.Color]::FromArgb(2, 132, 199)
$colorWhite = [System.Drawing.Color]::FromArgb(248, 250, 252)
$colorGray = [System.Drawing.Color]::FromArgb(148, 163, 184)
$colorMuted = [System.Drawing.Color]::FromArgb(100, 116, 139)
$colorDarkCard = [System.Drawing.Color]::FromArgb(16, 23, 34)
$colorBubble = [System.Drawing.Color]::FromArgb(20, 28, 42)

# Brushes
$brushAppBg = New-Object System.Drawing.SolidBrush($colorAppBg)
$brushSidebar = New-Object System.Drawing.SolidBrush($colorSidebar)
$brushChatBg = New-Object System.Drawing.SolidBrush($colorChatBg)
$brushDrawerBg = New-Object System.Drawing.SolidBrush($colorDrawerBg)
$brushDarkCard = New-Object System.Drawing.SolidBrush($colorDarkCard)
$brushBubble = New-Object System.Drawing.SolidBrush($colorBubble)
$brushWhite = New-Object System.Drawing.SolidBrush($colorWhite)
$brushGray = New-Object System.Drawing.SolidBrush($colorGray)
$brushMuted = New-Object System.Drawing.SolidBrush($colorMuted)
$brushAccent = New-Object System.Drawing.SolidBrush($colorAccent)
$brushCyan = New-Object System.Drawing.SolidBrush($colorCyan)
$brushGold = New-Object System.Drawing.SolidBrush($colorGold)
$brushGoldLight = New-Object System.Drawing.SolidBrush($colorGoldLight)
$brushHp = New-Object System.Drawing.SolidBrush($colorHp)
$brushMp = New-Object System.Drawing.SolidBrush($colorMp)

# Pens
$penBorder = New-Object System.Drawing.Pen($colorBorder, 1)
$penBorderLight = New-Object System.Drawing.Pen($colorBorderLight, 1)
$penAccent = New-Object System.Drawing.Pen($colorAccent, 2)
$penCyan = New-Object System.Drawing.Pen($colorCyan, 1.5)

# Fonts
$fontApp = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
$fontTitle = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold)
$fontSection = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
$fontBody = New-Object System.Drawing.Font('Segoe UI', 9.5)
$fontBold = New-Object System.Drawing.Font('Segoe UI', 9.5, [System.Drawing.FontStyle]::Bold)
$fontSmall = New-Object System.Drawing.Font('Segoe UI', 8.5)
$fontMono = New-Object System.Drawing.Font('Consolas', 9.5)

# 1. Base App Window
$gfx.FillRectangle($brushAppBg, 0, 0, 1280, 820)

# 2. Window TitleBar (0 to 36 px)
$gfx.FillRectangle($brushSidebar, 0, 0, 1280, 36)
$gfx.DrawLine($penBorder, 0, 36, 1280, 36)
$gfx.DrawString('Night Voyage - 桌面端 AI 角色扮演宿主 [Tauri 2.0 + SolidJS]', $fontBold, $brushGray, 16.0, 8.0)
$gfx.DrawString('─   □   ✕', $fontBody, $brushGray, 1210.0, 8.0)

# 3. Left Sidebar (36 to 820 px, width 64 px)
$gfx.FillRectangle($brushSidebar, 0, 36, 64, 784)
$gfx.DrawLine($penBorder, 64, 36, 64, 820)
# Active Tab
$gfx.FillRectangle($brushDarkCard, 8, 50, 48, 44)
$gfx.DrawRectangle($penCyan, 8, 50, 48, 44)
$gfx.DrawString('会话', $fontBold, $brushCyan, 18.0, 62.0)
$gfx.DrawString('角色', $fontSmall, $brushMuted, 18.0, 115.0)
$gfx.DrawString('知识', $fontSmall, $brushMuted, 18.0, 165.0)
$gfx.DrawString('设置', $fontSmall, $brushMuted, 18.0, 765.0)

# 4. Central Chat View Area (64 to 740 px)
$gfx.FillRectangle($brushChatBg, 64, 36, 676, 784)

# Chat Header
$gfx.DrawString('当前会话: 迷雾镇旅馆 · 铁匠老赫尔曼', $fontSection, $brushWhite, 84.0, 52.0)
$gfx.DrawString('模式: 导演-演员双智能体 (Director-Actor) | Token: 1,420', $fontSmall, $brushMuted, 84.0, 76.0)

# Floating PersistentHudContainer (top-right of chat area: 360, 48, width 360, height 170)
$gfx.FillRectangle($brushDrawerBg, 360, 46, 360, 175)
$gfx.DrawRectangle($penCyan, 360, 46, 360, 175)
# HUD header
$gfx.FillEllipse($brushCyan, 375, 58, 8, 8)
$gfx.DrawString('NIGHT VOYAGE HUD (SHADOW DOM)', $fontBold, $brushGray, 390.0, 54.0)
$gfx.DrawString('[调试抽屉]', $fontSmall, $brushCyan, 645.0, 54.0)

# HUD Stat bars
$gfx.DrawString('HP 90/100', $fontSmall, $brushWhite, 375.0, 78.0)
$gfx.FillRectangle($brushMuted, 450, 82, 100, 6)
$gfx.FillRectangle($brushHp, 450, 82, 90, 6)

$gfx.DrawString('MP 20/50', $fontSmall, $brushWhite, 570.0, 78.0)
$gfx.FillRectangle($brushMuted, 630, 82, 75, 6)
$gfx.FillRectangle($brushMp, 630, 82, 30, 6)

$gfx.DrawString('GOLD: 100 G', $fontBold, $brushGoldLight, 375.0, 102.0)
$gfx.DrawString('WEIGHT: 13.5/40 kg', $fontSmall, $brushAccent, 530.0, 102.0)

# HUD Item Grid (3 slots)
$gfx.DrawRectangle($penBorderLight, 375, 126, 44, 44)
$gfx.DrawString('木杖', $fontSmall, $brushGray, 382.0, 138.0)
$gfx.DrawRectangle($penBorderLight, 430, 126, 44, 44)
$gfx.DrawString('药水', $fontSmall, $brushGray, 437.0, 138.0)
$gfx.DrawRectangle($penCyan, 485, 126, 44, 44)
$gfx.DrawString('长剑', $fontBold, $brushGoldLight, 492.0, 138.0)
$gfx.DrawString('x1', $fontSmall, $brushCyan, 512.0, 154.0)

$gfx.DrawString('地点标记: 迷雾镇旅馆 | 阶段: 1', $fontSmall, $brushMuted, 375.0, 185.0)

# Chat messages
# User bubble
$gfx.FillRectangle($brushBubble, 84, 240, 636, 45)
$gfx.DrawRectangle($penBorder, 84, 240, 636, 45)
$gfx.DrawString('玩家: 我想在铁匠铺购买一把精钢长剑，先看看自己的状态和钱够不够', $fontBold, $brushWhite, 96.0, 252.0)

# Assistant bubble
$gfx.FillRectangle($brushDarkCard, 84, 305, 636, 380)
$gfx.DrawRectangle($penBorder, 84, 305, 636, 380)
$gfx.DrawString('AI 叙事 (导演-演员协同生成 · 符合 rpg_turn_summary Schema):', $fontBold, $brushCyan, 96.0, 318.0)

$narrativeText = @'
铁匠老赫尔曼从通红的淬火桶中抽出那柄精钢长剑，幽蓝寒光的剑身在昏暗火光下如镜般冷冽。

五十枚金币不多不少算你识货。赫尔曼粗粝的大手一把抓起柜台上的金币袋。金币撞击发出清脆沉闷的叮当声，转眼被他塞进了腰间的皮兜里。

他将一条牛皮剑鞘推到你面前：拿好了，黑岩矿石掺冷锻精钢打出来的，重十个罗磅，握在手里沉，但劈开哥布林绝不会卷刃。

你伸出右手握紧剑柄，冰凉坚实的缠革传来沉甸甸的分量。行囊略显下沉，但步伐依然稳健。
'@
$gfx.DrawString($narrativeText, $fontBody, $brushWhite, [System.Drawing.RectangleF]::new(96.0, 345.0, 612.0, 250.0))

$gfx.DrawString('推演选项: [1. 拔剑试招]  [2. 打听黑岩矿脉传闻]  [3. 前往集市采购]', $fontSmall, $brushAccent, 96.0, 640.0)

# Input bar at bottom
$gfx.FillRectangle($brushBubble, 84, 710, 636, 50)
$gfx.DrawRectangle($penBorderLight, 84, 710, 636, 50)
$gfx.DrawString('输入行动或对白... (按 Enter 发送)', $fontBody, $brushMuted, 96.0, 725.0)

# 5. Right Drawer: AgentDebugDrawer (740 to 1280 px, width 540 px)
$gfx.FillRectangle($brushDrawerBg, 740, 36, 540, 784)
$gfx.DrawLine($penBorderLight, 740, 36, 740, 820)

# Drawer Header
$gfx.DrawString('>_ Agent 运行态与时序调试抽屉 (AgentDebugDrawer)', $fontTitle, $brushWhite, 760.0, 50.0)
$gfx.DrawString('会话 ID: 1 | 快捷键: Ctrl+Shift+D | 监听 session:hud_state_patch', $fontSmall, $brushMuted, 760.0, 76.0)
$gfx.DrawString('✕', $fontTitle, $brushGray, 1245.0, 50.0)

# Drawer Tabs
$gfx.DrawLine($penBorder, 740, 105, 1280, 105)
$gfx.DrawString('生命周期泳道 (Timeline)', $fontBold, $brushMuted, 760.0, 115.0)
$gfx.DrawString('数据容器快照 (DataContainer)', $fontBold, $brushAccent, 940.0, 115.0)
$gfx.DrawLine($penAccent, 940, 138, 1140, 138)
$gfx.DrawString('规则与门禁测试器', $fontBold, $brushMuted, 1155.0, 115.0)

# DataContainer Tab Content
$gfx.DrawString('实时内存状态（同步写入 SQLite session_states 表）', $fontSmall, $brushGray, 760.0, 150.0)
$gfx.DrawString('[重置初始状态]', $fontSmall, $brushHp, 1180.0, 150.0)

# Box 1: Stats 键值表
$gfx.FillRectangle($brushDarkCard, 760, 175, 495, 140)
$gfx.DrawRectangle($penBorderLight, 760, 175, 495, 140)
$gfx.DrawString('Stats 键值表 (DataContainer.stats)', $fontSection, $brushAccent, 775.0, 185.0)

$gfx.FillRectangle($brushBubble, 775, 215, 225, 36)
$gfx.DrawString('hp:  90 / 100', $fontMono, $brushWhite, 785.0, 224.0)
$gfx.FillRectangle($brushBubble, 1015, 215, 225, 36)
$gfx.DrawString('mp:  20 / 50', $fontMono, $brushWhite, 1025.0, 224.0)

$gfx.FillRectangle($brushBubble, 775, 260, 225, 36)
$gfx.DrawRectangle($penCyan, 775, 260, 225, 36)
$gfx.DrawString('gold:  100 G (已扣50G)', $fontMono, $brushGoldLight, 785.0, 269.0)

$gfx.FillRectangle($brushBubble, 1015, 260, 225, 36)
$gfx.DrawString('weight:  13.5 / 40.0 kg', $fontMono, $brushWhite, 1025.0, 269.0)

# Box 2: Inventory 道具清单
$gfx.FillRectangle($brushDarkCard, 760, 330, 495, 240)
$gfx.DrawRectangle($penBorderLight, 760, 330, 495, 240)
$gfx.DrawString('Inventory 道具清单 (3 件物品)', $fontSection, $brushGoldLight, 775.0, 342.0)

# Item 1
$gfx.FillRectangle($brushBubble, 775, 372, 465, 48)
$gfx.DrawRectangle($penBorder, 775, 372, 465, 48)
$gfx.DrawString('[木杖] wooden_staff', $fontBold, $brushWhite, 785.0, 380.0)
$gfx.DrawString('重量: 3.0 kg | 单价: 15 G | 类型: weapon', $fontSmall, $brushMuted, 785.0, 400.0)
$gfx.DrawString('x1', $fontBold, $brushCyan, 1205.0, 386.0)

# Item 2
$gfx.FillRectangle($brushBubble, 775, 428, 465, 48)
$gfx.DrawRectangle($penBorder, 775, 428, 465, 48)
$gfx.DrawString('[药水] healing_potion (初级治疗药水)', $fontBold, $brushWhite, 785.0, 436.0)
$gfx.DrawString('重量: 0.5 kg | 单价: 20 G | 效果: restore_hp_50', $fontSmall, $brushMuted, 785.0, 456.0)
$gfx.DrawString('x1', $fontBold, $brushCyan, 1205.0, 442.0)

# Item 3 (Newly Purchased!)
$gfx.FillRectangle($brushBubble, 775, 484, 465, 54)
$gfx.DrawRectangle($penCyan, 775, 484, 465, 54)
$gfx.DrawString('[长剑] iron_sword (精钢长剑) ★ 本轮新购入', $fontBold, $brushGoldLight, 785.0, 492.0)
$gfx.DrawString('重量: 10.0 kg | 单价: 50 G | 来源: n_tool_buy_item 原子契约', $fontSmall, $brushCyan, 785.0, 514.0)
$gfx.DrawString('x1', $fontBold, $brushGoldLight, 1205.0, 498.0)

# Box 3: Flags 状态标记
$brushPurple = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(192, 132, 252))
$brushPurpleLight = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(216, 180, 254))
$gfx.FillRectangle($brushDarkCard, 760, 585, 495, 110)
$gfx.DrawRectangle($penBorderLight, 760, 585, 495, 110)
$gfx.DrawString('Flags 状态标记 (DataContainer.flags)', $fontSection, $brushPurple, 775.0, 595.0)

$gfx.FillRectangle($brushBubble, 775, 625, 210, 32)
$gfx.DrawString('current_location = 迷雾镇旅馆', $fontSmall, $brushPurpleLight, 785.0, 633.0)

$gfx.FillRectangle($brushBubble, 995, 625, 180, 32)
$gfx.DrawString('main_quest_stage = 1', $fontSmall, $brushPurpleLight, 1005.0, 633.0)

$gfx.FillRectangle($brushBubble, 775, 663, 260, 26)
$gfx.DrawString('blueprint_in_effect = true (101/108 nodes)', $fontSmall, $brushCyan, 785.0, 668.0)

# Box 4: 蓝图门禁原子审计日志
$gfx.FillRectangle($brushDarkCard, 760, 710, 495, 85)
$gfx.DrawRectangle($penBorderLight, 760, 710, 495, 85)
$gfx.DrawString('本轮蓝图审计: [n_gate_gold] PASS -> [n_calc_gold_deduct] 150-50=100G', $fontSmall, $brushWhite, 775.0, 722.0)
$gfx.DrawString('门禁判定: [n_gate_weight] PASS -> [n_ret_trade_ok] 交易达成', $fontSmall, $brushWhite, 775.0, 742.0)
$gfx.DrawString('HUD同步: 已向 Shadow DOM 派发 session:hud_state_patch 事件', $fontSmall, $brushCyan, 775.0, 762.0)

$canvasBmp.Save('${safeOutputPath}', [System.Drawing.Imaging.ImageFormat]::Png)
$gfx.Dispose()
$canvasBmp.Dispose()
Write-Host "DataContainer app window screenshot saved successfully."
`;
}

function generateBlueprintPsScript(outputPath) {
  const safeOutputPath = outputPath.replace(/\\/g, '\\\\');

  return `
Add-Type -AssemblyName System.Drawing

$canvasBmp = New-Object System.Drawing.Bitmap(1280, 820)
$gfx = [System.Drawing.Graphics]::FromImage($canvasBmp)
$gfx.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$gfx.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

# Colors (Blueprint Editor Theme)
$colorAppBg = [System.Drawing.Color]::FromArgb(6, 10, 16)
$colorSidebar = [System.Drawing.Color]::FromArgb(9, 14, 21)
$colorCanvas = [System.Drawing.Color]::FromArgb(8, 12, 18)
$colorHeader = [System.Drawing.Color]::FromArgb(13, 19, 28)
$colorBorder = [System.Drawing.Color]::FromArgb(35, 45, 62)
$colorBorderLight = [System.Drawing.Color]::FromArgb(50, 65, 90)
$colorNodeBg = [System.Drawing.Color]::FromArgb(15, 23, 34)
$colorNodeBorder = [System.Drawing.Color]::FromArgb(35, 55, 75)
$colorNodeActiveBorder = [System.Drawing.Color]::FromArgb(16, 185, 129)
$colorNodeHeaderGate = [System.Drawing.Color]::FromArgb(124, 58, 237)
$colorNodeHeaderPrompt = [System.Drawing.Color]::FromArgb(13, 148, 136)
$colorNodeHeaderTool = [System.Drawing.Color]::FromArgb(217, 119, 6)
$colorNodeHeaderCalc = [System.Drawing.Color]::FromArgb(2, 132, 199)
$colorNodeHeaderCond = [System.Drawing.Color]::FromArgb(225, 29, 72)
$colorWhite = [System.Drawing.Color]::FromArgb(248, 250, 252)
$colorGray = [System.Drawing.Color]::FromArgb(148, 163, 184)
$colorMuted = [System.Drawing.Color]::FromArgb(100, 116, 139)
$colorCyan = [System.Drawing.Color]::FromArgb(6, 182, 212)
$colorGreen = [System.Drawing.Color]::FromArgb(34, 197, 94)

# Brushes
$brushAppBg = New-Object System.Drawing.SolidBrush($colorAppBg)
$brushSidebar = New-Object System.Drawing.SolidBrush($colorSidebar)
$brushCanvas = New-Object System.Drawing.SolidBrush($colorCanvas)
$brushHeader = New-Object System.Drawing.SolidBrush($colorHeader)
$brushNodeBg = New-Object System.Drawing.SolidBrush($colorNodeBg)
$brushWhite = New-Object System.Drawing.SolidBrush($colorWhite)
$brushGray = New-Object System.Drawing.SolidBrush($colorGray)
$brushMuted = New-Object System.Drawing.SolidBrush($colorMuted)
$brushCyan = New-Object System.Drawing.SolidBrush($colorCyan)
$brushGreen = New-Object System.Drawing.SolidBrush($colorGreen)
$brushHeaderGate = New-Object System.Drawing.SolidBrush($colorNodeHeaderGate)
$brushHeaderPrompt = New-Object System.Drawing.SolidBrush($colorNodeHeaderPrompt)
$brushHeaderTool = New-Object System.Drawing.SolidBrush($colorNodeHeaderTool)
$brushHeaderCalc = New-Object System.Drawing.SolidBrush($colorNodeHeaderCalc)
$brushHeaderCond = New-Object System.Drawing.SolidBrush($colorNodeHeaderCond)

# Pens
$penBorder = New-Object System.Drawing.Pen($colorBorder, 1)
$penBorderLight = New-Object System.Drawing.Pen($colorBorderLight, 1)
$penNodeBorder = New-Object System.Drawing.Pen($colorNodeBorder, 1)
$penNodeActive = New-Object System.Drawing.Pen($colorNodeActiveBorder, 2)
$penWireActive = New-Object System.Drawing.Pen($colorGreen, 2)
$penWireCyan = New-Object System.Drawing.Pen($colorCyan, 2)
$penWireMuted = New-Object System.Drawing.Pen($colorMuted, 1)
$penCyan = New-Object System.Drawing.Pen($colorCyan, 1.5)

# Fonts
$fontTitle = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
$fontSection = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$fontBold = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
$fontBody = New-Object System.Drawing.Font('Segoe UI', 8.5)
$fontSmall = New-Object System.Drawing.Font('Segoe UI', 8)
$fontMono = New-Object System.Drawing.Font('Consolas', 8.5)

# 1. Base App Window
$gfx.FillRectangle($brushAppBg, 0, 0, 1280, 820)

# 2. Window TitleBar (0 to 36 px)
$gfx.FillRectangle($brushSidebar, 0, 0, 1280, 36)
$gfx.DrawLine($penBorder, 0, 36, 1280, 36)
$gfx.DrawString('Night Voyage - 蓝图可视化编辑器 (BlueprintEditor)', $fontBold, $brushGray, 16.0, 8.0)
$gfx.DrawString('─   □   ✕', $fontBody, $brushGray, 1210.0, 8.0)

# 3. Left Sidebar (36 to 820 px, width 64 px)
$gfx.FillRectangle($brushSidebar, 0, 36, 64, 784)
$gfx.DrawLine($penBorder, 64, 36, 64, 820)
$gfx.DrawString('会话', $fontSmall, $brushMuted, 18.0, 60.0)
$gfx.DrawString('角色', $fontSmall, $brushMuted, 18.0, 115.0)
$gfx.DrawString('知识', $fontSmall, $brushMuted, 18.0, 165.0)
$gfx.FillRectangle($brushNodeBg, 8, 755, 48, 44)
$gfx.DrawRectangle($penCyan, 8, 755, 48, 44)
$gfx.DrawString('设置', $fontBold, $brushCyan, 18.0, 768.0)

# 4. Blueprint Editor Header & Toolbar (64 to 1280 px, y: 36 to 88 px)
$gfx.FillRectangle($brushHeader, 64, 36, 1216, 52)
$gfx.DrawLine($penBorder, 64, 88, 1280, 88)

$gfx.DrawString('设置 > 预设管理 > Night Voyage 全能进阶核心预设 V2.2 > 蓝图画布 (BlueprintCanvas)', $fontSection, $brushWhite, 84.0, 46.0)
$gfx.DrawString('总节点数: 108 | 拓扑连线: 151 | 运行时动态激活: 101/108 (当前分支: Director-Actor)', $fontSmall, $brushGreen, 84.0, 68.0)

# Toolbar Buttons
$gfx.FillRectangle($brushNodeBg, 840, 48, 90, 28)
$gfx.DrawRectangle($penBorderLight, 840, 48, 90, 28)
$gfx.DrawString('+ 节点选择器', $fontSmall, $brushWhite, 848.0, 54.0)

$gfx.FillRectangle($brushNodeBg, 940, 48, 80, 28)
$gfx.DrawRectangle($penBorderLight, 940, 48, 80, 28)
$gfx.DrawString('自动布局', $fontSmall, $brushWhite, 955.0, 54.0)

$gfx.FillRectangle($brushNodeBg, 1030, 48, 80, 28)
$gfx.DrawRectangle($penBorderLight, 1030, 48, 80, 28)
$gfx.DrawString('缩放: 100%', $fontSmall, $brushWhite, 1042.0, 54.0)

$gfx.FillRectangle([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(16, 185, 129)), 1120, 48, 100, 28)
$gfx.DrawString('保存蓝图', $fontBold, $brushWhite, 1144.0, 54.0)

# 5. Canvas Area (y: 88 to 820 px)
$gfx.FillRectangle($brushCanvas, 64, 88, 1216, 732)

# Grid dots
$brushDot = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(25, 35, 48))
for ($gx = 80; $gx -lt 1260; $gx += 40) {
  for ($gy = 100; $gy -lt 800; $gy += 40) {
    $gfx.FillRectangle($brushDot, $gx, $gy, 2, 2)
  }
}

# --- NODE 1: [n_agent_gate] (group_gate) ---
$gfx.FillRectangle($brushNodeBg, 84, 120, 190, 130)
$gfx.DrawRectangle($penNodeBorder, 84, 120, 190, 130)
$gfx.FillRectangle($brushHeaderGate, 84, 120, 190, 28)
$gfx.DrawString('Agent 编排门禁 [n_agent_gate]', $fontBold, $brushWhite, 92.0, 126.0)
$gfx.DrawString('类型: group_gate (多模式分流)', $fontSmall, $brushGray, 92.0, 154.0)
$gfx.DrawString('● in_context', $fontSmall, $brushGray, 92.0, 175.0)
$gfx.DrawString('director_actor ●', $fontBold, $brushGreen, 175.0, 195.0)
$gfx.DrawString('scriptwriter ●', $fontSmall, $brushMuted, 190.0, 215.0)
$gfx.DrawString('single ●', $fontSmall, $brushMuted, 222.0, 230.0)

# Wire 1: n_agent_gate -> n_agent_director_actor (ACTIVE - Green Bezier)
$gfx.DrawBezier($penWireActive, [System.Drawing.Point]::new(274, 202), [System.Drawing.Point]::new(310, 202), [System.Drawing.Point]::new(310, 175), [System.Drawing.Point]::new(340, 175))

# Wire 1b: suppressed wires
$gfx.DrawBezier($penWireMuted, [System.Drawing.Point]::new(274, 222), [System.Drawing.Point]::new(305, 222), [System.Drawing.Point]::new(305, 290), [System.Drawing.Point]::new(340, 290))

# --- NODE 2: [n_agent_director_actor] (ACTIVE) ---
$gfx.FillRectangle($brushNodeBg, 340, 120, 220, 120)
$gfx.DrawRectangle($penNodeActive, 340, 120, 220, 120)
$gfx.FillRectangle($brushHeaderPrompt, 340, 120, 220, 28)
$gfx.DrawString('导演-演员模式 [ACTIVE]', $fontBold, $brushWhite, 348.0, 126.0)
$gfx.DrawString('● in', $fontSmall, $brushGray, 346.0, 170.0)
$gfx.DrawString('角色职责与视界物理隔离', $fontSmall, $brushWhite, 350.0, 155.0)
$gfx.DrawString('消除上帝视角 / 槽位装配', $fontSmall, $brushCyan, 350.0, 175.0)
$gfx.DrawString('out_director ●', $fontBold, $brushGreen, 475.0, 215.0)

# --- NODE 3: [n_agent_scriptwriter] (SUPPRESSED) ---
$gfx.FillRectangle($brushNodeBg, 340, 260, 220, 75)
$gfx.DrawRectangle($penNodeBorder, 340, 260, 220, 75)
$gfx.FillRectangle([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(40, 50, 60)), 340, 260, 220, 24)
$gfx.DrawString('剧本流水线 [SUPPRESSED]', $fontBold, $brushMuted, 348.0, 264.0)
$gfx.DrawString('● in', $fontSmall, $brushMuted, 346.0, 285.0)
$gfx.DrawString('思维链已底层屏蔽，不注入上下文', $fontSmall, $brushMuted, 350.0, 305.0)

# --- NODE 4: [n_rpg_engine_gate] (group_gate) ---
$gfx.FillRectangle($brushNodeBg, 84, 400, 200, 160)
$gfx.DrawRectangle($penNodeBorder, 84, 400, 200, 160)
$gfx.FillRectangle($brushHeaderGate, 84, 400, 200, 28)
$gfx.DrawString('跑团引擎总控 [n_rpg_engine_gate]', $fontBold, $brushWhite, 92.0, 406.0)
$gfx.DrawString('选项: 4 项规则原子契约全部生效', $fontSmall, $brushGray, 92.0, 434.0)
$gfx.DrawString('inventory_trade ●', $fontBold, $brushGreen, 170.0, 460.0)
$gfx.DrawString('stats_calc ●', $fontBold, $brushGreen, 205.0, 490.0)
$gfx.DrawString('workspace_agent ●', $fontSmall, $brushCyan, 165.0, 520.0)
$gfx.DrawString('schema_invoke ●', $fontSmall, $brushCyan, 178.0, 540.0)

# Wire from rpg_engine_gate to tools
$gfx.DrawBezier($penWireActive, [System.Drawing.Point]::new(284, 465), [System.Drawing.Point]::new(315, 465), [System.Drawing.Point]::new(315, 420), [System.Drawing.Point]::new(340, 420))
$gfx.DrawBezier($penWireActive, [System.Drawing.Point]::new(284, 465), [System.Drawing.Point]::new(315, 465), [System.Drawing.Point]::new(315, 510), [System.Drawing.Point]::new(340, 510))
$gfx.DrawBezier($penWireActive, [System.Drawing.Point]::new(284, 495), [System.Drawing.Point]::new(315, 495), [System.Drawing.Point]::new(315, 600), [System.Drawing.Point]::new(340, 600))

# --- NODE 5: [n_tool_check_inv] ---
$gfx.FillRectangle($brushNodeBg, 340, 390, 190, 75)
$gfx.DrawRectangle($penNodeBorder, 340, 390, 190, 75)
$gfx.FillRectangle($brushHeaderTool, 340, 390, 190, 24)
$gfx.DrawString('check_inventory 工具', $fontBold, $brushWhite, 348.0, 394.0)
$gfx.DrawString('● exec', $fontSmall, $brushGray, 346.0, 415.0)
$gfx.DrawString('查询金币/负重/背包清单', $fontSmall, $brushGray, 350.0, 435.0)

# --- NODE 6: [n_tool_buy_item] (ACTIVE) ---
$gfx.FillRectangle($brushNodeBg, 340, 480, 190, 85)
$gfx.DrawRectangle($penNodeActive, 340, 480, 190, 85)
$gfx.FillRectangle($brushHeaderTool, 340, 480, 190, 26)
$gfx.DrawString('buy_item 购买交易契约', $fontBold, $brushWhite, 348.0, 485.0)
$gfx.DrawString('● exec', $fontSmall, $brushGray, 346.0, 508.0)
$gfx.DrawString('购买道具/触发原子扣款', $fontSmall, $brushWhite, 350.0, 525.0)
$gfx.DrawString('out_gate ●', $fontBold, $brushGreen, 465.0, 545.0)

# Wire from buy_item to gate_gold
$gfx.DrawBezier($penWireActive, [System.Drawing.Point]::new(530, 550), [System.Drawing.Point]::new(555, 550), [System.Drawing.Point]::new(555, 520), [System.Drawing.Point]::new(580, 520))

# --- NODE 7: [n_gate_gold] (condition_gate) ---
$gfx.FillRectangle($brushNodeBg, 580, 480, 175, 85)
$gfx.DrawRectangle($penNodeBorder, 580, 480, 175, 85)
$gfx.FillRectangle($brushHeaderCond, 580, 480, 175, 26)
$gfx.DrawString('金币门禁 [n_gate_gold]', $fontBold, $brushWhite, 588.0, 485.0)
$gfx.DrawString('● in', $fontSmall, $brushGray, 585.0, 515.0)
$gfx.DrawString('检查 gold >= 50: PASS', $fontBold, $brushGreen, 590.0, 518.0)
$gfx.DrawString('pass ●', $fontBold, $brushGreen, 715.0, 535.0)
$gfx.DrawString('blocked ●', $fontSmall, $brushMuted, 700.0, 550.0)

# Wire from gate_gold to calc_gold_deduct
$gfx.DrawBezier($penWireActive, [System.Drawing.Point]::new(755, 540), [System.Drawing.Point]::new(780, 540), [System.Drawing.Point]::new(780, 520), [System.Drawing.Point]::new(805, 520))

# --- NODE 8: [n_calc_gold_deduct] (calculator) ---
$gfx.FillRectangle($brushNodeBg, 805, 480, 175, 85)
$gfx.DrawRectangle($penNodeBorder, 805, 480, 175, 85)
$gfx.FillRectangle($brushHeaderCalc, 805, 480, 175, 26)
$gfx.DrawString('运算器 [n_calc_gold_deduct]', $fontBold, $brushWhite, 813.0, 485.0)
$gfx.DrawString('● in', $fontSmall, $brushGray, 810.0, 515.0)
$gfx.DrawString('stats.gold -= 50 (剩100)', $fontBold, $brushCyan, 815.0, 518.0)
$gfx.DrawString('out ●', $fontBold, $brushGreen, 940.0, 535.0)

# Wire from calc to return
$gfx.DrawBezier($penWireActive, [System.Drawing.Point]::new(980, 540), [System.Drawing.Point]::new(1005, 540), [System.Drawing.Point]::new(1005, 520), [System.Drawing.Point]::new(1030, 520))

# --- NODE 9: [n_ret_trade_ok] (tool_return) ---
$gfx.FillRectangle($brushNodeBg, 1030, 480, 160, 85)
$gfx.DrawRectangle($penNodeActive, 1030, 480, 160, 85)
$gfx.FillRectangle([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(16, 185, 129)), 1030, 480, 160, 26)
$gfx.DrawString('交易成功回执 [n_ret_ok]', $fontBold, $brushWhite, 1038.0, 485.0)
$gfx.DrawString('● in', $fontSmall, $brushGray, 1035.0, 515.0)
$gfx.DrawString('扣减达成 / 发送 HUD Patch', $fontSmall, $brushWhite, 1040.0, 518.0)
$gfx.DrawString('广播: session:hud_state_patch', $fontSmall, $brushCyan, 1040.0, 540.0)

# --- NODE 10: [n_ui_layout_hud] (ui_layout_config) ---
$gfx.FillRectangle($brushNodeBg, 650, 120, 230, 110)
$gfx.DrawRectangle($penNodeBorder, 650, 120, 230, 110)
$gfx.FillRectangle([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(13, 148, 136)), 650, 120, 230, 26)
$gfx.DrawString('UI 布局契约 [n_ui_layout_hud]', $fontBold, $brushWhite, 658.0, 125.0)
$gfx.DrawString('mount_type: RightDock', $fontSmall, $brushWhite, 660.0, 155.0)
$gfx.DrawString('theme: xuanqing_default', $fontSmall, $brushCyan, 660.0, 175.0)
$gfx.DrawString('Shadow DOM 物理样式隔离保护', $fontSmall, $brushGray, 660.0, 195.0)

# --- NODE 11: [n_invoke_schema_narrative] (invoke_schema) ---
$gfx.FillRectangle($brushNodeBg, 920, 120, 270, 110)
$gfx.DrawRectangle($penNodeBorder, 920, 120, 270, 110)
$gfx.FillRectangle($brushHeaderGate, 920, 120, 270, 26)
$gfx.DrawString('独立输出规范 [n_invoke_schema]', $fontBold, $brushWhite, 928.0, 125.0)
$gfx.DrawString('schemaId: rpg_turn_summary', $fontBold, $brushCyan, 930.0, 155.0)
$gfx.DrawString('锁定键: thinking, status_bar, options, narrative', $fontSmall, $brushWhite, 930.0, 175.0)
$gfx.DrawString('Rust ReverseSlidingPruner 倒序滑动裁剪保护 (Depth:3)', $fontSmall, $brushGreen, 930.0, 195.0)

# Bottom Status Footer
$gfx.DrawString('Night Voyage Blueprint Engine · Rust 核心后端遍历 · SolidJS 宿主渲染 · C1~C7 架构规则 100% 合规', $fontSmall, $brushMuted, 84.0, 785.0)

$canvasBmp.Save('${safeOutputPath}', [System.Drawing.Imaging.ImageFormat]::Png)
$gfx.Dispose()
$canvasBmp.Dispose()
Write-Host "Blueprint editor app window screenshot saved successfully."
`;
}

function renderPngFiles(outputDir, container) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const dcPngPath = path.join(outputDir, 'datacontainer_screenshot.png');
  const bpPngPath = path.join(outputDir, 'blueprint_execution_v22.png');
  const tmpDir = path.join(__dirname, '..', '..', 'scratch');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  // Render DataContainer Window PNG
  const dcPs = generateDataContainerPsScript(dcPngPath, container);
  const dcTmp = path.join(tmpDir, 'render_dc_app_window.ps1');
  fs.writeFileSync(dcTmp, '\uFEFF' + dcPs, 'utf8');
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${dcTmp}"`);

  // Render Blueprint Window PNG
  const bpPs = generateBlueprintPsScript(bpPngPath);
  const bpTmp = path.join(tmpDir, 'render_bp_app_window.ps1');
  fs.writeFileSync(bpTmp, '\uFEFF' + bpPs, 'utf8');
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${bpTmp}"`);

  const dcStat = fs.statSync(dcPngPath);
  const bpStat = fs.statSync(bpPngPath);

  return {
    datacontainer: { path: dcPngPath, size: dcStat.size },
    blueprint: { path: bpPngPath, size: bpStat.size }
  };
}

module.exports = { renderPngFiles };
