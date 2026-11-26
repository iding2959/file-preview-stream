# file-preview-stream

框架无关的文件预览内核：给一个 `Blob` / `ArrayBuffer` / `Uint8Array` / `string`，返回「这是什么文件」以及「能以什么形式呈现」。

不做 UI，不做 HTTP 取数，不绑定 React/Vue。取数、渲染容器、生命周期都是调用方的事——这里是所有框架都能复用的那一层。

## 安装

```bash
npm i file-preview-stream
```

主包零运行时依赖。重解析器按需单独安装：

```bash
npm i marked dompurify          # markdown 渲染
npm i xlsx dompurify            # Excel / CSV 渲染
npm i docx-preview              # docx 渲染
```

没装对应依赖不会报错崩掉：相应类型会降级（`kind` 变成 `text` 或 `unsupported`），`reason` 里写明缺哪个包。

## 快速开始

```ts
import { createPreview } from "file-preview-stream";

const res = await createPreview(blob, { name: "合同.pdf" });

switch (res.kind) {
	case "pdf":
	case "image":
	case "video":
	case "audio":
		el.src = res.url;          // 浏览器原生可渲染
		break;
	case "svg":
		img.src = res.url;         // 只能给 <img>：res.scriptable 为 true
		break;
	case "text":
		el.textContent = res.text; // 纯文本
		break;
	case "markdown":
	case "excel":
		el.innerHTML = res.html;   // 已净化，unsafe 为 false
		break;
	case "html":
		iframe.srcdoc = res.html;  // res.unsafe 为 true，必须走沙箱
		iframe.setAttribute("sandbox", "");
		break;
	case "docx":
		await res.render(container); // docx 需要真实 DOM
		break;
	default:
		showDownloadFallback(res.reason);
}

// 卸载时务必释放：只对 pdf/图片/音视频 生效
res.revoke();
```

React 用法：

```tsx
const [res, setRes] = useState<PreviewResult | null>(null);

useEffect(() => {
	let alive = true;
	let local: PreviewResult | null = null;
	createPreview(file, { name: file.name }).then((r) => {
		if (!alive) return r.revoke();  // 竞态：已卸载就立刻释放
		local = r;
		setRes(r);
	});
	return () => {
		alive = false;
		local?.revoke();
	};
}, [file]);
```

## 支持的格式

共 **152 个扩展名 + 28 个无扩展名固定文件名**。

| kind | 扩展名 | 产出 | 可选依赖 |
|---|---|---|---|
| `pdf` | pdf | `url` | — |
| `image` | jpg jpeg jpe jfif pjpeg pjp png apng gif webp bmp ico cur avif tif tiff | `url` | — |
| `svg` | svg svgz | `url` + **`scriptable: true`** | — |
| `video` | mp4 m4v webm ogv mov qt mpg mpeg mpe m2v avi 3gp 3g2 mkv | `url` | — |
| `audio` | mp3 wav ogg oga opus m4a weba flac aac wma mid midi amr | `url` | — |
| `docx` | docx | `render(container)` | `docx-preview` |
| `excel` | xlsx xlsm xls csv tsv | `html` | `xlsx`、`dompurify` |
| `markdown` | md markdown mdown mkd mkdn mdx | `html` | `marked`、`dompurify` |
| `html` | html htm xhtml | `html` + **`unsafe: true`** | — |
| `text` | 91 种源码/配置/日志格式，见下方 | `text` | — |
| `unsupported` | 其余 | `reason` | — |

**固定文件名**（无扩展名也能识别为 `text`）：

```
Dockerfile  Makefile  Gemfile  Rakefile  Procfile  Vagrantfile  Jenkinsfile
CMakeLists.txt  LICENSE  LICENCE  README  CHANGELOG  AUTHORS  CONTRIBUTORS
NOTICE  COPYING  TODO  .gitignore  .gitattributes  .gitmodules  .dockerignore
.npmignore  .npmrc  .editorconfig  .env  .babelrc  .eslintrc  .prettierrc
```

**`text` 覆盖的 91 种后缀**：

```
txt text log json jsonc json5 xml xsl xsd yaml yml toml ini cfg conf properties
env diff patch css scss sass less js mjs cjs jsx ts mts cts tsx vue svelte
py pyi ipynb java kt kts scala groovy go rs c h cc cpp cxx hpp cs m mm swift
rb php lua pl r dart ex exs erl hs clj scm lisp rst tex bib proto graphql gql
sql sh bash zsh fish bat cmd ps1 psm1 vbs asm s tf hcl dockerfile makefile
cmake gradle lock
```

## 安全标记

两个 kind 带额外安全语义，**不处理会出事**：

### `svg` → `scriptable: true`

SVG 是 XML，可内嵌 `<script>` 与 `onload`。它的 blob URL：

- ✅ 放进 `<img src>` —— **安全**
- ❌ 放进 `<iframe>` / `<object>` / `<embed>` —— **执行脚本**
- ❌ 塞进 `innerHTML` —— **执行脚本**

```ts
if (res.kind === "svg") {
	img.src = res.url;              // 只能这样
	// 不要：iframe.src = res.url
	// 不要：el.innerHTML = `<img src="${res.url}">` 之外的任何注入
}
```

### `html` → `unsafe: true`

默认**不净化**，返回原文。因为 HTML 邮件/网页附件依赖 `<style>`、布局、表单，严格净化会把排版整个毁掉。

