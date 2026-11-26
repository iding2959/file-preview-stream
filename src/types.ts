/**
 * 预览内容种类。扩展名与 MIME 都会归一到这个枚举，
 * 渲染分派只认 kind，不认具体后缀——新增格式只需在注册表里加映射。
 */
export type PreviewKind =
	| "pdf"
	| "image"
	| "svg"
	| "video"
	| "audio"
	| "docx"
	| "excel"
	| "pptx"
	| "markdown"
	| "html"
	| "text"
	| "archive"
	| "eml"
	| "unsupported";

/** 输入来源：浏览器 File/Blob，或 Node 侧任意可读取对象 */
export interface PreviewSource {
	/** 文件名或路径，用于取扩展名 */
	name?: string;
	/** MIME 类型，缺失时回落到扩展名推断 */
	type?: string;
	/** 体积，用于上限判断 */
	size?: number;
}

/** 调用方传入的原始载荷。库不负责取数，只负责识别与转换 */
export type PreviewInput = Blob | ArrayBuffer | Uint8Array | string;

export interface PreviewOptions {
	/** 文件名，优先级最高（明确覆盖 input 自带的名字） */
	name?: string;
	/** 显式指定 MIME，覆盖自动推断 */
	mime?: string;
	/** 显式指定 kind，跳过推断（调用方知道得更多时用） */
	kind?: PreviewKind;
	/** 可选依赖未安装时是否抛错。默认 false：降级为 unsupported 并给出原因 */
	throwOnMissingDependency?: boolean;
	/**
	 * 递归解析包内容（archive 未压缩条目 / eml 附件）。
	 * 默认 true：调用方拿到的就是可直接展示的树。设 false 只出清单，省去逐个解析开销。
	 */
	deep?: boolean;
}

export type ArchiveEntryKind = "zip" | "rar4" | "rar5";

/**
 * 归档内的一个条目。
 *
 * `preview` 是**惰性函数**而非现成结果：一个 zip 可能含几千个文件，
 * 全部预先解析既慢又占内存，而用户通常只看其中一两个。
 */
export interface ArchiveEntry {
	/** 归档内相对路径 */
	path: string;
	/** 未压缩大小；目录为 0 */
	uncompressedSize: number;
	/** 解压失败或该条目不受支持时的原因 */
	error?: string;
	/** 是否是目录 */
	isDir: boolean;
	/** 惰性取得该条目的预览结果；调用方负责在卸载时 revoke */
	preview: () => Promise<PreviewResult>;
}

/** eml 里的一封发件人/收件人 */
export interface MailAddress {
	address: string;
	name?: string;
}

export interface MailAttachment {
	filename: string;
	mimeType: string;
	size: number;
	/** 惰性取得附件预览；调用方负责在卸载时 revoke */
	preview: () => Promise<PreviewResult>;
}

/** eml 解析出的邮件结构体，只保留预览需要的字段 */
export interface MailSummary {
	// 显式带 undefined：exactOptionalPropertyTypes 下「缺字段」与「字段为 undefined」不等价，
	// 而 postal-mime 对缺失的头一律返回 undefined，写出来才能直接赋值
	subject?: string | undefined;
	from?: MailAddress | undefined;
	to?: MailAddress[] | undefined;
	cc?: MailAddress[] | undefined;
	date?: string | undefined;
	/** 纯文本正文 */
	text?: string | undefined;
	/** HTML 正文原文（来源不可信，必须走沙箱 iframe） */
	html?: string | undefined;
	attachments: MailAttachment[];
}

/** pptx 的一页幻灯片 */
export interface PptxSlide {
	/** 第几页，从 1 开始 */
	index: number;
	/** 该页全部可见文本，按 XML 中出现顺序 */
	lines: string[];
	/** 该页引用的图片，data URL 形式（浏览器与 Node 都可直接给 <img>） */
	images: string[];
	/** 备注页文本 */
	notes?: string[] | undefined;
}

/** 预览结果：所有分支共用一个形状，调用方按 kind 取字段 */
export interface PreviewResult {
	kind: PreviewKind;
	/** 归一化后的 MIME */
	mime: string;
	/** 原始文件名 */
	name: string;
	/** 字节长度 */
	size: number;
	/** 浏览器可直接用的 blob URL：pdf / image / svg / video / audio 有值 */
	url?: string;
	/** 纯文本内容：text / markdown 原文有值 */
	text?: string;
	/** HTML 字符串：markdown / excel / html / archive / eml / pptx 有值。可能未净化，见 unsafe */
	html?: string;
	/** html 未经过 DOMPurify 净化时为 true，调用方插入 DOM 前必须自行处理 */
	unsafe?: boolean;
	/**
	 * 该内容含活动脚本风险，只能用在 <img> 之类不执行脚本的位置。
	 *
	 * svg 为 true：SVG 可内嵌 <script> 与 onload，blob URL 放进 iframe/object/embed
	 * 会执行脚本；放进 <img src> 则安全。不要把它塞进 innerHTML 或 iframe。
	 */
	scriptable?: boolean;
	/** docx 需要真实 DOM 容器，返回交给 docx-preview 的渲染函数 */
	render?: (container: HTMLElement) => Promise<void>;
	/** 降级或失败原因；kind 为 unsupported 时必有值 */
	reason?: string;

	/** archive：归档格式（zip / rar4 / rar5） */
	container?: ArchiveEntryKind;
	/** archive：条目清单。rar5 只有清单，条目的 preview 会返回不支持 */
	entries?: ArchiveEntry[];

	/** eml：解析出的邮件结构 */
	mail?: MailSummary;

	/** pptx：逐页文本与图片 */
	slides?: PptxSlide[];
	/**
	 * pptx：是否由可选的 pptx-preview 提供的**高保真**渲染器接管。
	 * 为 true 时调用方应优先用 render()，slides 只作为无 DOM 环境下的兜底。
	 */
	hiFi?: boolean;

	/**
	 * video/audio：该文件在当前环境能否原生播放。
	 * undefined 表示无法判定（如 Node 无 canPlayType），调用方应按「尝试播放」处理。
	 */
	playable?: boolean;
	/** 不可播放的具体原因，供 UI 直接展示「下载或转码」 */
	playableReason?: string;

	/** 释放 url 分配的资源。调用方必须在不使用时调用 */
	revoke: () => void;
}