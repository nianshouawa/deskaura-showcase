# DeskAura 官网：本机测试、GitHub 上传与 Cloudflare Pages 托管全流程教程

本教程专为 Windows 环境编写，手把手指导你完成 **① 本机测试调试**、**② 上传至 GitHub 仓库**、**③ 托管部署到 Cloudflare Pages（全球免费 CDN 加速 + 自动 HTTPS + 每次推送自动上线）**。

---

## 目录
1. [第一阶段：本机测试与预览](#第一阶段本机测试与预览)
2. [第二阶段：上传代码到 GitHub](#第二阶段上传代码到-github)
3. [第三阶段：托管到 Cloudflare Pages](#第三阶段托管到-cloudflare-pages)
4. [第四阶段：日常更新发布流程](#第四阶段日常更新发布流程)
5. [常见问题与排错排查](#常见问题与排错排查)

---

## 第一阶段：本机测试与预览

在上传之前，先在本地确认开发与打包预览一切正常。

项目位于目录：`D:\AI\HWrase\deskaura-showcase`

### 1. 打开终端进入项目目录
在 Windows 终端（PowerShell 或 CMD）中运行：
```powershell
cd D:\AI\HWrase\deskaura-showcase
```

### 2. 方式 A：开发模式（实时热重载）
用于边修改代码边实时预览，代码保存后浏览器自动刷新：
```powershell
npm run dev
```
- 控制台会输出访问地址，通常为：`http://localhost:5173/`
- 在浏览器打开该网址即可查看页面。按 `Ctrl + C` 可停止服务。

### 3. 方式 B：生产构建测试（必须运行）
Cloudflare Pages 在云端执行的就是这个命令。在本地先跑一次，确保 TypeScript 检查与打包 100% 零报错：
```powershell
npm run build
```
- 执行成功后，会显示 `✓ built in ...` 并在项目根目录生成 `dist/` 文件夹。

### 4. 方式 C：生产环境本地预览（模拟线上加载）
打包完成后，启动本地预览服务测试最终产物：
```powershell
npm run preview
```
- 访问地址通常为：`http://localhost:4173/`
- **核验要点**：
  1. 按 `F12` 打开浏览器开发者工具，检查 `Console` 是否有红色报错（正常情况下应该 0 报错）；
  2. 检查 Hero 右侧的高清实机截图是否完整显示（16:9 无裁切）；
  3. 点击「查看高清实机图」确认灯箱弹窗正常弹出并能关闭；
  4. 检查各处中文文字是否圆润清爽（自托管 HarmonyOS Sans SC 生效，无宋体点阵）。

---

## 第二阶段：上传代码到 GitHub

上传 GitHub 有两种方式：
- **方式 1（最推荐）：使用 GitHub Desktop 桌面端（图形化操作，简单直观，适合 Windows）**
- **方式 2：使用 Git 命令行（适合熟悉终端的用户）**

---

### 方式 1：使用 GitHub Desktop（推荐，无需敲命令）

1. **下载安装**：前往 [desktop.github.com](https://desktop.github.com/) 下载并安装 GitHub Desktop，登录你的 GitHub 账号。
2. **添加本地仓库**：
   - 打开 GitHub Desktop，点击顶部菜单 `File` -> `Add local repository...`（添加本地仓库）。
   - 在路径中选择：`D:\AI\HWrase\deskaura-showcase`。
   - 如果提示 `This directory does not appear to be a Git repository`，点击提示中的蓝色链接 **`create a repository`**（创建仓库）：
     - Name（仓库名）填写：`deskaura-showcase`
     - Git Ignore 保持现有的或选择 `Node`
     - 点击 **`Create Repository`**
3. **提交与发布**：
   - 左下角会看到所有改动文件（由于已有 `.gitignore`，`node_modules` 会被自动忽略，不会被上传）。
   - 在左下角 `Summary` 输入：`feat: DeskAura showcase website`。
   - 点击 **`Commit to main`**（提交到主分支）。
   - 点击顶部工具栏右侧的 **`Publish repository`**（发布到 GitHub）：
     - 勾选或取消勾选 `Keep this code private`（根据你需要公开还是私有，Cloudflare Pages 对两者都完全免费支持）。
     - 点击 **`Publish repository`** 确认。
   - 上传完成！现在你的代码已成功进入 GitHub。

---

### 方式 2：使用命令行（CLI）

如果你的电脑已安装 Git（若未安装可在 [git-scm.com](https://git-scm.com/) 下载）：

1. 打开 PowerShell 进入目录：
   ```powershell
   cd D:\AI\HWrase\deskaura-showcase
   ```

2. 初始化并绑定远程仓库：
   ```powershell
   # 初始化本地 git 仓库
   git init

   # 将所有文件纳入暂存区（.gitignore 会自动过滤 node_modules 与 dist）
   git add .

   # 提交
   git commit -m "feat: DeskAura showcase website"

   # 将主分支命名为 main
   git branch -M main
   ```

3. 在 GitHub 网页端（[github.com/new](https://github.com/new)）新建一个仓库，名字填写例如 `deskaura-showcase`。
4. 复制仓库链接（如 `https://github.com/你的用户名/deskaura-showcase.git`），运行推送命令：
   ```powershell
   git remote add origin https://github.com/你的用户名/deskaura-showcase.git
   git push -u origin main
   ```
   （按提示登录 GitHub 授权即可完成推送）

---

## 第三阶段：托管到 Cloudflare Pages

Cloudflare Pages 是目前全球最快且完全免费的静态网站托管平台，提供无限制带宽、全球 Anycast CDN 节点加速与自动配置 HTTPS 证书。

### 详细配置步骤

#### 1. 登录 Cloudflare 控制台
前往 [dash.cloudflare.com](https://dash.cloudflare.com/) 注册或登录你的 Cloudflare 账号。

#### 2. 进入 Pages 创建入口
- 在左侧导航栏点击 **Workers & Pages**（Workers 和 Pages）。
- 点击右上角的蓝色按钮 **Create application**（创建应用程序）。
- 切换到 **Pages** 选项卡。
- 点击 **Connect to Git**（连接到 Git）。

#### 3. 授权 GitHub 并选择仓库
- 点击 **Connect GitHub**，授权 Cloudflare 读取你的 GitHub 账号。
- 在仓库列表中勾选刚刚创建的 `deskaura-showcase`，点击 **Begin setup**（开始设置）。

#### 4. 关键构建配置（重点，严格按此填写）

在项目设置页面中填写如下信息：

| 配置项 | 填写内容 | 说明 |
| :--- | :--- | :--- |
| **Project name**（项目名称） | `deskaura-showcase` | 可自定义，决定默认域名 `deskaura-showcase.pages.dev` |
| **Production branch**（生产分支）| `main` | 默认即可 |
| **Framework preset**（框架预设） | **`Vite`** | 必须在下拉菜单选择 `Vite` |
| **Build command**（构建命令） | **`npm run build`** | 预设选择 Vite 后会自动填充 |
| **Build output directory**（构建输出目录） | **`dist`** | 必须填写 `dist` |
| **Root directory**（根目录） | `/`（留空或默认根目录） | 若仓库直接是 showcase 则留空 |

> [!NOTE]
> **Node.js 版本保障**：
> 项目根目录已为你自动生成了 `.node-version`（指定 `20.18.0`），Cloudflare Pages 构建环境会自动识别并使用 Node.js 20 编译，无需手动在后台配置环境变量。

#### 5. 点击保存并部署
点击页面最下方的 **`Save and Deploy`**（保存并部署）按钮。

Cloudflare 会自动启动容器拉取代码、执行 `npm install`、运行 `npm run build` 并分发至全球 CDN 边缘节点。
通常约 **30~60 秒** 即可完成首次部署！

部署成功后，页面会显示绿色的 **Success!**，并提供分配给你的永久免费独立访问域名，形如：
`https://deskaura-showcase.pages.dev`

---

### （可选）绑定自己的顶级域名
如果你有自己的独立域名（如 `deskaura.com`）：
1. 在 Pages 项目详情页点击 **Custom domains**（自定义域）选项卡；
2. 点击 **Set up a custom domain**；
3. 输入你的二级域名（例如 `showcase.deskaura.com`）或根域名；
4. 按照 Cloudflare 提示添加 CNAME 解析记录，通常几分钟内自动签发免费 SSL 证书生效。

---

## 第四阶段：日常更新发布流程

有了 GitHub + Cloudflare Pages 架构，以后的发布流程实现了 **100% 全自动化 CI/CD**：

1. **本地修改代码**：
   在 `deskaura-showcase` 目录下改动任何代码或图片资源；
2. **本地简单验证**：
   ```powershell
   npm run build
   ```
3. **推送到 GitHub**：
   - GitHub Desktop 用户：直接在左侧写 Commit 摘要并点击 `Push origin`；
   - 命令行用户：
     ```powershell
     git add .
     git commit -m "update: 优化界面细节"
     git push
     ```
4. **全自动上线**：
   Cloudflare 收到 GitHub Webhook 通知后，会自动在后台重新打包并全球无缝热更新，大约 40 秒后打开你的网站即可看到最新版本，无需手动上传任何文件。

---

## 常见问题与排错排查

### Q1: `npm run dev` 提示端口 5173 被占用怎么办？
**解答**：Vite 会自动递增尝试 5174、5175 端口，或者你可以在命令行指定端口：
```powershell
npm run dev -- --port 3000
```

### Q2: 上传到 GitHub 时发现把 `node_modules` 也传上去了？
**解答**：检查项目根目录的 `.gitignore` 文件是否包含 `node_modules`。如果误传，可在终端运行：
```powershell
git rm -r --cached node_modules
git commit -m "chore: remove node_modules from tracking"
git push
```

### Q3: Cloudflare Pages 构建时提示 Node 版本过低报错？
**解答**：已在项目中放置 `.node-version` 文件。如果需要手动在后台兜底，进入 Cloudflare 项目设置 -> **Settings** -> **Environment variables**，添加环境变量：
- Variable name: `NODE_VERSION`
- Value: `20`

### Q4: 网页上的实机截图或字体在线上会不会加载不出来？
**解答**：不会。所有字体和真实截图均放置在 `public/` 目录下（`public/fonts/` 与 `public/images/`），在执行 `npm run build` 时会被 Vite 完整复制到 `dist/` 根目录。经由 Cloudflare 全球 CDN 静态强缓存，首屏秒开。
