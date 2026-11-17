# saisai-shortlink

电路实验室分享短链。`POST /s`（请求体是压缩码）返回 `{"id":"xxxxxxxx"}`；打开 `https://saisai.me/s/<id>` 时 302 跳到 `/circuit/#c=<压缩码>`。数据存在 Cloudflare KV，key 是 id，value 是压缩码。

本机 brew 装的 wrangler 4.120 执行 deploy 会不报错直接退出，下面一律用 `npx wrangler@latest`。

## 首次部署

1. 登录 Cloudflare：`npx wrangler@latest login`。
2. 创建 KV：`npx wrangler@latest kv namespace create LINKS`。把输出里的 `id` 填进 `wrangler.jsonc` 的 `kv_namespaces[0].id`。
3. 部署：在本目录执行 `npx wrangler@latest deploy`。
4. 检查：`curl -si -X POST --data 'abc' https://saisai.me/s` 返回 `{"id":...}`；`curl -sI https://saisai.me/s/<id>` 返回 `302`，`Location` 以 `/circuit/#c=abc` 结尾；`curl -sI https://saisai.me/sudoku/` 仍由 GitHub Pages 返回 `200`。

## 测试

`node --test workers/shortlink/test/*.test.js`
