wheat tools（麦工具）静态站点
================================

这个压缩包是构建好的静态站点，不需要 Node 或 pnpm 即可部署。

部署方式
--------
1. 解压后把其中的全部文件放到网站根目录（index.html 必须在根目录下）。
2. 任意静态服务器都能直接服务它：
     nginx:  root /var/www/wheat-tools;
     Caddy:  file_server
     Python: python3 -m http.server -d . 8080
   nginx 配置示例见仓库的 deploy/nginx-wheat-chat-static.conf。
3. 路由使用 URL hash（#/tools/xxx），因此不需要配置 SPA 回退规则。

联网说明
--------
除「外网 IP 查询」需要访问第三方接口外，其余工具全部在浏览器本地运行，
不会向任何服务器发送数据。

文件说明
--------
  index.html            入口页面
  assets/               带内容哈希的 JS/CSS，可长期缓存
  favicon.svg           站点图标
  CNAME                 自定义域名（如不使用可删除）

升级
--------
直接用新版本的文件覆盖即可。assets/ 下的文件名带内容哈希，
因此不会出现旧缓存与新代码不匹配的问题。

来源
--------
完整源码：https://github.com/zpc1995/wheat-tools
