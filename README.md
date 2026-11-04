<div align="center">

# 闲亭 · DeskPark

**简洁优雅的网页桌游平台** —— 斗地主、掼蛋、德州扑克、四川麻将（血战到底）、广东麻将（推倒胡）、中国象棋、国际象棋、桌游「魔法出包」「UON」「卡旦岛」「宝石商会」，单人练习或与好友联机。<br/>
打开网页即玩，规则引擎与界面分离，可扩展自定义玩法，并为移植 App 预留了结构。

[![CI](https://github.com/solitern/DeskPark/actions/workflows/ci.yml/badge.svg)](https://github.com/solitern/DeskPark/actions/workflows/ci.yml)
[![Docker](https://github.com/solitern/DeskPark/actions/workflows/docker.yml/badge.svg)](https://github.com/solitern/DeskPark/actions/workflows/docker.yml)

<img src="docs/screenshots/lobby.jpg" alt="大厅" width="860" />

</div>

## 特性

- **扑克**：斗地主（叫分、全牌型、炸弹/春天倍数、记牌器）、掼蛋（两副牌、逢人配、同花顺、升级、进贡/还贡/抗贡、接风）、德州扑克（盲注与涨盲、最小加注规则、边池、摊牌比牌）。
- **麻将**：四川麻将 · 成都血战到底（换三张、定缺、一炮多响、过水、最后四张必胡、刮风下雨、呼叫转移、查花猪 / 查大叫 / 退税），矢量麻将牌与听牌提示。<br/>**广东麻将 · 推倒胡**：108 张（无字牌、无花牌），可吃可碰可杠，优先级 胡 > 杠 > 碰 > 吃，多家能胡时按出牌顺序由最近的一家截胡；杠分独立结算（暗杠每家 2、直杠放杠者 2、补杠每家 1）；番型鸡胡 / 平胡 1、碰碰胡 2、七小对 3、豪华七对 4、清一色 4、清对 5、清七对 6、清豪华七对 7，杠上开花 / 抢杠 / 海底 / 天胡 / 地胡各加番，8 番封顶；底分 1 / 2 / 5、4 / 8 / 16 盘或不限，可选筹码与是否允许吃牌，复用同一套矢量麻将牌与牌桌皮肤。<br/>**麻将导师**：需要时点「导师」打开、随时可以关——给当前这一步出主意并讲清楚为什么：换三张换哪三张、定缺哪门、打哪张（向听数、有效进张、听哪几张还剩几张、能胡几番）、该不该碰杠胡、对手可能在做什么、哪些牌对谁绝对安全；你选中一张牌，它会告诉你这张好不好。全部在本机计算，配置了大模型还能用大白话讲解、回答追问。
- **棋类**：中国象棋（马蹩腿、象眼、炮架、将帅不照面，长将判负，中文纵线记谱）与国际象棋（王车易位、吃过路兵、升变，逼和 / 三次重复 / 五十步 / 子力不足判和，标准记谱）；三档电脑强度（迭代加深 alpha-beta 搜索），可点选或拖动走子，和电脑下可以悔棋。<br/>**导师模式**：和电脑下棋时打开导师，每一步先在棋盘上选好，导师用 Stockfish / Fairy-Stockfish 引擎（在你的浏览器里运行，不占服务器）判断能不能走、讲清楚为什么，并在棋盘上画出对方的应着与更好的走法；没思路时可以要提示；配置了大模型还会用大白话再讲一遍，并回答你的追问。
- **桌游**：魔法出包（2–5 人，玩法参考《出包魔法师 Abracada...What?》）——看得见别人的魔法石、猜不到自己的；还原实体版的游戏图版、计分轨道与城堡，喊咒语、连锁施法、火龙反噬与猫头鹰魔法石，点击任意魔法石查看效果，附带基于可见信息的概率推算。<br/>UON（2–8 人，四色接龙出牌，玩法同经典的四色牌游戏官方规则）——跳过、反转、+2、万能牌与 +4 质疑，只剩一张要喊「一张！」，忘了会被抓；可选计分与叠加罚牌，全部牌面为矢量手绘。<br/>卡旦岛（2–4 人，六边形拓荒经营，规则按经典拓荒桌游的基础版）——随机地图、掷骰产出、强盗、修路建村升城、发展卡、港口与玩家交易、最长道路 / 最大军队，地形与棋子全部为矢量手绘。<br/>宝石商会（2–4 人，宝石引擎构筑，规则按经典宝石收集桌游的官方规则）——拿宝石、预留与购买三级发展卡、贵族拜访，矿脉晶簇 / 工坊胸针 / 王冠三种手绘卡面与五种刻面宝石。
- **像素形象**：赛博朋克、修仙、动漫、卡通四组共 22 个原创像素头像，每个都有对应的全身像素立绘（带待机动作）；切换「虚拟形象」后牌桌上所有人都以全身像显示，另有 8 个特别角色可选。
- **AI 人机**：在设置里填写自己的大模型接口（Anthropic 或任意 OpenAI 兼容接口，如 DeepSeek、通义千问），点电脑玩家头像上方的 ✨ 即可让大模型接管它：读取它的手牌与场上局势来决定出牌，思考时显示省略号，还会偶尔发言、回应你的聊天。
- **房间聊天**：等待房间与对局中都能聊天，支持快捷语、未读提醒与消息浮窗；另有表情互动。
- **单人 & 多人**：单人与电脑对战（规则 AI，德州使用蒙特卡洛胜率估算；也可唤醒大模型接管）；联机输入 4 位房间号或分享链接即可加入，空位由电脑补齐。
- **服务端权威**：联机时规则在服务器运行，每个座位只收到自己能看到的信息，杜绝作弊；断线重连自动恢复座位，离线/超时自动托管。
- **可扩展玩法**：所有玩法都实现同一个 `GameDefinition` 插件接口，附带示例玩法「比大小」与 [新增玩法指南](docs/ADDING_A_GAME.md)。
- **简洁优雅的界面**：统一的设计令牌、自绘矢量花色与卡面、四种桌布、四色牌、深色模式、细腻的动效与合成音效；桌面与横/竖屏手机自适应。
- **为 App 而设计**：规则引擎纯 TypeScript、无 DOM 依赖；平台相关能力集中在一个适配层，见 [App 移植方案](docs/PORTING.md)。

<table>
  <tr>
    <td><img src="docs/screenshots/doudizhu.jpg" alt="斗地主" /></td>
    <td><img src="docs/screenshots/guandan.jpg" alt="掼蛋" /></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/texas.jpg" alt="德州扑克" /></td>
    <td><img src="docs/screenshots/result.jpg" alt="结算" /></td>
  </tr>
</table>

<p align="center"><img src="docs/screenshots/mobile.jpg" alt="手机横屏" width="560" /></p>

## 快速开始

需要 Node.js ≥ 20（推荐 22，见 `.nvmrc`）。

```bash
npm install
npm run dev
```

打开 <http://localhost:5173>。`npm run dev` 会同时启动 Web 开发服务器（Vite）与联机服务器（端口 8787，Vite 已代理 `/ws`）。

> 国内网络安装依赖较慢时，可临时使用镜像：`npm install --registry=https://registry.npmmirror.com`

### 常用命令

| 命令              | 说明                                           |
| ----------------- | ---------------------------------------------- |
| `npm run dev`     | 同时启动 Web 与联机服务器（热更新）            |
| `npm run dev:web` | 只启动 Web（单人模式不需要服务器）             |
| `npm test`        | 运行全部测试（规则单测 + 整局模拟 + 联机集成） |
| `npm run check`   | lint + 类型检查 + 测试，提交前请运行           |
| `npm run build`   | 构建 Web 静态资源与服务器单文件                |
| `npm start`       | 启动生产服务器（同时托管 Web 页面）            |

## 部署

一个 Node 进程同时提供网页与联机服务，推荐用 Docker：

```bash
git clone https://github.com/solitern/DeskPark.git && cd DeskPark
cp .env.example .env
docker compose pull && docker compose up -d     # 打开 http://服务器IP:8787
```

- 镜像 `ghcr.io/solitern/deskpark`（amd64 / arm64），每次推送 main 自动构建、冒烟测试并发布。
- 绑定域名并自动 HTTPS：`docker compose -f docker-compose.yml -f deploy/docker-compose.https.yml up -d`
- 国内网络、版本回滚、Nginx 反代、不用 Docker 的方式等，见 **[部署指南](docs/DEPLOY.md)**。

## 项目结构

```
packages/
  engine/      规则引擎与 AI（纯 TS，无 DOM）：GameDefinition 接口、Table 运行器、各玩法实现
  protocol/    客户端 ⇄ 服务器消息协议
apps/
  web/         React + Vite 网页客户端
  server/      Node WebSocket 联机服务器（房间管理、服务端权威对局）
docs/          架构、设计、玩法扩展、App 移植、路线图
```

## 文档

- [部署指南](docs/DEPLOY.md) —— Docker、HTTPS、云服务器、国内网络
- [架构说明](docs/ARCHITECTURE.md) —— 分层、数据流、信息隐藏、联机协议
- [新增 / 自定义玩法](docs/ADDING_A_GAME.md) —— 以「比大小」为例的完整步骤
- [设计规范](docs/DESIGN.md) —— 设计原则、色彩、字体、卡面、动效
- [App 移植方案](docs/PORTING.md) —— Capacitor 快速上架与 React Native 原生化路线
- [路线图](docs/ROADMAP.md) · [更新日志](CHANGELOG.md) · [贡献指南](CONTRIBUTING.md)

## 许可

[MIT](LICENSE)

导师模式随附的棋类引擎是独立的第三方程序，按各自的许可证分发：[Stockfish](https://github.com/official-stockfish/Stockfish)（`apps/web/public/engines/stockfish/`，来自 npm 包 `stockfish@19.0.1`）与 [Fairy-Stockfish](https://github.com/fairy-stockfish/Fairy-Stockfish)（`apps/web/public/engines/fairy/`，来自 npm 包 `fairy-stockfish-nnue.wasm@1.1.12`），均为 GPL-3.0，许可证全文见各目录下的 `COPYING.txt`。
