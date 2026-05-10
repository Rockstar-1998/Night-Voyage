# Night Voyage 版可待预设草案 V1

## 文档目标

本文基于 [`plans/kedai-night-voyage-migration-plan.md`](plans/kedai-night-voyage-migration-plan.md) 与 [`plans/kedai-preset-classification-v1.md`](plans/kedai-preset-classification-v1.md)，先产出一份 Night Voyage 版可待预设的**首版结构草案**。

这不是最终可直接落库的数据，而是用于确认以下几点：

1. 可待预设在 Night Voyage 中到底拆成哪些语义组
2. 哪些内容进入安全区
3. 哪些内容进入自由区
4. 哪些内容延后迁出预设层

---

## 一、预设摘要（草案）

- 名称：`可待·单人 NSFW 剧情叙事`
- 分类：`storytelling`
- 内容分级：`nsfw`
- 适用场景：
  - 单人长线互动
  - 第二人称剧情叙事
  - 中等篇幅回复
  - 偏平静推进、保留互动窗口
- 一句话效果总结：
  - `第二人称 + 不转述 + 平静推进 + 中长回复 + 强文风约束 + NSFW 特化`

---

## 二、一级语义组（草案）

### 1. `conversation-mode`

- 显示名：`会话类型`
- 选择方式：`single`
- 子项：
  - `single` -> `单人预设`
  - `group` -> `多人预设`
- 当前草案默认：`single`

### 2. `content-rating`

- 显示名：`内容类型`
- 选择方式：`single`
- 子项：
  - `sfw` -> `SFW`
  - `nsfw` -> `NSFW`
- 当前草案默认：`nsfw`

---

## 三、二级语义组（草案）

### 1. `language-mode`

- 显示名：`输出语言`
- 选择方式：`single`
- 子项：
  - `zh-hans` -> 简体汉语
  - `zh-hant` -> 繁体汉语
  - `en-us` -> English
  - `jp-zh-translate` -> 日中转译
- 当前草案默认：`zh-hans`
- 参考条目：[`❗1🇨🇳简体汉语`](3.27【可待】甲戌.json:474)

### 2. `reply-length`

- 显示名：`回复长度`
- 选择方式：`single`
- 子项：
  - `medium` -> 400-800 字
  - `long` -> 800-1200 字
  - `long-plus` -> 1200-1600 字
  - `very-long` -> 1600-2500 字
- 当前草案默认：`medium`
- 参考条目：[`❗3📜400-800字`](3.27【可待】甲戌.json:531)

### 3. `thought-mode`

- 显示名：`思考方式`
- 选择方式：`single`
- 子项：
  - `blank` -> 空白思维链
  - `short` -> 短思考
  - `long` -> 长思考
- 当前草案默认：`long`
- 参考条目：[`❗6🤔长思考`](3.27【可待】甲戌.json:614), [`❗6🤪短思考`](3.27【可待】甲戌.json:628), [`❗1💿空白思维链`](3.27【可待】甲戌.json:1689)

### 4. `narrative-perspective`

- 显示名：`叙事视角`
- 选择方式：`single`
- 子项：
  - `first-person`
  - `focus-character-first-person`
  - `second-person`
  - `omniscient-third-person`
  - `limited-third-person`
  - `observer-third-person`
- 当前草案默认：`second-person`
- 参考条目：[`❗1👽第二人称`](3.27【可待】甲戌.json:699)

### 5. `retelling-policy`

- 显示名：`转述方式`
- 选择方式：`single`
- 子项：
  - `full-retell`
  - `partial-retell`
  - `no-retell`
- 当前草案默认：`no-retell`
- 参考条目：[`❗2🔈不转述`](3.27【可待】甲戌.json:782)

### 6. `initiative-policy`

- 显示名：`角色自主度`
- 选择方式：`single`
- 子项：
  - `allow-proactive` -> 要抢话
  - `strict-user-control` -> 不抢话
- 当前草案默认：`allow-proactive`
- 参考条目：[`❗3🎙要抢话`](3.27【可待】甲戌.json:796)

### 7. `story-driver`

