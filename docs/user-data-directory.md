# Zeus 用户级数据目录说明（v2）

本文定义 Zeus app-backend 的用户级本地数据目录规范，目标是让「用户项目文档」与「用户插件状态/数据」统一收口到同一根目录下。

## 1. 根目录与环境变量

- 数据根目录环境变量：`ZEUS_DATA_ROOT`
- 兼容变量：`REPO_ROOT`（历史配置）
- 默认值：`./data`（相对 `apps/app-backend` 工作目录）

解析规则：

1. 如果设置了 `ZEUS_DATA_ROOT`，优先使用它。
2. 否则读取 `REPO_ROOT`：
3. 如果 `REPO_ROOT` 以 `.../repos` 结尾，则自动回退到其父目录作为数据根（兼容旧布局）。
4. 最后回退到 `./data`。

## 2. 标准目录结构

```text
${ZEUS_DATA_ROOT}/
  users/
    {userId}/
      projects/
        {ownerType}/               # personal | team
          {ownerId}/
            {projectKey}/
              docs/                # 文档 JSON 与 .index
              assets/              # 附件与 meta
      .plugin/
        packages/
          {pluginId}/
            {version}/             # 插件包解压目录（manifest/frontend/backend/assets）
        settings/
          {pluginId}.json          # 用户级插件设置
        data/
          global/
            {pluginId}/            # 插件用户级全局数据
          projects/
            {ownerType}/{ownerId}/{projectKey}/{pluginId}/
                                  # 插件项目级数据
        cache/
          {pluginId}/              # 插件缓存
        runtime/                   # 运行时临时状态（worker/runtime artifacts）
        tmp/                       # 临时文件
        installed.json             # 用户已安装插件状态镜像
        registry-snapshot.json     # 用户插件贡献注册快照
```

## 3. 关键约束

- 安装粒度固定为「用户级」，插件对该用户全局生效（跨其可访问项目）。
- 项目文档与资产按 `ownerType/ownerId/projectKey` 进行作用域隔离。
- 插件包优先从用户目录 `.plugin/packages` 读取。
- 若显式设置 `PLUGIN_ROOT`，插件包路径可被覆盖（用于兼容/运维场景）。
- `installed.json`、`registry-snapshot.json` 作为本地镜像与降级数据源，数据库不可用时仍可工作。

## 4. 一次性迁移（旧布局 -> 新布局）

在 `apps/app-backend` 目录执行：

```bash
# 1) 预检查（不落盘）
set -a; source .env; set +a
pnpm run migrate:user-data-layout -- --dry-run

# 2) 正式迁移（建议首次使用 --force）
set -a; source .env; set +a
pnpm run migrate:user-data-layout -- --force
```

可选参数：

- `--legacy-repo-root=/path/to/old/repos`
- `--legacy-plugin-root=/path/to/old/plugins`
- `--verbose`

迁移策略：

- 采用 copy 策略，不删除旧目录。
- 默认幂等：目标已存在时跳过；传 `--force` 时允许覆盖复制。
- 数据库不可用时，会自动回退到文件系统扫描与本地镜像迁移路径。

## 5. 迁移后检查项

建议至少确认：

1. `users/{userId}/projects/.../docs` 与 `assets` 已出现且可读。
2. `users/{userId}/.plugin` 目录完整存在。
3. `users/{userId}/.plugin/installed.json` 存在且 JSON 可解析。
4. `users/{userId}/.plugin/registry-snapshot.json` 存在且 JSON 可解析。
5. 已安装插件包存在于 `users/{userId}/.plugin/packages/{pluginId}/{version}`。

## 6. 与代码实现对应关系

- 路径定义：`apps/app-backend/src/storage/paths.ts`
- 插件路径解析：`apps/app-backend/src/plugins/config.ts`
- 插件管理器（用户级插件布局）：`apps/app-backend/src/plugins-v2/manager.ts`
- 安装/设置本地镜像：`apps/app-backend/src/plugins-v2/install-store.ts`
- 注册快照本地镜像：`apps/app-backend/src/plugins-v2/registry-snapshot-store.ts`
- 迁移脚本：`apps/app-backend/src/scripts/migrate-user-data-layout.ts`

