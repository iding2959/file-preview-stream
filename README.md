# file-preview-stream

框架无关的文件预览内核：给一个 `Blob` / `ArrayBuffer` / `Uint8Array` / `string`，返回「这是什么文件」以及「能以什么形式呈现」。支持 PDF / 图片 / 音视频 / Word / Excel / PowerPoint / Markdown / HTML / 源码，以及 **zip 与 RAR 归档目录树** 和 **eml 邮件**。

不做 UI，不做 HTTP 取数，不绑定 React/Vue。取数、渲染容器、生命周期都是调用方的事——这里是所有框架都能复用的那一层。

## 安装

```bash
npm i file-preview-stream
```

归档与邮件的解析依赖（`fflate` / `postal-mime` / `unrar-js`）已内置进 `dependencies`，装完即用。重解析器仍按需单独安装：

```bash
npm i marked dompurify          # markdown 渲染
npm i xlsx dompurify            # Excel / CSV 渲染
npm i docx-preview              # docx 渲染
npm i pptx-preview              # pptx 高保真渲染（可选，体积大）
npm i node-unrar-js             # RAR5 解压（可选，约 200KB wasm）
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
	case "pptx":
		// hiFi 为 true 时优先走 render（视觉还原），否则用 slides 自绘大纲
		if (res.hiFi && res.render) await res.render(container);
		else el.innerHTML = res.html!;
		break;
	case "archive": {
		el.innerHTML = res.html!;               // 条目名单
		// 用户点开某项时再解析，不要预先全解
		const first = res.entries![0];
		if (first) el.appendChild(await renderEntry(first));
		break;
	}
	case "eml":
		el.innerHTML = res.html!;               // 邮件头
		iframe.srcdoc = res.mail?.html ?? "";   // 正文必须沙箱
		iframe.setAttribute("sandbox", "");
		break;
	default:
		showDownloadFallback(res.reason);
}

// 卸载时务必释放：对 url 型结果有效（pdf/图片/音视频）。
// 注意：archive/eml 子项各自返回独立结果，它们的 revoke 要单独调用
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

共 **167 个扩展名 + 28 个无扩展名固定文件名**。

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
| `pptx` | pptx potx ppsx pptm | `html` + `slides[]` | `pptx-preview`（高保真可选） |
| `archive` | zip rar 7z tar gz tgz bz2 xz | `html` + `entries[]` | `node-unrar-js`（仅 RAR5） |
| `eml` | eml mht mhtml | `html` + `mail` | — |
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

## 可选依赖

重解析器（`marked` / `xlsx` / `docx-preview` / `pptx-preview` / `dompurify`）是可选依赖。装好后需要告诉库它们在哪：

```ts
import * as XLSX from "xlsx";
import { marked } from "marked";
import DOMPurify from "dompurify";
import * as docxPreview from "docx-preview";
import { configureDependencies } from "file-preview-stream";

configureDependencies({ xlsx: XLSX, marked, dompurify: DOMPurify, docxPreview });
```

> `docxPreview` 传整个命名空间即可——适配器会依次取 `renderAsync` 和 `default.renderAsync`，两种打包形态都能命中。

也可以自定义加载策略（比如走 CDN）：

```ts
import { setDependencyLoader } from "file-preview-stream";

setDependencyLoader((name) =>
	import(/* @vite-ignore */ `https://cdn.jsdelivr.net/npm/${name}/+esm`)
);
```

**为什么不自动加载。** 字面量 `import("xlsx")` 能让打包器把依赖打进产物，但只要有一个可选依赖没装，**调用方的构建就会直接失败**（Vite/Rollup 报 `Failed to resolve import`）。变量形式不阻断构建，但浏览器无法解析裸说明符。两者不可兼得，库选择「绝不给调用方制造构建失败」，把加载权交给调用方。

`postal-mime`、`unrar-js`、`node-unrar-js` 已随主包安装，不需注入。

## 归档与邮件

### archive：目录树 + 惰性解压

`entries` 里的每一项都带 `preview()`，只有真正点开时才解析：

```ts
const { entries, container, reason } = await createPreview(file, { name: "资料.zip" });