- 显示名：`剧情主导方式`
- 选择方式：`single`
- 子项：
  - `user-led`
  - `shared-led`
  - `world-led`
- 当前草案默认：`user-led`
- 参考条目：[`❗4👌我是主导`](3.27【可待】甲戌.json:824)

### 8. `story-pace`

- 显示名：`剧情节奏`
- 选择方式：`single`
- 子项：
  - `calm`
  - `intense`
- 当前草案默认：`calm`
- 参考条目：[`❗5👲平静剧情`](3.27【可待】甲戌.json:866)

### 9. `style-family`

- 显示名：`文风基底`
- 选择方式：`single`
- 子项：
  - `base`
  - `essay-yudafu`
  - `cold-fiction`
  - `classical-fiction`
  - `nsfw-baijie`
  - `custom-style`
- 当前草案默认：`nsfw-baijie`
- 参考条目：[`❗1📕涩涩特化文风`](3.27【可待】甲戌.json:1006)

### 10. `nsfw-dominance`

- 显示名：`NSFW 主被动`
- 选择方式：`single`
- 子项：
  - `user-dominant`
  - `user-submissive`
  - `auto-switch`
- 当前草案默认：`user-dominant`
- 参考条目：[`❗1🧒性主导者`](3.27【可待】甲戌.json:1127)

### 11. `nsfw-demeanor`

- 显示名：`NSFW 态度`
- 选择方式：`single`
- 子项：
  - `gentle`
  - `rough`
  - `auto`
- 当前草案默认：`rough`
- 参考条目：[`❗2😭性粗鲁`](3.27【可待】甲戌.json:1183)

### 12. `nsfw-intensity`

- 显示名：`NSFW 强度`
- 选择方式：`multiple`
- 子项：
  - `baseline-nsfw` -> NSFW 总纲
  - `explicit-scene-clarity` -> 性明确
  - `teasing-structure` -> 性调情
  - `heat-always-on` -> 发情
  - `vulgar-dirty-talk` -> 侮辱性淫语 / 淫词
- 当前草案默认：
  - `baseline-nsfw`
  - `explicit-scene-clarity`
  - `teasing-structure`
  - `heat-always-on`
  - `vulgar-dirty-talk`
- 参考条目：[`💕总纲（NSFW必开）`](3.27【可待】甲戌.json:1114), [`👄性明确（NSFW必开）`](3.27【可待】甲戌.json:1211), [`🤘性调情（测试）`](3.27【可待】甲戌.json:1225), [`🔞发情`](3.27【可待】甲戌.json:1239), [`🗣️侮辱性淫语/淫词`](3.27【可待】甲戌.json:1253)

---

## 四、安全区（草案）

以下条目建议进入安全区，并优先做锁定或作为核心骨架保留：

### A. 核心规则骨架

- `前置处理总纲`
  - 参考：[`〈前置处理〉`](3.27【可待】甲戌.json:460)
- `创作准则总纲`
  - 参考：[`〈人称/转述/抢话处理>`](3.27【可待】甲戌.json:656)
- `文风处理总纲`
  - 参考：[`〈文风处理〉`](3.27【可待】甲戌.json:922)
- `后置功能总纲`
  - 参考：[`〈后置功能〉`](3.27【可待】甲戌.json:1412)

### B. 输出骨架

- `格式骨架`
  - 参考：[`🔒📚格式姬`](3.27【可待】甲戌.json:1493)
- `输出模板骨架`
  - 参考：[`🔒📖输出模板`](3.27【可待】甲戌.json:1731)

### C. 强稳定性规则

- `基础文风`
  - 参考：[`🔒🖊️基础文风`](3.27【可待】甲戌.json:936)
- `禁用库`
  - 参考：[`🔒🚫禁用库`](3.27【可待】甲戌.json:642)

说明：

- `用户输入` 相关内容不再作为普通预设文本块暴露，而由 Night Voyage 当前轮输入层承接，参考：[`🔒🔑用户输入`](3.27【可待】甲戌.json:1745)
- `思维链前/输出模板/预填充输入` 不再原样复刻 ST 的前后夹结构，而应分别折叠进 `thought-mode` 与核心输出骨架

