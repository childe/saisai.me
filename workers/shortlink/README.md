# saisai-shortlink

电路实验室分享短链。`POST /s`（请求体是压缩码）返回 `{"id":"xxxxxxxx"}`；打开 `https://saisai.me/s/<id>` 时 302 跳到 `/circuit/#c=<压缩码>`。数据存在 Cloudflare KV，key 是 id，value 是压缩码。

本机 brew 装的 wrangler 4.120 执行 deploy 会不报错直接退出，下面一律用 `npx wrangler@latest`。

## 部署

KV namespace `LINKS` 已创建，id 写在 `wrangler.jsonc` 里。

1. 登录 Cloudflare：`npx wrangler@latest login`。
2. 部署：在本目录执行 `npx wrangler@latest deploy`。路由生效要等几秒到一分钟。
3. 检查：`curl -si -X POST --data 'abc' https://saisai.me/s` 返回 `{"id":...}`；`curl -sI https://saisai.me/s/<id>` 返回 `302`，`Location` 以 `/circuit/#c=abc` 结尾；`curl -sI https://saisai.me/sudoku/` 仍由 GitHub Pages 返回 `200`。

GET 读 KV 时在边缘节点缓存 1 天。id 由内容哈希得到、不会变，所以缓存安全；但删掉的 key 在缓存过期前仍能打开。

## 测试

`node --test workers/shortlink/test/*.test.js`
