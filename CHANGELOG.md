# Changelog

本文件用于记录 `OvO-Inventory-System` 的版本变更基线。

格式参考：

- Added
- Changed
- Fixed
- Docs

## [v1.0.0] - 2026-03-26

### Added

- 物料主数据增强：生命周期、供给方式、替代料、供应商扩展字段、风险字段
- `收 / 发 / 转 / 盘` 独立执行页与正式库存单据链
- 发货单与库存单据正式联动
- 生产工单、部分完工、部分退料、异常单、异常红冲
- BOM / SOP / 工单快照
- 双预警模型：低库存预警、保供套数预警
- 高风险供应预警与治理
- 一致性治理工作台
- 统一物料搜索选择器
- Windows 更新脚本：
  - `deploy/update.bat`
  - `deploy/update-and-restart.bat`
  - `deploy/rollback.bat`
- 环境检查脚本：
  - `npm run check-env`
- 最小冒烟测试：
  - 健康检查
  - 登录
  - 受保护接口验证

### Changed

- 仓库名统一为 `OvO-Inventory-System`
- 路径配置改为环境变量可控：
  - `DB_PATH`
  - `SESSION_DB_DIR`
  - `SESSION_DB_NAME`
- Session cookie `secure` 改为可配置：
  - `COOKIE_SECURE=auto`
- 安装脚本加入环境兼容性检查
- README 改为项目总入口文档

### Fixed

- 修复本地 HTTP 场景下因 `Secure cookie` 导致登录态无法保持的问题
- 修复 BOM 弹窗因动态增删行导致鼠标目标漂移的问题
- 修复物料详情跳转 BOM 时只进入列表、不打开具体 BOM 的问题
- 修复多个高频交互入口和详情跳转链路问题

### Docs

- 补齐项目交接、部署、更新、回滚、命名规范、路线图等内部文档
- 公开仓库仅保留 README、CHANGELOG、部署安装指南、用户手册和仓库员速查版
