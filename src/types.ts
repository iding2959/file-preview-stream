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
	| "markdown"
	| "html"
	| "text"
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
	/** HTML 字符串：markdown / excel / html 有值。可能未净化，见 unsafe */
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
	/** 释放 url 分配的资源。调用方必须在不使用时调用 */
	revoke: () => void;
}