// container: "zip" | "rar4" | "rar5"
// reason 有值时表示归档被截断或该格式不解包，可展示给用户
if (reason) showNotice(reason);

for (const e of entries ?? []) {
	if (e.isDir) continue;
	if (e.error) {
		// 单条失败（超限 / 加密）不影响其他条目
		markDisabled(e.path, e.error);
		continue;
	}
	// 点击时才真正解析这一项
	const sub = await e.preview();       // 等价于 createPreview(该条目字节, { name: e.path })
	openViewer(sub);
}
```

关闭递归解析可省开销：`createPreview(file, { name: "a.zip", deep: false })`。

#### RAR：RAR4 开箱即用，RAR5 需要可选依赖

纯 JS 解码器只覆盖 RAR4，RAR5 需要 `node-unrar-js`（官方 unrar 编译的 WASM）：

```bash
npm i node-unrar-js
```

装了就自动启用，不用改代码。浏览器里 wasm 拿不到包内路径，需要显式传入：

```ts
import { configureRar5Wasm, isRar5Available } from "file-preview-stream";

const wasm = await fetch("/unrar.wasm").then((r) => r.arrayBuffer());
configureRar5Wasm(wasm);

if (await isRar5Available()) {
	// 可以放心展示「解压」入口
}
```

没装时 RAR5 不会报错，而是 `entries` 为空、`reason` 里写明「需要 node-unrar-js」，其余格式不受影响。

### eml：邮件头 + 正文 + 附件

```ts
const res = await createPreview(file, { name: "报告.eml" });
const { subject, from, to, cc, date, text, html, attachments } = res.mail!;

// 头信息已转义，可安全 innerHTML（res.html 就是渲染好的头部表）
el.innerHTML = res.html!;

// 正文必须沙箱
bodyIframe.srcdoc = html ?? escapeToPre(text);
bodyIframe.setAttribute("sandbox", "");

// 附件同样惰性
for (const att of attachments) {
	const sub = await att.preview();      // svg/html 子项继承对应安全语义
	renderAttachment(att.filename, sub);
}
```

### pptx：默认文本大纲，可选高保真

不装任何东西也能用：`slides` 给你逐页文字、内嵌图片（data URL）和备注。

```ts
const res = await createPreview(file, { name: "方案.pptx" });

if (res.hiFi && res.render) {
	await res.render(container);            // pptx-preview 接管，视觉接近 PowerPoint
} else {
	el.innerHTML = res.html!;               // 自绘大纲
	res.slides!.forEach((s) => {
		console.log(`第 ${s.index} 页`, s.lines, s.images.length, s.notes);
	});
}
```

想开高保真：

```bash
npm i pptx-preview
```

```ts
import { registerAdapter, pptxAdapter } from "file-preview-stream";
registerAdapter("pptx", pptxAdapter({ hiFi: true }));
```

### 音视频可播性

`avi` / `mkv` 能识别但浏览器解不了。现在会明确告诉你，而不是给个黑屏：

```ts
const res = await createPreview(file, { name: "录像.mkv" });