---

## 五、自由区（草案）

以下内容建议先落入自由区：

- `抗XX七合一（哈开）`
  - 参考：[`🤫抗XX七合一（哈开）`](3.27【可待】甲戌.json:950)
- 各类文风补充文本
  - 参考：[`❗2📗散文文风补充1`](3.27【可待】甲戌.json:1034) 一类
- `文生图支持`
  - 参考：[`🌆文生图支持`](3.27【可待】甲戌.json:1425)
- 其他测试、AUTO、特化增强项

原因：

- 作者风格强
- 结构不够稳定
- 可先保留发挥空间，不必急着压进语义组

---

## 六、暂不进入首版预设主链路的条目

以下内容建议暂缓，避免把 Night Voyage 重新做回 ST 式“预设万能箱”：

- `小总结（省token）`
  - 参考：[`🖨小总结（省token）`](3.27【可待】甲戌.json:1438)
  - 去向：剧情总结层 / summary policy
- `当前伏笔`
  - 参考：[`🆎2🖊️当前伏笔`](3.27【可待】甲戌.json:1452)
  - 去向：未来伏笔系统
- `大纲规划（可自改）`
  - 参考：[`🆎3🎞️大纲规划（可自改）`](3.27【可待】甲戌.json:1466)
  - 去向：未来 planning 系统
- ST 式思维链夹层
  - 参考：[`🆎4💡思维链前`](3.27【可待】甲戌.json:1717)
  - 去向：`thought-mode` 语义组 + 输出骨架
- ST 式预填充输入技巧
  - 参考：[`🔒💊预填充输入`](3.27【可待】甲戌.json:1759)
  - 去向：provider / prefill 能力层

---

## 七、参数层初版建议

当前首版 Night Voyage 可待预设草案建议：

- 保守继承可待原始参数偏好
- 只迁移 Night Voyage 已支持且明确稳定的参数

建议纳入：

- `temperature`
- `max_output_tokens`
- `top_p`
- 视后续需要补 `presence_penalty`
- 视后续需要补 `frequency_penalty`
- `response_mode` 仅在明确需要时启用

---

## 八、examples 初版建议

第一轮分类后，当前判断仍然是：

- 可待大部分内容是规则块，不是标准 few-shot 示例对
- 第一版 Night Voyage 可待预设可以：
  - `preset_examples` 先留空
  - 或仅保留极少量真正承担“示范说话方式”的条目

因此首版草案先不以 `examples` 作为主体。

---

## 九、首版 Night Voyage 版可待预设草案摘要

### 一级语义组

- `conversation-mode = single`
- `content-rating = nsfw`

### 二级语义组默认值

- `language-mode = zh-hans`
- `reply-length = medium`
- `thought-mode = long`
- `narrative-perspective = second-person`
- `retelling-policy = no-retell`
- `initiative-policy = allow-proactive`
- `story-driver = user-led`
- `story-pace = calm`
- `style-family = nsfw-baijie`
- `nsfw-dominance = user-dominant`
- `nsfw-demeanor = rough`
- `nsfw-intensity = baseline-nsfw + explicit-scene-clarity + teasing-structure + heat-always-on + vulgar-dirty-talk`

### 安全区

- 前置处理总纲
- 创作准则总纲
- 文风总纲
- 后置功能总纲
- 基础文风
- 禁用库
- 格式骨架
- 输出模板骨架

### 自由区

- 抗XX补丁
- 文风补充
- 文生图支持
- 其他实验条目

### 延后迁出

- 小总结
- 当前伏笔
- 大纲规划
- ST 式思维链前后夹结构
- ST 式预填充技巧

---

## 十、下一步

下一步最适合继续做的，不再是继续泛谈，而是：

1. 根据这份草案，列出“首版需要锁定的条目清单”
2. 列出“每个互斥语义组的机器键与子项键”
3. 输出一版更接近落库数据的 Night Voyage 可待预设结构样例

一句话说：

**第一版骨架已经出来，下一步就该把它压缩成真正可落库的结构样例。**
