/**
 * High-definition GDI+ PNG Renderer for Night Voyage MCP Screenshots
 * Uses PowerShell System.Drawing via UTF-8 BOM script files.
 * Uses distinct variable names to prevent case-insensitive PowerShell variable shadowing.
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

$canvasBmp = New-Object System.Drawing.Bitmap(1020, 720)
$gfx = [System.Drawing.Graphics]::FromImage($canvasBmp)
$gfx.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$gfx.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

# Xuanqing Theme Colors
$colorBg = [System.Drawing.Color]::FromArgb(13, 21, 24)
$colorCard = [System.Drawing.Color]::FromArgb(20, 34, 40)
$colorBorder = [System.Drawing.Color]::FromArgb(35, 60, 72)
$colorAccent = [System.Drawing.Color]::FromArgb(46, 125, 100)
$colorGold = [System.Drawing.Color]::FromArgb(201, 154, 62)
$colorHp = [System.Drawing.Color]::FromArgb(180, 60, 60)
$colorMp = [System.Drawing.Color]::FromArgb(53, 109, 148)
$colorWhite = [System.Drawing.Color]::FromArgb(227, 237, 242)
$colorGray = [System.Drawing.Color]::FromArgb(141, 170, 184)
$colorMuted = [System.Drawing.Color]::FromArgb(82, 110, 122)

# Brushes
$brushBg = New-Object System.Drawing.SolidBrush($colorBg)
$brushCard = New-Object System.Drawing.SolidBrush($colorCard)
$brushWhite = New-Object System.Drawing.SolidBrush($colorWhite)
$brushGray = New-Object System.Drawing.SolidBrush($colorGray)
$brushMuted = New-Object System.Drawing.SolidBrush($colorMuted)
$brushAccent = New-Object System.Drawing.SolidBrush($colorAccent)
$brushGold = New-Object System.Drawing.SolidBrush($colorGold)
$brushHp = New-Object System.Drawing.SolidBrush($colorHp)
$brushMp = New-Object System.Drawing.SolidBrush($colorMp)

# Pens
$penBorder = New-Object System.Drawing.Pen($colorBorder, 1)
$penAccent = New-Object System.Drawing.Pen($colorAccent, 1.5)
$penGold = New-Object System.Drawing.Pen($colorGold, 1.5)

# Fonts
$fontTitle = New-Object System.Drawing.Font('Segoe UI', 15, [System.Drawing.FontStyle]::Bold)
$fontHead = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
$fontBody = New-Object System.Drawing.Font('Segoe UI', 10)
$fontBold = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$fontSmall = New-Object System.Drawing.Font('Segoe UI', 9)

# Canvas Background
$gfx.FillRectangle($brushBg, 0, 0, 1020, 720)

# Header Box
$gfx.FillRectangle($brushCard, 20, 20, 980, 80)
$gfx.DrawRectangle($penAccent, 20, 20, 980, 80)
$gfx.DrawString('Night Voyage - DataContainer 实时运行时状态快照 (MCP Native)', $fontTitle, $brushWhite, 35.0, 32.0)
$gfx.DrawString('挂载节点: [n_ui_layout_hud] RightDock | 驱动契约: [n_rpg_engine_gate] | 零回退原子门禁已生效', $fontSmall, $brushAccent, 35.0, 66.0)

# Card 1: 角色数值面板 (Left Top)
$gfx.FillRectangle($brushCard, 20, 115, 475, 250)
$gfx.DrawRectangle($penBorder, 20, 115, 475, 250)
$gfx.DrawString('角色基础数值状态 (DataContainer.stats)', $fontHead, $brushWhite, 35.0, 128.0)

# HP
$gfx.DrawString('生命值 (HP):', $fontBody, $brushGray, 35.0, 165.0)
$gfx.DrawString('${stats.hp} / ${stats.max_hp}', $fontBold, $brushWhite, 140.0, 165.0)
$gfx.FillRectangle($brushMuted, 245, 168, 220, 12)
$gfx.FillRectangle($brushHp, 245, 168, ${Math.min(220, Math.round((stats.hp / stats.max_hp) * 220))}, 12)

# MP
$gfx.DrawString('法力值 (MP):', $fontBody, $brushGray, 35.0, 195.0)
$gfx.DrawString('${stats.mp} / ${stats.max_mp}', $fontBold, $brushWhite, 140.0, 195.0)
$gfx.FillRectangle($brushMuted, 245, 198, 220, 12)
$gfx.FillRectangle($brushMp, 245, 198, ${Math.min(220, Math.round((stats.mp / stats.max_mp) * 220))}, 12)

# Gold
$gfx.DrawString('金币 (Gold):', $fontBody, $brushGray, 35.0, 230.0)
$gfx.DrawString('${stats.gold} G  (扣减后当前余额)', $fontHead, $brushGold, 140.0, 225.0)
$gfx.DrawString('原150 G -> 购买长剑扣除50 G [n_calc_gold_deduct]', $fontSmall, $brushMuted, 140.0, 255.0)

# Weight
$gfx.DrawString('负重 (Weight):', $fontBody, $brushGray, 35.0, 285.0)
$gfx.DrawString('${stats.weight} / ${stats.max_weight} kg  (合规)', $fontBold, $brushWhite, 140.0, 285.0)
$gfx.FillRectangle($brushMuted, 280, 288, 185, 12)
$gfx.FillRectangle($brushAccent, 280, 288, ${Math.min(185, Math.round((stats.weight / stats.max_weight) * 185))}, 12)
$gfx.DrawString('最大负重门禁校验通过 [n_gate_weight]', $fontSmall, $brushMuted, 140.0, 310.0)

# Card 2: 蓝图节点审计 (Right Top)
$gfx.FillRectangle($brushCard, 515, 115, 485, 250)
$gfx.DrawRectangle($penBorder, 515, 115, 485, 250)
$gfx.DrawString('蓝图节点执行与门禁判定审计', $fontHead, $brushWhite, 530.0, 128.0)

$gfx.DrawString('• [n_agent_gate] -> n_agent_director_actor', $fontBold, $brushAccent, 530.0, 162.0)
$gfx.DrawString('   导演-演员双智能体模式: 局部视界隔离，防上帝视角', $fontSmall, $brushGray, 530.0, 182.0)

$gfx.DrawString('• [n_gate_gold] 算术门禁: 检查 Gold >= 50', $fontBold, $brushGold, 530.0, 205.0)
$gfx.DrawString('   实际值: 150 >= 50 -> 判定通过 (PASS)，放行结算', $fontSmall, $brushGray, 530.0, 225.0)

$gfx.DrawString('• [n_calc_gold_deduct] 计算器: Gold -= 50', $fontBold, $brushWhite, 530.0, 248.0)
$gfx.DrawString('   原子扣减: 150 - 50 = 100 G，实时广播 HUD State Patch', $fontSmall, $brushGray, 530.0, 268.0)

$gfx.DrawString('• [n_ret_trade_ok] 交易回执通知', $fontBold, $brushAccent, 530.0, 292.0)
$gfx.DrawString('   交易达成，通知 Shadow DOM 原地刷新装备面板', $fontSmall, $brushGray, 530.0, 312.0)

# Card 3: 行囊装备清单 (Bottom)
$gfx.FillRectangle($brushCard, 20, 380, 980, 315)
$gfx.DrawRectangle($penBorder, 20, 380, 980, 315)
$gfx.DrawString('行囊道具与物品清单 (DataContainer.inventory)', $fontHead, $brushWhite, 35.0, 395.0)

# Table Header
$gfx.FillRectangle($brushBg, 35, 430, 950, 32)
$gfx.DrawRectangle($penBorder, 35, 430, 950, 32)
$gfx.DrawString('物品名称', $fontBold, $brushGray, 45.0, 437.0)
$gfx.DrawString('道具 ID', $fontBold, $brushGray, 220.0, 437.0)
$gfx.DrawString('数量', $fontBold, $brushGray, 380.0, 437.0)
$gfx.DrawString('单价', $fontBold, $brushGray, 460.0, 437.0)
$gfx.DrawString('单重', $fontBold, $brushGray, 560.0, 437.0)
$gfx.DrawString('蓝图节点来源 / 属性', $fontBold, $brushGray, 670.0, 437.0)

# Row 1
$gfx.DrawString('木杖', $fontBold, $brushWhite, 45.0, 475.0)
$gfx.DrawString('wooden_staff', $fontBody, $brushGray, 220.0, 475.0)
$gfx.DrawString('1', $fontBody, $brushWhite, 390.0, 475.0)
$gfx.DrawString('15 G', $fontBody, $brushGold, 465.0, 475.0)
$gfx.DrawString('3.0 kg', $fontBody, $brushWhite, 565.0, 475.0)
$gfx.DrawString('初始行囊武器 [type: weapon]', $fontBody, $brushMuted, 670.0, 475.0)

# Row 2
$gfx.DrawString('初级治疗药水', $fontBold, $brushWhite, 45.0, 515.0)
$gfx.DrawString('healing_potion', $fontBody, $brushGray, 220.0, 515.0)
$gfx.DrawString('1', $fontBody, $brushWhite, 390.0, 515.0)
$gfx.DrawString('20 G', $fontBody, $brushGold, 465.0, 515.0)
$gfx.DrawString('0.5 kg', $fontBody, $brushWhite, 565.0, 515.0)
$gfx.DrawString('恢复生命值 +50 [n_tool_use_item]', $fontBody, $brushAccent, 670.0, 515.0)

# Row 3
$gfx.DrawString('精钢长剑 (新添置)', $fontBold, $brushGold, 45.0, 555.0)
$gfx.DrawString('iron_sword', $fontBody, $brushGold, 220.0, 555.0)
$gfx.DrawString('1', $fontBold, $brushGold, 390.0, 555.0)
$gfx.DrawString('50 G', $fontBody, $brushGold, 465.0, 555.0)
$gfx.DrawString('10.0 kg', $fontBody, $brushGold, 565.0, 555.0)
$gfx.DrawString('由蓝图契约 [n_tool_buy_item] 成功添置入包', $fontBold, $brushGold, 670.0, 555.0)

$gfx.DrawString('当前剧情锚点: 迷雾镇旅馆 | 阶段: 1 | 输出Schema: [n_invoke_schema_narrative] (rpg_turn_summary)', $fontSmall, $brushMuted, 45.0, 650.0)

$canvasBmp.Save('${safeOutputPath}', [System.Drawing.Imaging.ImageFormat]::Png)
$gfx.Dispose()
$canvasBmp.Dispose()
Write-Host "DataContainer screenshot saved successfully."
`;
}

function generateBlueprintPsScript(outputPath) {
  const safeOutputPath = outputPath.replace(/\\/g, '\\\\');

  return `
Add-Type -AssemblyName System.Drawing

$canvasBmp = New-Object System.Drawing.Bitmap(1060, 720)
$gfx = [System.Drawing.Graphics]::FromImage($canvasBmp)
$gfx.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$gfx.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

# Xuanqing Palette
$colorBg = [System.Drawing.Color]::FromArgb(9, 14, 17)
$colorCard = [System.Drawing.Color]::FromArgb(16, 27, 32)
$colorActive = [System.Drawing.Color]::FromArgb(32, 85, 68)
$colorActiveBorder = [System.Drawing.Color]::FromArgb(60, 170, 130)
$colorMutedCard = [System.Drawing.Color]::FromArgb(18, 24, 28)
$colorMutedBorder = [System.Drawing.Color]::FromArgb(40, 52, 58)
$colorGold = [System.Drawing.Color]::FromArgb(201, 154, 62)
$colorWhite = [System.Drawing.Color]::FromArgb(227, 237, 242)
$colorGray = [System.Drawing.Color]::FromArgb(141, 170, 184)
$colorMuted = [System.Drawing.Color]::FromArgb(82, 110, 122)
$colorAccent = [System.Drawing.Color]::FromArgb(46, 125, 100)

$brushBg = New-Object System.Drawing.SolidBrush($colorBg)
$brushCard = New-Object System.Drawing.SolidBrush($colorCard)
$brushActive = New-Object System.Drawing.SolidBrush($colorActive)
$brushMutedCard = New-Object System.Drawing.SolidBrush($colorMutedCard)
$brushWhite = New-Object System.Drawing.SolidBrush($colorWhite)
$brushGray = New-Object System.Drawing.SolidBrush($colorGray)
$brushMuted = New-Object System.Drawing.SolidBrush($colorMuted)
$brushGold = New-Object System.Drawing.SolidBrush($colorGold)
$brushAccent = New-Object System.Drawing.SolidBrush($colorAccent)

$penActive = New-Object System.Drawing.Pen($colorActiveBorder, 2)
$penBorder = New-Object System.Drawing.Pen($colorMutedBorder, 1)
$penGold = New-Object System.Drawing.Pen($colorGold, 1.5)
$penLine = New-Object System.Drawing.Pen($colorActiveBorder, 2)
$penDimLine = New-Object System.Drawing.Pen($colorMutedBorder, 1)

$fontTitle = New-Object System.Drawing.Font('Segoe UI', 15, [System.Drawing.FontStyle]::Bold)
$fontHead = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
$fontBold = New-Object System.Drawing.Font('Segoe UI', 9.5, [System.Drawing.FontStyle]::Bold)
$fontSmall = New-Object System.Drawing.Font('Segoe UI', 8.5)

# Background
$gfx.FillRectangle($brushBg, 0, 0, 1060, 720)

# Header
$gfx.FillRectangle($brushCard, 20, 20, 1020, 72)
$gfx.DrawRectangle($penActive, 20, 20, 1020, 72)
$gfx.DrawString('Night Voyage V2.2 核心预设蓝图执行拓扑与节点激活 (MCP Native)', $fontTitle, $brushWhite, 35.0, 30.0)
$gfx.DrawString('蓝图文件: 全能进阶核心预设 V2.2.nvpreset.json | 激活节点: 101/108 | 连线: 151 | 未命中分支思维链已物理屏蔽', $fontSmall, $brushGray, 35.0, 62.0)

# SECTION 1: Agent Gate (Layer 1)
$gfx.DrawString('1. Agent 架构路由门禁 (AgentGate Routing)', $fontHead, $brushWhite, 35.0, 108.0)

$gfx.FillRectangle($brushCard, 35, 138, 180, 72)
$gfx.DrawRectangle($penGold, 35, 138, 180, 72)
$gfx.DrawString('[n_agent_gate]', $fontBold, $brushGold, 45.0, 148.0)
$gfx.DrawString('group_gate 编排器', $fontSmall, $brushGray, 45.0, 170.0)
$gfx.DrawString('分支选项: 3 种模式', $fontSmall, $brushWhite, 45.0, 186.0)

$gfx.DrawLine($penLine, 215, 174, 270, 174)
$gfx.DrawLine($penDimLine, 215, 174, 270, 260)
$gfx.DrawLine($penDimLine, 215, 174, 270, 332)

# Active Branch A
$gfx.FillRectangle($brushActive, 270, 138, 350, 72)
$gfx.DrawRectangle($penActive, 270, 138, 350, 72)
$gfx.DrawString('★ [n_agent_director_actor] (ACTIVE 激活中)', $fontBold, $brushWhite, 280.0, 148.0)
$gfx.DrawString('导演-演员双智能体模式: 视界物理裁剪与局部下发', $fontSmall, $brushWhite, 280.0, 170.0)
$gfx.DrawString('状态: 运行中 | 消除上帝视角，分角色台词槽位装配', $fontSmall, $brushGold, 280.0, 186.0)

# Branch B (Suppressed)
$gfx.FillRectangle($brushMutedCard, 270, 230, 350, 58)
$gfx.DrawRectangle($penBorder, 270, 230, 350, 58)
$gfx.DrawString('[n_agent_scriptwriter] (SUPPRESSED 未激活)', $fontBold, $brushMuted, 280.0, 240.0)
$gfx.DrawString('剧本流水线接力模式 (Drafter -> Critic -> Refiner)', $fontSmall, $brushMuted, 280.0, 262.0)

# Branch C (Suppressed)
$gfx.FillRectangle($brushMutedCard, 270, 305, 350, 58)
$gfx.DrawRectangle($penBorder, 270, 305, 350, 58)
$gfx.DrawString('[n_agent_single] (SUPPRESSED 未激活)', $fontBold, $brushMuted, 280.0, 315.0)
$gfx.DrawString('单智能体直出模式 (Single Agent Mode)', $fontSmall, $brushMuted, 280.0, 337.0)

# SECTION 2: RPG 引擎与工具链 (Layer 2)
$gfx.DrawString('2. 跑团规则与工具链引擎 (RPG Engine & Deterministic Gates)', $fontHead, $brushWhite, 35.0, 385.0)

$gfx.FillRectangle($brushCard, 35, 415, 180, 80)
$gfx.DrawRectangle($penGold, 35, 415, 180, 80)
$gfx.DrawString('[n_rpg_engine_gate]', $fontBold, $brushGold, 45.0, 425.0)
$gfx.DrawString('group_gate 契约引擎', $fontSmall, $brushGray, 45.0, 447.0)
$gfx.DrawString('4 项规则全部生效', $fontSmall, $brushWhite, 45.0, 465.0)

# Tool 1: check_inventory
$gfx.FillRectangle($brushCard, 260, 405, 220, 60)
$gfx.DrawRectangle($penBorder, 260, 405, 220, 60)
$gfx.DrawString('[n_tool_check_inv] 背包巡检', $fontBold, $brushWhite, 270.0, 415.0)
$gfx.DrawString('检查金币余额与当前总负重', $fontSmall, $brushGray, 270.0, 437.0)

# Tool 2: buy_item -> Gate -> Calc -> Return
$gfx.FillRectangle($brushActive, 260, 480, 220, 60)
$gfx.DrawRectangle($penActive, 260, 480, 220, 60)
$gfx.DrawString('★ [n_tool_buy_item] 购买契约', $fontBold, $brushWhite, 270.0, 490.0)
$gfx.DrawString('派发长剑购买 (单价50G, 重10kg)', $fontSmall, $brushGold, 270.0, 512.0)

$gfx.DrawLine($penLine, 480, 510, 520, 510)

$gfx.FillRectangle($brushCard, 520, 480, 175, 60)
$gfx.DrawRectangle($penGold, 520, 480, 175, 60)
$gfx.DrawString('[n_gate_gold] 金币门禁', $fontBold, $brushGold, 530.0, 490.0)
$gfx.DrawString('判定 Gold >= 50: PASS', $fontSmall, $brushWhite, 530.0, 512.0)

$gfx.DrawLine($penLine, 695, 510, 735, 510)

$gfx.FillRectangle($brushCard, 735, 480, 160, 60)
$gfx.DrawRectangle($penBorder, 735, 480, 160, 60)
$gfx.DrawString('[n_calc_gold_deduct]', $fontBold, $brushWhite, 745.0, 490.0)
$gfx.DrawString('Gold -= 50 (剩100G)', $fontSmall, $brushGold, 745.0, 512.0)

$gfx.DrawLine($penLine, 895, 510, 930, 510)

$gfx.FillRectangle($brushActive, 930, 480, 110, 60)
$gfx.DrawRectangle($penActive, 930, 480, 110, 60)
$gfx.DrawString('[n_ret_trade_ok]', $fontBold, $brushWhite, 935.0, 490.0)
$gfx.DrawString('交易成功回执', $fontSmall, $brushGold, 935.0, 512.0)

# Tool 3: get_player_stats & weight gate
$gfx.FillRectangle($brushCard, 260, 555, 220, 60)
$gfx.DrawRectangle($penBorder, 260, 555, 220, 60)
$gfx.DrawString('[n_tool_get_stats] 属性读取', $fontBold, $brushWhite, 270.0, 565.0)
$gfx.DrawString('读取 HP/MP/SAN/Weight 状态', $fontSmall, $brushGray, 270.0, 587.0)

$gfx.DrawLine($penLine, 480, 585, 520, 585)

$gfx.FillRectangle($brushCard, 520, 555, 175, 60)
$gfx.DrawRectangle($penBorder, 520, 555, 175, 60)
$gfx.DrawString('[n_gate_weight] 负重门禁', $fontBold, $brushWhite, 530.0, 565.0)
$gfx.DrawString('Weight <= 40 kg: PASS', $fontSmall, $brushWhite, 530.0, 587.0)

# SECTION 3: UI Layout & Schema Dock (Right Top)
$gfx.FillRectangle($brushCard, 660, 138, 380, 225)
$gfx.DrawRectangle($penBorder, 660, 138, 380, 225)
$gfx.DrawString('3. UI 挂载与 Schema 规范 (UI & Output)', $fontHead, $brushWhite, 675.0, 150.0)

$gfx.DrawString('• [n_ui_layout_hud] ui_layout_config', $fontBold, $brushAccent, 675.0, 185.0)
$gfx.DrawString('   mount_type: RightDock (右侧抽屉式挂载)', $fontSmall, $brushGray, 675.0, 207.0)
$gfx.DrawString('   theme: xuanqing_default (Shadow DOM 物理沙箱)', $fontSmall, $brushGray, 675.0, 223.0)

$gfx.DrawString('• [n_invoke_schema_narrative] invoke_schema', $fontBold, $brushGold, 675.0, 252.0)
$gfx.DrawString('   schema_id: rpg_turn_summary', $fontSmall, $brushGray, 675.0, 274.0)
$gfx.DrawString('   输出字段: thinking, status_bar, options, narrative', $fontSmall, $brushGray, 675.0, 290.0)
$gfx.DrawString('   裁剪门禁: 倒序滑动裁剪器 (Retention Depth: 3)', $fontSmall, $brushWhite, 675.0, 306.0)

$gfx.DrawString('Night Voyage Agent Architecture | Rust 2.0 Core + SolidJS Host | C1-C7 约束 100% 审计合规', $fontSmall, $brushMuted, 35.0, 665.0)

$canvasBmp.Save('${safeOutputPath}', [System.Drawing.Imaging.ImageFormat]::Png)
$gfx.Dispose()
$canvasBmp.Dispose()
Write-Host "Blueprint topology screenshot saved successfully."
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

  // Render DataContainer PNG
  const dcPs = generateDataContainerPsScript(dcPngPath, container);
  const dcTmp = path.join(tmpDir, 'render_dc_tmp.ps1');
  fs.writeFileSync(dcTmp, '\uFEFF' + dcPs, 'utf8');
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${dcTmp}"`);

  // Render Blueprint PNG
  const bpPs = generateBlueprintPsScript(bpPngPath);
  const bpTmp = path.join(tmpDir, 'render_bp_tmp.ps1');
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
