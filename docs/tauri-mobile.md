# Tauri 2 Mobile Support (iOS / Android)

## Current Status

`apps/desktop` 已使用 Tauri 2：
- `apps/desktop/Cargo.toml` -> `tauri = "2"`
- `apps/desktop/tauri.conf.json` -> `"$schema": "https://schema.tauri.app/config/2"`
- `apps/desktop/src/lib.rs` -> `#[cfg_attr(mobile, tauri::mobile_entry_point)]`

另外已增加平台配置文件：
- `apps/desktop/tauri.android.conf.json`
- `apps/desktop/tauri.ios.conf.json`

## Build Command Fix

Tauri 从 `apps/desktop` 启动时，原来的 `beforeDevCommand` / `beforeBuildCommand` 会找不到 web 脚本。

现已修复为：
- `npm --prefix ../web run dev`
- `npm --prefix ../web run build`

## Prerequisites

### Android

1. 安装 Android Studio（含 SDK + NDK）
2. 配置环境变量：

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/<version>"
```

3. 确认工具可用：

```bash
cd apps/desktop
cargo tauri android init --ci --skip-targets-install
```

### iOS

1. 安装 Xcode（不仅是 Command Line Tools）
2. 安装 CocoaPods
3. 安装 `xcodegen`
4. 在 Apple Developer 中配置签名，并设置 Team ID（可通过环境变量 `APPLE_DEVELOPMENT_TEAM`）

建议额外执行（需要 sudo）：

```bash
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
sudo xcodebuild -runFirstLaunch
```

## Make Targets

新增命令：

```bash
# 初始化
make init-app-mobile-android
make init-app-mobile-ios

# 运行
make run-app-mobile-android
make run-app-mobile-ios

# 构建
make build-app-mobile-android
make build-app-mobile-ios
```

Desktop 保持不变：

```bash
make run-app-desktop
```

## Notes

- 首次执行 `init` 会生成平台工程到 `apps/desktop/gen/`。
- 如果你在 CI 或远端环境操作，请提前准备 SDK/Xcode 依赖，否则初始化会失败。
- iOS 真机运行还需要有效签名证书（当前环境 `security find-identity -v -p codesigning` 显示 `0 valid identities found`）。
