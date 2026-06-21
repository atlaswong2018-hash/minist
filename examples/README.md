# 示例资源(examples)

可直接在 minist 酒馆前端导入使用的示例数据。全部 SFW。

## characters/ — 示例人物卡

- `sample-xiaoman.json` — Character Card **V2**(`chara_card_v2`)格式,「小满」学习伙伴角色。

### 如何导入
1. 启动酒馆前端(`npm run dev:tavern`)。
2. 打开侧边栏 → **角色** → **导入人物卡**。
3. 选择 `sample-xiaoman.json`(手机端会调用原生文件选择器)。
4. 解析成功后角色出现在列表,点击即可开始对话。

### 关于 PNG 人物卡
本仓库仅提供 JSON 示例(可直接导入)。带隐写元数据的 **PNG 人物卡**(把上面的 JSON 藏进 PNG `tEXt` 块的 `chara`/`ccv3` 字段)可由酒馆前端「导出」功能生成——导入 JSON 卡后,在角色菜单选「导出为 PNG」即可得到可在任何 SillyTavern 兼容酒馆流通的卡片。解析逻辑见 `packages/core/src/character-card/`。

## worlds/ — 示例世界书

- `sample-worldinfo.json` — 一个小型世界书,演示 `constant`(常驻)、`selective`(主/次关键词组合激活)两种条目类型。

### 如何导入
侧边栏 → **世界书** → 导入 → 选择该 JSON。

## 自定义
仿照示例的 JSON 结构修改即可创建你自己的角色与世界书。字段含义参考:
- `docs/architecture.md` 的数据模型章节
- `packages/core/src/character-card/types.ts`(V2/V3 完整字段)
- `packages/core/src/worldinfo/types.ts`(世界书条目字段)
