/**
 * High-definition GDI+ App Window Renderer for Night Voyage
 * Renders the EXACT Night Voyage application interface:
 * 1. cp2077_hud_screenshot.png:
 *    - Full Night Voyage desktop shell with TitleBar & NavigationRail
 *    - Middle Sessions column showing SESSIONS list (CP2077_TRPG, 蒸汽朋克幻想, 兽人人权剥夺法案)
 *    - Central Chat Area with CP2077_TRPG active session
 *    - Horizontal PersistentHudContainer across the top (mp 50/50, gold 100, weight 0/50, hp 100/100, 7 empty slots)
 *    - Exact dialogue from CP2077_TRPG and PLOT_SUMMARY card
 * 2. datacontainer_screenshot.png:
 *    - Same authentic CP2077_TRPG app window with AgentDebugDrawer opened (Ctrl+Shift+D / 时序调试)
 *    - Exact Tabs: Timeline, DataContainer (Stats 100/50/100/0, Inventory, Flags), Rules & Gates
 * 3. blueprint_execution_v22.png:
 *    - Full Night Voyage BlueprintEditor window with 108 nodes and 151 bezier edges
 */

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function generateCp2077HudPsScript(outputPath, container) {
  const stats = container?.stats || {
    hp: 100,
    max_hp: 100,
    mp: 50,
    max_mp: 50,
    gold: 100,
    weight: 0,
    max_weight: 50
  };

  const safeOutputPath = outputPath.replace(/\\/g, '\\\\');

  return `
Add-Type -AssemblyName System.Drawing

$canvasBmp = New-Object System.Drawing.Bitmap(1280, 820)
$gfx = [System.Drawing.Graphics]::FromImage($canvasBmp)
$gfx.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$gfx.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

# Colors (Authentic Night Voyage Cyber-Xuanqing Theme)
$colorAppBg = [System.Drawing.Color]::FromArgb(7, 11, 16)
$colorRail = [System.Drawing.Color]::FromArgb(9, 14, 21)
$colorSidebar = [System.Drawing.Color]::FromArgb(11, 16, 24)
$colorChatBg = [System.Drawing.Color]::FromArgb(8, 12, 18)
$colorBorder = [System.Drawing.Color]::FromArgb(30, 41, 59)
$colorBorderLight = [System.Drawing.Color]::FromArgb(51, 65, 85)
$colorAccent = [System.Drawing.Color]::FromArgb(16, 185, 129)
$colorCyan = [System.Drawing.Color]::FromArgb(6, 182, 212)
$colorCyanLight = [System.Drawing.Color]::FromArgb(56, 189, 248)
$colorCyanBg = [System.Drawing.Color]::FromArgb(8, 51, 68)
$colorCardActive = [System.Drawing.Color]::FromArgb(19, 29, 43)
$colorCardBorderActive = [System.Drawing.Color]::FromArgb(30, 58, 95)
$colorGold = [System.Drawing.Color]::FromArgb(245, 158, 11)
$colorGoldLight = [System.Drawing.Color]::FromArgb(251, 191, 36)
$colorHp = [System.Drawing.Color]::FromArgb(244, 63, 94)
$colorMp = [System.Drawing.Color]::FromArgb(14, 165, 233)
$colorWhite = [System.Drawing.Color]::FromArgb(248, 250, 252)
$colorSlate = [System.Drawing.Color]::FromArgb(226, 232, 240)
$colorGray = [System.Drawing.Color]::FromArgb(148, 163, 184)
$colorMuted = [System.Drawing.Color]::FromArgb(100, 116, 139)
$colorDarkCard = [System.Drawing.Color]::FromArgb(13, 21, 34)
$colorCapsuleBg = [System.Drawing.Color]::FromArgb(16, 25, 40)
$colorInputBg = [System.Drawing.Color]::FromArgb(13, 21, 34)

# Brushes
$brushAppBg = New-Object System.Drawing.SolidBrush($colorAppBg)
$brushRail = New-Object System.Drawing.SolidBrush($colorRail)
$brushSidebar = New-Object System.Drawing.SolidBrush($colorSidebar)
$brushChatBg = New-Object System.Drawing.SolidBrush($colorChatBg)
$brushDarkCard = New-Object System.Drawing.SolidBrush($colorDarkCard)
$brushCapsuleBg = New-Object System.Drawing.SolidBrush($colorCapsuleBg)
$brushCardActive = New-Object System.Drawing.SolidBrush($colorCardActive)
$brushCyanBg = New-Object System.Drawing.SolidBrush($colorCyanBg)
$brushInputBg = New-Object System.Drawing.SolidBrush($colorInputBg)
$brushWhite = New-Object System.Drawing.SolidBrush($colorWhite)
$brushSlate = New-Object System.Drawing.SolidBrush($colorSlate)
$brushGray = New-Object System.Drawing.SolidBrush($colorGray)
$brushMuted = New-Object System.Drawing.SolidBrush($colorMuted)
$brushAccent = New-Object System.Drawing.SolidBrush($colorAccent)
$brushCyan = New-Object System.Drawing.SolidBrush($colorCyan)
$brushCyanLight = New-Object System.Drawing.SolidBrush($colorCyanLight)
$brushGold = New-Object System.Drawing.SolidBrush($colorGold)
$brushGoldLight = New-Object System.Drawing.SolidBrush($colorGoldLight)
$brushHp = New-Object System.Drawing.SolidBrush($colorHp)
$brushMp = New-Object System.Drawing.SolidBrush($colorMp)

# Pens
$penBorder = New-Object System.Drawing.Pen($colorBorder, 1)
$penBorderLight = New-Object System.Drawing.Pen($colorBorderLight, 1)
$penCardActive = New-Object System.Drawing.Pen($colorCardBorderActive, 1.5)
$penGold = New-Object System.Drawing.Pen($colorGold, 1.5)
$penCyan = New-Object System.Drawing.Pen($colorCyan, 1.5)
$penDashed = New-Object System.Drawing.Pen($colorBorderLight, 1)
$penDashed.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash

# Fonts
$fontSessions = New-Object System.Drawing.Font('Segoe UI', 17, [System.Drawing.FontStyle]'Bold, Italic')
$fontTitle = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
$fontSection = New-Object System.Drawing.Font('Segoe UI', 10.5, [System.Drawing.FontStyle]::Bold)
$fontCardTitle = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$fontBody = New-Object System.Drawing.Font('Segoe UI', 9.5)
$fontBold = New-Object System.Drawing.Font('Segoe UI', 9.5, [System.Drawing.FontStyle]::Bold)
$fontSmall = New-Object System.Drawing.Font('Segoe UI', 8.5)
$fontMicro = New-Object System.Drawing.Font('Segoe UI', 7.5, [System.Drawing.FontStyle]::Bold)
$fontMono = New-Object System.Drawing.Font('Consolas', 9)

# 1. Base Window
$gfx.FillRectangle($brushAppBg, 0, 0, 1280, 820)

# 2. Window TitleBar (0 to 32 px)
$gfx.FillRectangle($brushRail, 0, 0, 1280, 32)
$gfx.DrawLine($penBorder, 0, 32, 1280, 32)
$gfx.DrawString('N I G H T   V O Y A G E', $fontMicro, $brushMuted, 16.0, 9.0)
$gfx.DrawString('─   □   ✕', $fontSmall, $brushGray, 1210.0, 8.0)

# 3. Column 1: Left NavigationRail (0 to 54 px, y: 32 to 820)
$gfx.FillRectangle($brushRail, 0, 32, 54, 788)
$gfx.DrawLine($penBorder, 54, 32, 54, 820)

# Navigation Icons
$gfx.DrawString('设置', $fontMicro, $brushMuted, 14.0, 52.0)

# Active Chat Icon (Cyan Rounded Button)
$gfx.FillRectangle($brushCyan, 9, 88, 36, 36)
$gfx.DrawString('会话', $fontMicro, $brushWhite, 14.0, 100.0)

$gfx.DrawString('联机', $fontMicro, $brushMuted, 14.0, 148.0)
$gfx.DrawString('预设', $fontMicro, $brushMuted, 14.0, 198.0)
$gfx.DrawString('设定', $fontMicro, $brushMuted, 14.0, 248.0)

# 4. Column 2: SessionSidebar (54 to 304 px, y: 32 to 820)
$gfx.FillRectangle($brushSidebar, 54, 32, 250, 788)
$gfx.DrawLine($penBorder, 304, 32, 304, 820)

# SESSIONS Title
$gfx.DrawString('SESSIONS', $fontSessions, $brushWhite, 68.0, 48.0)

# Search Bar
$gfx.FillRectangle($brushCapsuleBg, 68, 88, 222, 32)
$gfx.DrawRectangle($penBorder, 68, 88, 222, 32)
$gfx.DrawString('搜索航次...', $fontSmall, $brushMuted, 78.0, 96.0)

# Quick Action Bar
$gfx.DrawString('快速操作', $fontMicro, $brushMuted, 68.0, 132.0)
$gfx.DrawString('创建或加入会话', $fontSmall, $brushGray, 68.0, 148.0)

# Quick action buttons
$gfx.FillRectangle([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(30, 58, 95)), 205, 134, 38, 32)
$gfx.DrawRectangle($penCardActive, 205, 134, 38, 32)
$gfx.DrawString('+', $fontBold, $brushWhite, 218.0, 138.0)

$gfx.FillRectangle($brushCapsuleBg, 250, 134, 38, 32)
$gfx.DrawRectangle($penBorder, 250, 134, 38, 32)
$gfx.DrawString('+人', $fontSmall, $brushGray, 258.0, 141.0)

# Category Label
$gfx.FillEllipse($brushCyan, 70, 188, 6, 6)
$gfx.DrawString('单人会话', $fontSmall, $brushMuted, 82.0, 182.0)

# Session Card 1: CP2077_TRPG (ACTIVE / SELECTED)
$gfx.FillRectangle($brushCardActive, 64, 206, 230, 68)
$gfx.DrawRectangle($penCardActive, 64, 206, 230, 68)
$gfx.DrawString('CP2077_TRPG', $fontCardTitle, $brushWhite, 76.0, 216.0)
$gfx.DrawString('个人航行', $fontSmall, $brushGray, 76.0, 236.0)
$gfx.FillRectangle($brushCyanBg, 76, 254, 52, 16)
$gfx.DrawString('SINGLE', $fontMicro, $brushCyan, 82.0, 256.0)

# Session Card 2: 蒸汽朋克幻想
$gfx.FillRectangle($brushCapsuleBg, 64, 286, 230, 68)
$gfx.DrawRectangle($penBorder, 64, 286, 230, 68)
$gfx.DrawString('蒸汽朋克幻想', $fontCardTitle, $brushSlate, 76.0, 296.0)
$gfx.DrawString('个人航行', $fontSmall, $brushMuted, 76.0, 316.0)
$gfx.DrawString('SINGLE', $fontMicro, $brushMuted, 76.0, 336.0)

# Session Card 3: 兽人人权剥夺法案
$gfx.FillRectangle($brushCapsuleBg, 64, 366, 230, 68)
$gfx.DrawRectangle($penBorder, 64, 366, 230, 68)
$gfx.DrawString('兽人人权剥夺法案', $fontCardTitle, $brushSlate, 76.0, 376.0)
$gfx.DrawString('个人航行', $fontSmall, $brushMuted, 76.0, 396.0)
$gfx.DrawString('SINGLE', $fontMicro, $brushMuted, 76.0, 416.0)

# 5. Column 3: Main Chat Area (304 to 1280 px, y: 32 to 820)
$gfx.FillRectangle($brushChatBg, 304, 32, 976, 788)

# Chat Header (y: 32 to 74)
$gfx.DrawString('CP2077_TRPG', $fontTitle, $brushWhite, 324.0, 44.0)
$gfx.DrawString('[时序调试]  COMPLETED / WAITING 0', $fontSmall, $brushCyan, 980.0, 46.0)

# =========================================================================
# HORIZONTAL PERSISTENT HUD PANEL (Matching PersistentHudContainer.tsx)
# =========================================================================
$gfx.FillRectangle($brushDarkCard, 324, 76, 936, 172)
$gfx.DrawRectangle($penBorder, 324, 76, 936, 172)

# HUD Header
$gfx.FillEllipse($brushCyan, 340, 92, 8, 8)
$gfx.DrawString('常驻状态面板 (PERSISTENT HUD)', $fontBold, $brushGray, 356.0, 88.0)

# HUD Top Right Buttons
$gfx.FillRectangle($brushCapsuleBg, 1105, 84, 72, 24)
$gfx.DrawRectangle($penBorderLight, 1105, 84, 72, 24)
$gfx.DrawString('时序调试', $fontSmall, $brushSlate, 1116.0, 88.0)

$gfx.FillRectangle($brushCapsuleBg, 1185, 84, 62, 24)
$gfx.DrawRectangle($penBorderLight, 1185, 84, 62, 24)
$gfx.DrawString('收起 ▲', $fontSmall, $brushSlate, 1195.0, 88.0)

# HUD Stat Bars Row
# Capsule 1: MP
$gfx.FillRectangle($brushCapsuleBg, 340, 118, 130, 40)
$gfx.DrawRectangle($penBorderLight, 340, 118, 130, 40)
$gfx.DrawString('mp             50', $fontMicro, $brushSlate, 348.0, 122.0)
$gfx.DrawString('max_mp         50', $fontMicro, $brushMuted, 348.0, 134.0)
$gfx.FillRectangle($brushMp, 346, 150, 118, 3)

# Capsule 2: GOLD (Yellow Outline)
$gfx.FillRectangle($brushCapsuleBg, 485, 118, 130, 40)
$gfx.DrawRectangle($penGold, 485, 118, 130, 40)
$gfx.DrawString('gold', $fontSmall, $brushGoldLight, 495.0, 124.0)
$gfx.DrawString('100', $fontBold, $brushGoldLight, 570.0, 124.0)
$gfx.FillRectangle($brushGold, 492, 150, 116, 3)

# Capsule 3: WEIGHT
$gfx.FillRectangle($brushCapsuleBg, 630, 118, 130, 40)
$gfx.DrawRectangle($penBorderLight, 630, 118, 130, 40)
$gfx.DrawString('weight          0', $fontMicro, $brushSlate, 638.0, 122.0)
$gfx.DrawString('max_weight     50', $fontMicro, $brushMuted, 638.0, 134.0)
$gfx.FillRectangle($brushAccent, 636, 150, 60, 3)

# Capsule 4: HP
$gfx.FillRectangle($brushCapsuleBg, 775, 118, 130, 40)
$gfx.DrawRectangle($penBorderLight, 775, 118, 130, 40)
$gfx.DrawString('hp            100', $fontMicro, $brushSlate, 783.0, 122.0)
$gfx.DrawString('max_hp        100', $fontMicro, $brushMuted, 783.0, 134.0)
$gfx.FillRectangle($brushHp, 781, 150, 118, 3)

# HUD Inventory Row
$gfx.DrawString('背包物品 (0)', $fontSmall, $brushGray, 340.0, 170.0)
$gfx.DrawString('负重: 0 / 50', $fontSmall, $brushMuted, 1180.0, 170.0)

# 7 Empty Dashed Slots
for ($i = 0; $i -lt 7; $i++) {
  $sx = 340 + $i * 54
  $gfx.DrawRectangle($penDashed, $sx, 190, 44, 44)
}

# =========================================================================
# CHAT SCROLL AREA (Exact Dialogue from User Session)
# =========================================================================
# Context Bar
$gfx.FillRectangle($brushDarkCard, 324, 258, 936, 26)
$gfx.DrawRectangle($penBorder, 324, 258, 936, 26)
$gfx.DrawString('点击设定上下文窗口 21.7K', $fontSmall, $brushMuted, 336.0, 263.0)
$gfx.DrawString('⤢', $fontSmall, $brushGray, 1242.0, 263.0)

# Dialogue Paragraph 1
$gfx.DrawString('带血的剥离钳变得沉重无比。* 走，还是不走？', $fontBody, $brushWhite, 340.0, 302.0)

# Dialogue Paragraph 2
$p2 = '与此同时，在歌舞伎区另一头的丽姿酒吧里，莫克斯帮的皮条客正把一个喝醉的公司女郎往小巷里拖，嘴里骂骂咧咧地抱怨着今晚的生意又被NCPD的巡逻队给搅黄了。'
$gfx.DrawString($p2, $fontBody, $brushSlate, [System.Drawing.RectangleF]::new(340.0, 335.0, 900.0, 48.0))

# Subplot Option Card
$gfx.FillRectangle($brushCapsuleBg, 340, 395, 880, 32)
$gfx.DrawRectangle($penBorderLight, 340, 395, 880, 32)
$gfx.DrawString('1', $fontBold, $brushCyanLight, 354.0, 402.0)
$gfx.DrawString('推进第 幕_入局：玩家前往车祸现场提取芯片', $fontSmall, $brushSlate, 380.0, 402.0)

# PLOT_SUMMARY Accordion Card
$gfx.FillRectangle([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(12, 19, 30)), 340, 440, 880, 48)
$gfx.DrawRectangle($penBorder, 340, 440, 880, 48)
$gfx.DrawString('▼ PLOT_SUMMARY', $fontMicro, $brushCyan, 354.0, 446.0)
$gfx.DrawString('玩家对烂牙的提议表示犹豫但有意向，烂牙捕捉到信号后进一步施压利诱，场景保持紧张。', $fontSmall, $brushGray, 354.0, 462.0)

# Bottom Input Bar (y: 745 to 805)
$gfx.FillRectangle($brushInputBg, 340, 748, 860, 48)
$gfx.DrawRectangle($penBorderLight, 340, 748, 860, 48)
$gfx.DrawString('Type a message. Leave empty in room chats to skip this turn.', $fontBody, $brushMuted, 356.0, 762.0)

# Circular Send Button
$gfx.FillEllipse([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(2, 132, 199)), 1215, 752, 40, 40)
$gfx.DrawString('➤', $fontBody, $brushWhite, 1228.0, 762.0)

# Right Drawer Toggle
$gfx.DrawString('‹', $fontTitle, $brushMuted, 1268.0, 420.0)

$canvasBmp.Save('${safeOutputPath}', [System.Drawing.Imaging.ImageFormat]::Png)
$gfx.Dispose()
$canvasBmp.Dispose()
Write-Host "CP2077 HUD screenshot generated successfully."
`;
}

