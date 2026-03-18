# self-drive

一个适合 NAS / Docker 部署的多用户网页网盘，当前已推进到带账户管理的第二版 MVP。

## 当前已实现

- 多用户注册 / 登录
- JWT 鉴权
- 第一位注册用户自动成为管理员
- 账户设置：修改昵称、修改密码
- 管理员用户管理：启用 / 禁用、改角色、改配额、重置密码、删除用户
- 上传时按用户存储配额做校验
- 文件夹 / 根目录 / 面包屑导航
- 文件上传 / 下载 / 删除 / 重命名
- 图片 / PDF / 音视频 / 文本预览
- 文件公开分享链接
- 独立分享页 `share.html`
- 管理员用户概览（用户数、文件数、占用情况）
- PostgreSQL 元数据 + MinIO 文件存储
- Docker Compose 一键启动

## 技术栈

- 前端：原生 HTML / CSS / JavaScript
- 后端：Node.js + Express
- 数据库：PostgreSQL
- 对象存储：MinIO
- 部署：Docker Compose

## 本地 / 飞牛部署

1. 克隆仓库
2. 复制环境变量模板

```bash
cp .env.example .env
```

3. 确认宿主机数据目录存在（默认是飞牛目录）

```bash
mkdir -p /vol4/1000/data_2/openclaw_data/workspace/jiang_data/postgres
mkdir -p /vol4/1000/data_2/openclaw_data/workspace/jiang_data/minio
```

4. 修改 `.env` 里的密码、密钥和目录路径
5. 启动服务

```bash
docker compose up -d --build
```

启动后：
- 网盘页面：`http://NAS_IP:8080`
- 健康检查：`http://NAS_IP:8080/api/health`
- MinIO Console：`http://NAS_IP:9001`
- 宿主机持久化目录：`/vol4/1000/data_2/openclaw_data/workspace/jiang_data`
- 容器内挂载目录：`/jiang_data`

## 现有反向代理接入建议

如果你已经有外层 Nginx：
- 直接把 `drive.example.com` 整站反代到 `http://NAS_IP:8080` 即可
- `/api` 已经由前端容器内的 Nginx 自动转发到后端
- 分享页同样会自动走 `drive.example.com/share.html?token=...`

建议至少加上这些 Nginx 配置：
- `client_max_body_size 200m;`
- `proxy_read_timeout 600s;`
- `proxy_send_timeout 600s;`
- 后续如果你要更好的视频拖动体验，再继续加 `Range` / 流式优化

## 环境变量

见 `.env.example`，核心字段有：

- `HOST_DATA_ROOT`：飞牛宿主机数据根目录，默认 `/vol4/1000/data_2/openclaw_data/workspace/jiang_data`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `JWT_SECRET`
- `APP_PORT`
- `FRONTEND_PORT`
- `MINIO_PORT`
- `MINIO_CONSOLE_PORT`
- `MINIO_ROOT_USER`
- `MINIO_ROOT_PASSWORD`
- `MINIO_BUCKET`
- `MAX_FILE_SIZE_MB`

## 当前限制

这是第二版 MVP，核心使用链路已经具备，但还不是最终生产版。

暂未完成：
- 文件移动 / 拖拽整理 / 批量操作
- 目录树侧边栏
- 断点续传 / 分片上传
- 分享密码 / 分享次数限制
- 回收站
- Office 文档转 PDF 预览
- 更细粒度角色权限
- 登录日志 / 设备管理 / 邮箱找回密码

## 下一步建议

优先级建议如下：

1. 文件移动与批量操作
2. 分享权限增强（密码、到期、次数限制）
3. 管理后台（日志、审核、配额策略）
4. 大文件上传优化
5. Office 预览与转码