```ts
if (res.kind === "html") {
	// 推荐：沙箱 iframe，禁止脚本执行
	iframe.srcdoc = res.html;
	iframe.setAttribute("sandbox", "");     // 空 sandbox = 全禁
}
```

需要净化后的片段可显式开启：

```ts
import { htmlAdapter } from "file-preview-stream/adapters/html";
registerAdapter("html", htmlAdapter({ sanitize: true }));   // 需装 dompurify
```

## API

### `createPreview(input, options?): Promise<PreviewResult>`

| 参数 | 类型 | 说明 |
|---|---|---|
| `input` | `Blob \| ArrayBuffer \| Uint8Array \| string` | 文件内容 |
| `options.name` | `string` | 文件名，优先级高于 `input.name` |
| `options.mime` | `string` | 显式 MIME，覆盖自动推断 |
| `options.kind` | `PreviewKind` | 显式指定类型，跳过推断 |
| `options.throwOnMissingDependency` | `boolean` | 缺可选依赖时抛错而非降级，默认 `false` |

`PreviewResult` 字段：

| 字段 | 说明 |
|---|---|
| `kind` | 实际呈现类型（降级后会反映真实形式） |
| `mime` / `name` / `size` | 归一化后的元信息 |
| `url` | blob URL，pdf/图片/svg/音视频 |
| `text` | 纯文本 |
| `html` | HTML 串，markdown/excel/html |
| `unsafe` | `true` 表示 `html` 未经净化，插入 DOM 前必须自行处理 |
| `scriptable` | `true` 表示内容可执行脚本（svg），只能用在 `<img>` 这类不执行脚本的位置 |
| `render` | `(container: HTMLElement) => Promise<void>`，docx |
| `reason` | 降级/失败原因 |
| `revoke` | 释放 `url`，调用方必须在不使用时调用 |

### 类型识别

```ts
import {
	detectKind, extOf, basenameOf, kindFromMime,
	supportedExts, supportedBasenames,
} from "file-preview-stream";

detectKind("a.pdf", "");                 // "pdf"
detectKind("Dockerfile");                // "text"（固定文件名）
extOf("/tmp/a.tar.gz");                  // "gz"
basenameOf("/app/Makefile");             // "makefile"
kindFromMime("image/svg+xml");           // "svg"
supportedExts();                         // 152 个扩展名
supportedBasenames();                    // 28 个固定文件名
```

识别优先级：**显式 `kind` > 固定文件名 > 扩展名 > MIME**。

- 固定文件名排在扩展名前，才能让 `Makefile` 这类无后缀文件命中。
- 扩展名优先于 MIME，因为很多服务器把附件 Content-Type 一律写成 `application/octet-stream`，扩展名更可信。

### 扩展新格式

```ts
import { registerKind, registerAdapter } from "file-preview-stream";

// 1. 加扩展名映射
registerKind("epub", "text");

// 2. 覆盖或新增处理器（返回注销函数）
const undo = registerAdapter("text", async (ctx) => {
	return { text: new TextDecoder().decode(ctx.bytes) };
});
```

也可以整体替换内置实现，比如换成企业内部的 docx 渲染器——不必 fork 这个库。

### 独立入口

想精确控制体积时，可只引某个适配器：

```ts
import { markdownAdapter } from "file-preview-stream/adapters/markdown";
import { excelAdapter } from "file-preview-stream/adapters/excel";
import { docxAdapter } from "file-preview-stream/adapters/docx";
```

```ts
registerAdapter("markdown", markdownAdapter({ breaks: false }));
registerAdapter("excel", excelAdapter({ skipSanitize: false }));
registerAdapter("docx", docxAdapter({ options: { breakPages: true } }));
```

## 设计取舍

**为什么不做「一步插入页面」的高层 API。** 取数是 HTTP 的事，承载是框架的事，卸载是组件生命周期的事。混进来等于同时绑定后端协议和前端框架，库就失去复用价值。

**为什么重解析器是可选依赖。** `xlsx` 约 900KB、`docx-preview` 约 600KB。只想预览 PDF 的人不该被迫装这些。

**为什么降级时改 `kind`。** 调用方按 `kind` 选渲染器。缺 `marked` 时若仍报 `markdown`，调用方会把未解析的原文塞进 `innerHTML`，拿到的是乱排版而不是可读文本。

**为什么默认净化 HTML。** 附件来源不可信，markdown 允许内联 HTML。DOMPurify 缺失时不静默放行，而是把 `unsafe: true` 标出来交给调用方决定。

**为什么中文 CSV 走 GBK 回退。** 中文 Windows 导出的 CSV 绝大多数是 GBK，用 UTF-8 解不会报错，只会得到满屏 U+FFFD——用户看到乱码，而不是一个明确的失败信号。

## 已知限制

- 预览纯在浏览器侧完成。Node 环境是否支持 `URL.createObjectURL` 取决于运行时版本：Node 20 及以下没有，pdf/图片/音视频分支会返回 `reason` 而非 `url`；Node 24 起已内置（产出 `blob:nodedata:` 协议）。
- DOMPurify 在 Node 侧需要 jsdom 提供 `window`，无 window 时会标记 `unsafe`。
- 不支持 pptx / ppt / zip / rar / eml / 加密 PDF；这些会识别为 `unsupported`，请提供下载兜底。
- `avi` / `mkv` / `wmv` 等已识别为 `video`，但浏览器原生不保证能播，实际可能黑屏；如遇此情况请降级为下载。
- `tsv` 归为 `excel`（表格预览更有用）。若需要按纯文本查看，用 `registerKind("tsv", "text")` 覆盖。

## License

MIT