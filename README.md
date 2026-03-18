# self-drive

一个适合 NAS / Docker 部署的多用户网页网盘 MVP。

当前版本已包含：
- 多用户注册 / 登录
- JWT 鉴权
- 文件上传
- 文件列表
- 文件下载
- 图片 / PDF / 音视频 / 文本预览
- 用户文件隔离
- Docker Compose 一键启动
- PostgreSQL 元数据 + MinIO 文件存储

## 技术栈

- 前端：原生 HTML / CSS / JavaScript（先把 MVP 跑通）
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

3. 修改 `.env` 里的密码和密钥
4. 启动服务

```bash
docker compose up -d --build
```

启动后：
- 网盘页面：`http://NAS_IP:8080`
- 健康检查：`http://NAS_IP:8080/api/health`
- MinIO Console：`http://NAS_IP:9001`

## 现有反向代理接入建议

如果你已经有外层 Nginx：
- 直接把 `drive.example.com` 整站反代到 `http://NAS_IP:8080` 即可
- `/api` 已经由前端容器内的 Nginx 自动转发到后端

注意 Nginx 需要额外设置：
- `client_max_body_size 200m;`
- `proxy_read_timeout 600s;`
- `proxy_send_timeout 600s;`
- 对下载和预览保留 `Range` / 流式支持（后续增强）

## 当前已实现范围

这是第一版可用 MVP，优先把核心链路跑通。

已完成：
- 用户系统
- 上传 / 下载 / 预览
- MinIO 存储
- Docker 化

下一步建议：
- 文件夹
- 分享链接
- 管理员后台
- 存储配额
- 回收站
- 分片上传 / 断点续传
- Office 文档转 PDF 预览