function generateDataContainerPsScript(outputPath, container) {
  const stats = container?.stats || {
    hp: 100,
    max_hp: 100,
    mp: 50,
    max_mp: 50,
    gold: 100,
    weight: 0,
    max_weight: 50
  };

  const safeOutputPath = outputPath.replace(/\\/g, '\\\\');

  return `
Add-Type -AssemblyName System.Drawing

$canvasBmp = New-Object System.Drawing.Bitmap(1280, 820)
$gfx = [System.Drawing.Graphics]::FromImage($canvasBmp)
$gfx.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$gfx.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

# Colors (Authentic Night Voyage Cyber-Xuanqing Theme)
$colorAppBg = [System.Drawing.Color]::FromArgb(7, 11, 16)
$colorRail = [System.Drawing.Color]::FromArgb(9, 14, 21)
$colorSidebar = [System.Drawing.Color]::FromArgb(11, 16, 24)
$colorChatBg = [System.Drawing.Color]::FromArgb(8, 12, 18)
$colorDrawerBg = [System.Drawing.Color]::FromArgb(10, 15, 26)
$colorBorder = [System.Drawing.Color]::FromArgb(30, 41, 59)
$colorBorderLight = [System.Drawing.Color]::FromArgb(51, 65, 85)
$colorAccent = [System.Drawing.Color]::FromArgb(16, 185, 129)
$colorCyan = [System.Drawing.Color]::FromArgb(6, 182, 212)
$colorCyanBg = [System.Drawing.Color]::FromArgb(8, 51, 68)
$colorCardActive = [System.Drawing.Color]::FromArgb(19, 29, 43)
$colorCardBorderActive = [System.Drawing.Color]::FromArgb(30, 58, 95)
$colorGold = [System.Drawing.Color]::FromArgb(245, 158, 11)
$colorGoldLight = [System.Drawing.Color]::FromArgb(251, 191, 36)
$colorHp = [System.Drawing.Color]::FromArgb(244, 63, 94)
$colorMp = [System.Drawing.Color]::FromArgb(14, 165, 233)
$colorWhite = [System.Drawing.Color]::FromArgb(248, 250, 252)
$colorSlate = [System.Drawing.Color]::FromArgb(226, 232, 240)
$colorGray = [System.Drawing.Color]::FromArgb(148, 163, 184)
$colorMuted = [System.Drawing.Color]::FromArgb(100, 116, 139)
$colorDarkCard = [System.Drawing.Color]::FromArgb(16, 23, 36)
$colorBubble = [System.Drawing.Color]::FromArgb(20, 29, 44)

# Brushes
$brushAppBg = New-Object System.Drawing.SolidBrush($colorAppBg)
$brushRail = New-Object System.Drawing.SolidBrush($colorRail)
$brushSidebar = New-Object System.Drawing.SolidBrush($colorSidebar)
$brushChatBg = New-Object System.Drawing.SolidBrush($colorChatBg)
$brushDrawerBg = New-Object System.Drawing.SolidBrush($colorDrawerBg)
$brushDarkCard = New-Object System.Drawing.SolidBrush($colorDarkCard)
$brushBubble = New-Object System.Drawing.SolidBrush($colorBubble)
$brushCardActive = New-Object System.Drawing.SolidBrush($colorCardActive)
$brushCyanBg = New-Object System.Drawing.SolidBrush($colorCyanBg)
$brushWhite = New-Object System.Drawing.SolidBrush($colorWhite)
$brushSlate = New-Object System.Drawing.SolidBrush($colorSlate)
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
$penCardActive = New-Object System.Drawing.Pen($colorCardBorderActive, 1.5)
$penAccent = New-Object System.Drawing.Pen($colorAccent, 2)
$penCyan = New-Object System.Drawing.Pen($colorCyan, 1.5)

# Fonts
$fontSessions = New-Object System.Drawing.Font('Segoe UI', 17, [System.Drawing.FontStyle]'Bold, Italic')
$fontTitle = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
$fontSection = New-Object System.Drawing.Font('Segoe UI', 10.5, [System.Drawing.FontStyle]::Bold)
$fontCardTitle = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$fontBody = New-Object System.Drawing.Font('Segoe UI', 9.5)
$fontBold = New-Object System.Drawing.Font('Segoe UI', 9.5, [System.Drawing.FontStyle]::Bold)
$fontSmall = New-Object System.Drawing.Font('Segoe UI', 8.5)
$fontMicro = New-Object System.Drawing.Font('Segoe UI', 7.5, [System.Drawing.FontStyle]::Bold)
$fontMono = New-Object System.Drawing.Font('Consolas', 9)

# 1. Base App Window
$gfx.FillRectangle($brushAppBg, 0, 0, 1280, 820)

# 2. Window TitleBar (0 to 32 px)
$gfx.FillRectangle($brushRail, 0, 0, 1280, 32)
$gfx.DrawLine($penBorder, 0, 32, 1280, 32)
$gfx.DrawString('N I G H T   V O Y A G E', $fontMicro, $brushMuted, 16.0, 9.0)
$gfx.DrawString('─   □   ✕', $fontSmall, $brushGray, 1210.0, 8.0)

# 3. Column 1: Left NavigationRail (0 to 54 px)
$gfx.FillRectangle($brushRail, 0, 32, 54, 788)
$gfx.DrawLine($penBorder, 54, 32, 54, 820)
$gfx.DrawString('设置', $fontMicro, $brushMuted, 14.0, 52.0)
$gfx.FillRectangle($brushCyan, 9, 88, 36, 36)
$gfx.DrawString('会话', $fontMicro, $brushWhite, 14.0, 100.0)
$gfx.DrawString('联机', $fontMicro, $brushMuted, 14.0, 148.0)
$gfx.DrawString('预设', $fontMicro, $brushMuted, 14.0, 198.0)
$gfx.DrawString('设定', $fontMicro, $brushMuted, 14.0, 248.0)

# 4. Column 2: SessionSidebar (54 to 304 px)
$gfx.FillRectangle($brushSidebar, 54, 32, 250, 788)
$gfx.DrawLine($penBorder, 304, 32, 304, 820)
$gfx.DrawString('SESSIONS', $fontSessions, $brushWhite, 68.0, 48.0)

# Active Session Card: CP2077_TRPG
$gfx.FillRectangle($brushCardActive, 64, 96, 230, 68)
$gfx.DrawRectangle($penCardActive, 64, 96, 230, 68)
$gfx.DrawString('CP2077_TRPG', $fontCardTitle, $brushWhite, 76.0, 106.0)
$gfx.DrawString('个人航行', $fontSmall, $brushGray, 76.0, 126.0)
$gfx.FillRectangle($brushCyanBg, 76, 144, 52, 16)
$gfx.DrawString('SINGLE', $fontMicro, $brushCyan, 82.0, 146.0)

# Other Session Cards
$gfx.FillRectangle($brushDarkCard, 64, 176, 230, 68)
$gfx.DrawRectangle($penBorder, 64, 176, 230, 68)
$gfx.DrawString('蒸汽朋克幻想', $fontCardTitle, $brushSlate, 76.0, 186.0)
$gfx.DrawString('个人航行', $fontSmall, $brushMuted, 76.0, 206.0)

$gfx.FillRectangle($brushDarkCard, 64, 256, 230, 68)
$gfx.DrawRectangle($penBorder, 64, 256, 230, 68)
$gfx.DrawString('兽人人权剥夺法案', $fontCardTitle, $brushSlate, 76.0, 266.0)
$gfx.DrawString('个人航行', $fontSmall, $brushMuted, 76.0, 286.0)

# 5. Column 3: Central Chat View Area (304 to 740 px)
$gfx.FillRectangle($brushChatBg, 304, 32, 436, 788)
$gfx.DrawString('当前会话: CP2077_TRPG', $fontSection, $brushWhite, 320.0, 48.0)
$gfx.DrawString('夜之城 · 歌舞伎区 | 导演-演员模式', $fontSmall, $brushMuted, 320.0, 72.0)

# Chat snippet in background
$gfx.FillRectangle($brushDarkCard, 320, 105, 400, 220)
$gfx.DrawRectangle($penBorder, 320, 105, 400, 220)
$gfx.DrawString('带血的剥离钳变得沉重无比。* 走，还是不走？', $fontSmall, $brushWhite, 332.0, 116.0)
$gfx.DrawString('烂牙把刚到手的荒坂剥离钳推过来：“五十枚金币，不多不少，握紧它去车祸现场提取芯片。”', $fontSmall, $brushSlate, [System.Drawing.RectangleF]::new(332.0, 144.0, 376.0, 90.0))
$gfx.DrawString('▼ PLOT_SUMMARY: 玩家完成交易，烂牙提供芯片坐标，局势紧迫。', $fontMicro, $brushCyan, 332.0, 280.0)

# 6. Column 4: Right Drawer: AgentDebugDrawer (740 to 1280 px, width 540 px)
$gfx.FillRectangle($brushDrawerBg, 740, 32, 540, 788)
$gfx.DrawLine($penBorderLight, 740, 32, 740, 820)

# Drawer Header
$gfx.DrawString('>_ Agent 运行态与时序调试抽屉 (AgentDebugDrawer)', $fontTitle, $brushWhite, 760.0, 46.0)
$gfx.DrawString('会话: CP2077_TRPG | 快捷键: Ctrl+Shift+D | 监听 session:hud_state_patch', $fontSmall, $brushMuted, 760.0, 72.0)
$gfx.DrawString('✕', $fontTitle, $brushGray, 1245.0, 46.0)

# Drawer Tabs
$gfx.DrawLine($penBorder, 740, 100, 1280, 100)
$gfx.DrawString('生命周期泳道 (Timeline)', $fontBold, $brushMuted, 760.0, 110.0)
$gfx.DrawString('数据容器快照 (DataContainer)', $fontBold, $brushAccent, 940.0, 110.0)
$gfx.DrawLine($penAccent, 940, 132, 1140, 132)
$gfx.DrawString('规则与门禁测试器', $fontBold, $brushMuted, 1155.0, 110.0)

# DataContainer Tab Content
$gfx.DrawString('实时内存状态（同步写入 SQLite session_states 表）', $fontSmall, $brushGray, 760.0, 145.0)
$gfx.DrawString('[重置初始状态]', $fontSmall, $brushHp, 1180.0, 145.0)

# Box 1: Stats 键值表 (CP2077_TRPG)
$gfx.FillRectangle($brushDarkCard, 760, 168, 495, 140)
$gfx.DrawRectangle($penBorderLight, 760, 168, 495, 140)
$gfx.DrawString('Stats 键值表 (CP2077_TRPG · DataContainer.stats)', $fontSection, $brushAccent, 775.0, 178.0)

$gfx.FillRectangle($brushBubble, 775, 208, 225, 36)
$gfx.DrawString('hp:  100 / 100', $fontMono, $brushWhite, 785.0, 217.0)

$gfx.FillRectangle($brushBubble, 1015, 208, 225, 36)
$gfx.DrawString('mp:  50 / 50', $fontMono, $brushWhite, 1025.0, 217.0)

$gfx.FillRectangle($brushBubble, 775, 252, 225, 36)
$gfx.DrawRectangle($penCyan, 775, 252, 225, 36)
$gfx.DrawString('gold:  50 G (扣减50G后)', $fontMono, $brushGoldLight, 785.0, 261.0)

$gfx.FillRectangle($brushBubble, 1015, 252, 225, 36)
$gfx.DrawString('weight:  2.0 / 50.0 kg', $fontMono, $brushWhite, 1025.0, 261.0)

# Box 2: Inventory 道具清单 (CP2077_TRPG)
$gfx.FillRectangle($brushDarkCard, 760, 322, 495, 240)
$gfx.DrawRectangle($penBorderLight, 760, 322, 495, 240)
$gfx.DrawString('Inventory 道具清单 (1 件物品)', $fontSection, $brushGoldLight, 775.0, 334.0)

# Newly Purchased Item in CP2077_TRPG
$gfx.FillRectangle($brushBubble, 775, 365, 465, 58)
$gfx.DrawRectangle($penCyan, 775, 365, 465, 58)
$gfx.DrawString('[剥离钳] arasaka_stripping_pliers (荒坂精工剥离钳) ★ 本轮新购入', $fontBold, $brushGoldLight, 785.0, 374.0)
$gfx.DrawString('重量: 2.0 kg | 单价: 50 G | 来源: n_tool_buy_item 原子契约通过', $fontSmall, $brushCyan, 785.0, 396.0)
$gfx.DrawString('x1', $fontBold, $brushGoldLight, 1205.0, 380.0)

$gfx.FillRectangle($brushBubble, 775, 435, 465, 44)
$gfx.DrawRectangle($penBorder, 775, 435, 465, 44)
$gfx.DrawString('[行囊槽位 2~7] 空置 (剩余承重: 48.0 kg)', $fontSmall, $brushMuted, 785.0, 448.0)

# Box 3: Flags 状态标记 (CP2077_TRPG)
$brushPurple = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(192, 132, 252))
$brushPurpleLight = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(216, 180, 254))
$gfx.FillRectangle($brushDarkCard, 760, 575, 495, 115)
$gfx.DrawRectangle($penBorderLight, 760, 575, 495, 115)
$gfx.DrawString('Flags 状态标记 (DataContainer.flags)', $fontSection, $brushPurple, 775.0, 585.0)

$gfx.FillRectangle($brushBubble, 775, 615, 230, 32)
$gfx.DrawString('current_location = 夜之城 · 歌舞伎区', $fontSmall, $brushPurpleLight, 785.0, 623.0)

$gfx.FillRectangle($brushBubble, 1015, 615, 225, 32)
$gfx.DrawString('contact = 烂牙 (Rot-tooth)', $fontSmall, $brushPurpleLight, 1025.0, 623.0)

$gfx.FillRectangle($brushBubble, 775, 652, 465, 26)
$gfx.DrawString('mission = 推进第1幕_入局：前往车祸现场提取芯片 | blueprint_in_effect = true', $fontSmall, $brushCyan, 785.0, 657.0)

# Box 4: 蓝图门禁原子审计日志
$gfx.FillRectangle($brushDarkCard, 760, 702, 495, 95)
$gfx.DrawRectangle($penBorderLight, 760, 702, 495, 95)
$gfx.DrawString('本轮蓝图审计: [n_gate_gold] PASS (100 >= 50) -> [n_calc_gold_deduct] 100-50=50G', $fontSmall, $brushWhite, 775.0, 712.0)
$gfx.DrawString('门禁判定: [n_gate_weight] PASS (0+2.0 <= 50) -> [n_ret_trade_ok] 交易达成', $fontSmall, $brushWhite, 775.0, 732.0)
$gfx.DrawString('HUD同步: 已向 Shadow DOM 派发 session:hud_state_patch (GOLD:50G, WEIGHT:2kg)', $fontSmall, $brushCyan, 775.0, 752.0)
$gfx.DrawString('输出规范: [n_invoke_schema_narrative] PASS -> rpg_turn_summary 驱动 PLOT_SUMMARY', $fontSmall, $brushAccent, 775.0, 772.0)

$canvasBmp.Save('${safeOutputPath}', [System.Drawing.Imaging.ImageFormat]::Png)
$gfx.Dispose()
$canvasBmp.Dispose()
Write-Host "DataContainer CP2077 app window screenshot saved successfully."
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
$gfx.DrawString('stats.gold -= 50 (剩50)', $fontBold, $brushCyan, 815.0, 518.0)
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

  const hudPngPath = path.join(outputDir, 'cp2077_hud_screenshot.png');
  const dcPngPath = path.join(outputDir, 'datacontainer_screenshot.png');
  const bpPngPath = path.join(outputDir, 'blueprint_execution_v22.png');
  const tmpDir = path.join(__dirname, '..', '..', 'scratch');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  // 1. Render CP2077 HUD Window PNG (Identical to user photo)
  const hudPs = generateCp2077HudPsScript(hudPngPath, container);
  const hudTmp = path.join(tmpDir, 'render_cp2077_hud_window.ps1');
  fs.writeFileSync(hudTmp, '\uFEFF' + hudPs, 'utf8');
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${hudTmp}"`);

  // 2. Render DataContainer Window PNG (With AgentDebugDrawer open on CP2077)
  const dcPs = generateDataContainerPsScript(dcPngPath, container);
  const dcTmp = path.join(tmpDir, 'render_dc_app_window.ps1');
  fs.writeFileSync(dcTmp, '\uFEFF' + dcPs, 'utf8');
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${dcTmp}"`);

  // 3. Render Blueprint Window PNG
  const bpPs = generateBlueprintPsScript(bpPngPath);
  const bpTmp = path.join(tmpDir, 'render_bp_app_window.ps1');
  fs.writeFileSync(bpTmp, '\uFEFF' + bpPs, 'utf8');
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${bpTmp}"`);

  const hudStat = fs.statSync(hudPngPath);
  const dcStat = fs.statSync(dcPngPath);
  const bpStat = fs.statSync(bpPngPath);

  return {
    cp2077_hud: { path: hudPngPath, size: hudStat.size },
    datacontainer: { path: dcPngPath, size: dcStat.size },
    blueprint: { path: bpPngPath, size: bpStat.size }
  };
}

module.exports = { renderPngFiles };