if (res.playable === false) {
	showDownloadOrTranscode(res.playableReason);   // 已含可直接展示的中文原因
} else {
	video.src = res.url;    // true 或 undefined 都按可播处理
}
```

`playable` 的三种取值：

| 值 | 含义 | 建议动作 |
|---|---|---|
| `true` | `canPlayType` 判定可播 | 直接渲染 `<video>` |
| `false` | 容器明确不被支持（avi / mkv）或与声明 MIME 冲突 | 显示下载 / 转码入口 |
| `undefined` | 环境无法判定（Node 无 `canPlayType`） | 尝试播放，监听 `error` 事件兜底 |

判定用**魔数嗅探**而非扩展名——把 `.mkv` 改名成 `.mp4` 这类附件很常见，扩展名和 Content-Type 都可能撒谎。

## 安全标记

四个 kind 带额外安全语义，**不处理会出事**：

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

### `eml` → 正文未净化

邮件正文依赖内联 `<style>` 与 `table` 排版，净化会把它拆成散字。因此 `mail.html` 是**原文**，`unsafe: true`：

```ts
if (res.kind === "eml") {
	iframe.srcdoc = res.mail!.html ?? "";   // 必须沙箱
	iframe.setAttribute("sandbox", "");
}
```

`html` 字段（邮件头汇总）里的地址、主题、附件名**全部已转义**，可以安全 `innerHTML`。

### `archive` → 条目名已转义

`html` 里的路径都经过 HTML 转义，`unsafe: false`。但**惰性解压出的子文件可能带风险**：zip 里的 svg / html 会原样继承上一节的安全语义，递归预览时仍然要遵守。

## API

### `createPreview(input, options?): Promise<PreviewResult>`

| 参数 | 类型 | 说明 |
|---|---|---|
| `input` | `Blob \| ArrayBuffer \| Uint8Array \| string` | 文件内容 |
| `options.name` | `string` | 文件名，优先级高于 `input.name` |
| `options.mime` | `string` | 显式 MIME，覆盖自动推断 |
| `options.kind` | `PreviewKind` | 显式指定类型，跳过推断 |
| `options.throwOnMissingDependency` | `boolean` | 缺可选依赖时抛错而非降级，默认 `false` |
| `options.deep` | `boolean` | archive/eml 是否递归解析子项，默认 `true`；设 `false` 只出清单 |

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
| `render` | `(container: HTMLElement) => Promise<void>`，docx / pptx(hiFi) |
| `reason` | 降级/失败原因 |
| `container` | archive：归档格式 `zip` / `rar4` / `rar5` |
| `entries` | archive：条目清单，每项 `{ path, uncompressedSize, isDir, error?, preview() }` |
| `mail` | eml：`{ subject, from, to, cc, date, text, html, attachments[] }`，附件同样有惰性 `preview()` |
| `slides` | pptx：`{ index, lines[], images[](data URL), notes? }[]` |
| `hiFi` | pptx：`true` 表示由 pptx-preview 提供渲染，应优先用 `render()` |
| `playable` | 音视频：`true` 可播 / `false` 不可播 / `undefined` 无法判定（Node） |
| `playableReason` | 不可播放的具体原因，可直接展示给用户 |
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
supportedExts();                         // 167 个扩展名
supportedBasenames();                    // 28 个固定文件名

// 魔数嗅探：判定真实容器，绕开扩展名与 Content-Type 的谎言
import { sniffContainer, checkPlayability } from "file-preview-stream";
sniffContainer(bytes);                   // "zip" | "rar4" | "rar5" | "avi" | "ebml-mkv" | ...
checkPlayability(bytes, "video/x-msvideo");  // { playable: false, playableReason: "..." }
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
import { pptxAdapter } from "file-preview-stream";
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

**为什么 archive 条目给的是 `preview()` 函数而不是现成结果。** 一个 zip 可能含几千个文件，全部预先解析既慢又耗内存，而用户通常只看其中一两个。惰性化把成本压到「真正点开那一刻」。

**为什么「不能播」用 `playableReason` 而不是 `reason`。** `reason` 在库里是**降级信号**，会连带改写 `kind`（video → unsupported）。但 avi/mkv 播不了并不是降级——`kind` 仍应是 `video`，只是要提示用户转码。两件事混用同一字段会让调用方分支判断错位。

**为什么 RAR5 做成可选依赖而不是内置。** 纯 JS 解码器（unrar-js）只实现到 RAR 2.9，RAR5 必须上 WASM。但 207KB wasm 且要处理「浏览器拿不到包内路径」的加载问题，不该让只预览 zip 的人承担。折中方案：`optionalDependencies` 里放 `node-unrar-js`，装了就自动生效，没装就明确降级——功能可得，但成本可选。

**为什么 pptx 自研而非直接用 pptx-preview。** 后者视觉还原好，但源码闭源、硬依赖 `echarts`（打包后数 MB），与「可整体替换内置实现」的设计前提冲突。所以默认走自研的 OOXML 文本大纲（零新依赖），想要高保真的人自己 `registerAdapter("pptx", pptxAdapter({ hiFi: true }))` 覆盖。

**为什么可选依赖默认不自动加载。** 「加载可选依赖」在四种环境里的最优解互相冲突：字面量 `import("xlsx")` 能被 Packer 打进产物，但缺包时会让**调用方的构建直接失败**；变量 `import(name)` 不会阻断构建，但浏览器没有 import map，裸说明符运行时解析不了。没有一种写法能同时满足「没装不阻断构建」和「装了自动可用」。

库选择保证前者：**缺可选依赖绝不阻断调用方构建**，这是库最不该给用户添麻烦的地方。依赖通过 `configureDependencies()` 注入，或用 `setDependencyLoader()` 自定义加载策略。

**为什么中文 CSV 走 GBK 回退。** 中文 Windows 导出的 CSV 绝大多数是 GBK，用 UTF-8 解不会报错，只会得到满屏 U+FFFD——用户看到乱码，而不是一个明确的失败信号。

## 已知限制

- 预览纯在浏览器侧完成。Node 环境是否支持 `URL.createObjectURL` 取决于运行时版本：Node 20 及以下没有，pdf/图片/音视频分支会返回 `reason` 而非 `url`；Node 24 起已内置（产出 `blob:nodedata:` 协议）。
- DOMPurify 在 Node 侧需要 jsdom 提供 `window`，无 window 时会标记 `unsafe`。
- **pptx**：默认是文本大纲（逐页文字 + 内嵌图片 + 备注），不还原版式、动画、图表。旧版 `.ppt` 二进制格式不支持。需要视觉还原请装 `pptx-preview` 并注册 `pptxAdapter({ hiFi: true })`。
- **archive**：zip 完整支持（解压上限 256MB / 2000 条 / 单条 64MB，超出会截断并写进 `reason`）。RAR4 开箱可解；**RAR5 需要可选依赖 `node-unrar-js`**，未装时返回空清单 + 明确原因。`7z` / `tar` / `gz` / `bz2` / `xz` 仅识别为 `archive`，暂不解包。加密条目不解压。
- **RAR5 浏览器加载**：Node 侧自动定位包内 `unrar.wasm`；浏览器必须 `configureRar5Wasm(arrayBuffer)` 显式注入，未注入时按「后端不可用」降级。
- **eml**：`eml` 支持完整；`mht` / `mhtml` 走了同一适配器但格式差异较大，可能解析不全。
- **ppt / 加密 PDF**：仍为 `unsupported`，请提供下载兜底。
- **音视频**：`avi` / `mkv` 会返回 `playable: false` 与 `playableReason`（明确告知需转码），不再是黑屏无提示。Node 环境无 `canPlayType`，`playable` 为 `undefined`（无法判定），应按「尝试播放」处理。
- **可选依赖需显式注入**：库不会自动从 `node_modules` 解析可选依赖（见下方「可选依赖」章节）。不注入时相关类型会降级并给出 `reason`，不会崩。
- 递归解析深度上限 3 层（zip 套 zip、eml 挂 eml 之类的构造会被截断并写进 `reason`）。
- `tsv` 归为 `excel`（表格预览更有用）。若需要按纯文本查看，用 `registerKind("tsv", "text")` 覆盖。

## License

MIT
