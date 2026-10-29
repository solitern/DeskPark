# App 移植方案

## Android 测试包

完整的环境、构建和安装步骤见 [Android APK 打包指南](ANDROID_APK.md)。

项目保留 Capacitor 配置和依赖，Android 工程由开发者在本地生成，不提交到仓库。当前应用 ID 为测试用的 `com.example.deskpark`。需要 Node.js 22、Android Studio / Android SDK 和 JDK 21。首次使用时按打包指南安装依赖并生成工程，之后在仓库根目录执行：

```bash
npm run android:sync -w @park/web
cd apps/web/android
./gradlew assembleDebug
```

调试 APK 位于 `apps/web/android/app/build/outputs/apk/debug/app-debug.apk`。无服务器时可测试单人模式；需要联机时，在同步前为构建命令设置 `VITE_SERVER_URL=wss://你的域名/ws`。调试签名和测试应用 ID 不用于正式发布。

项目从一开始就按「引擎与界面分离、平台能力集中」的方式组织，移植 App 有两条路线，可以先后进行。

## 为移植做好的准备

| 已就绪                                                                                               | 位置                                   |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 规则引擎与 AI 为纯 TypeScript，无 DOM / Node 依赖（定时器通过 `globalThis` 访问，状态拷贝使用 JSON） | `packages/engine`                      |
| 联机协议独立成包，任何客户端都可复用                                                                 | `packages/protocol`                    |
| 平台能力集中在一个文件（存储、服务器地址、震动、剪贴板、随机 token）                                 | `apps/web/src/lib/platform.ts`         |
| 设计令牌集中定义                                                                                     | `apps/web/src/styles/tokens.css`       |
| 服务器地址可通过 `VITE_SERVER_URL` 配置                                                              | 构建环境变量                           |
| 视口适配：安全区（刘海屏）、横竖屏、触摸拖选、禁止缩放                                               | 全局样式 / `index.html`                |
| PWA manifest：手机浏览器可「添加到主屏幕」                                                           | `apps/web/public/manifest.webmanifest` |

## 路线一：Capacitor 封装

把现有网页打包为 iOS / Android 原生应用。Android 工程在本地生成，实际构建方式见上方；下方是后续规划，插件、深链接和 iOS 仍待实现与验证。

1. Android 按 [打包指南](ANDROID_APK.md) 生成工程、同步资源并构建。
2. 如需 iOS，安装相应平台依赖并生成 iOS 工程。
3. 按需要在 `platform.ts` 中适配原生能力：
   - 存储 → `@capacitor/preferences`
   - 震动 → `@capacitor/haptics`（出牌、轮到你时轻触反馈）
   - 剪贴板 / 分享房间 → `@capacitor/clipboard`、`@capacitor/share`
4. 原生配置：横竖屏、状态栏、启动图和 App 图标。
5. 深链接：`deskpark://room/ABCD` 直接进入房间（使用 `@capacitor/app` 监听 `appUrlOpen` 后调用 `navigate`）。

注意：网页中 hash 路由可在 WebView 中使用；普通单人对局可离线运行，云端 AI 需要网络。

## 路线二：React Native / Expo 原生界面（追求极致体验时）

- 直接复用 `@park/engine` 与 `@park/protocol`（纯 TS，Hermes 可运行）。
- 复用 `GameController` 的思路：把 `apps/web/src/lib/controller.ts` 与 `online.ts` 中与 React DOM 无关的部分抽到 `packages/client-core`，Web 与 RN 共用。
- 界面用 RN 重写：卡面可用 `react-native-svg` 复刻（花色路径已在 `components/Suit.tsx` 中），动效用 Reanimated。
- 设计令牌抽成 `packages/design-tokens`（TS 常量），同时生成 Web 的 CSS 变量与 RN 的样式常量。

## 上架前检查

- [ ] 联机服务器部署到 HTTPS/WSS 域名
- [ ] 隐私政策（只存储昵称与随机身份 token，无账号）
- [ ] 中国大陆上架需要游戏版号；仅作为棋牌学习/休闲工具、不含真钱与道具交易，请按当地要求评估
- [ ] 后台切换与断线重连（已支持：重新连接后自动回到座位）
