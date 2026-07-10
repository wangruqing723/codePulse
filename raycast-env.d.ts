/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** 活跃窗口分钟数 - 只展示最近写入过的会话。 */
  "activeWindowMinutes": string,
  /** 菜单栏样式 - 控制菜单栏标题展示的信息密度。 */
  "menuBarStyle": "icon" | "count" | "session",
  /** 启用声音 - 当前使用 Raycast 通知能力，声音由系统通知设置控制。 */
  "enableSound": boolean,
  /** 监控项目路径 - 可选。用逗号分隔路径前缀；留空表示监控全部近期会话。 */
  "monitorProjects"?: string,
  /** Companion Release Tag - 可选。默认使用当前扩展版本对应的 tag，格式为 codepulse-companion-v<version>。 */
  "companionReleaseTag"?: string,
  /** Companion Manifest URL - 可选。覆盖默认 GitHub Release manifest URL。 */
  "companionManifestUrl"?: string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `codepulse` command */
  export type Codepulse = ExtensionPreferences & {}
  /** Preferences accessible in the `setup-hooks` command */
  export type SetupHooks = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `codepulse` command */
  export type Codepulse = {}
  /** Arguments passed to the `setup-hooks` command */
  export type SetupHooks = {}
}

