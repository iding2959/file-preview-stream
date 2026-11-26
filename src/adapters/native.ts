import { decodeText, looksLikeCsv, toBlob } from "../core/binary";
import { missingDependencyReason, type Adapter, type AdapterContext } from "../core/adapter";
import type { PreviewResult } from "../types";

/** 生成 blob URL 的分支共用：Node 侧没有 createObjectURL，降级为无 url */
const canCreateObjectURL = (): boolean =>
	typeof URL !== "undefined" && typeof URL.createObjectURL === "function";

const asBlobUrl = async (ctx: AdapterContext): Promise<string | undefined> => {
	if (!canCreateObjectURL()) return undefined;
	return URL.createObjectURL(await ctx.blob());
};

const noObjectUrlReason =
	"当前环境不支持 URL.createObjectURL（多见于 Node/非浏览器运行时），请改用返回的 bytes 自行渲染";

/**
 * 原生可渲染类型（pdf/图片/音视频）的处理：浏览器直接甩给对应元素，
 * 不在这里做任何解析——解析这些格式是浏览器的事，库插手只会更慢更差。
 */
export const nativeAdapter: Adapter = async (ctx) => {
	const url = await asBlobUrl(ctx);
	if (!url) return { reason: noObjectUrlReason };
	return { url };
};

/**
 * 纯文本处理。这里不做语法高亮：高亮需要引入 prism/highlight.js，
 * 属于展示层选择，不该压在核心库里。
 */
export const textAdapter: Adapter = async (ctx) => {
	const { text } = decodeText(ctx.bytes);
	return { text };
};

export const unsupportedAdapter: Adapter = async () => ({
	reason: "该文件类型暂不支持预览",
});

export const releaseUrl = (url: string | undefined): void => {
	if (url && canCreateObjectURL()) URL.revokeObjectURL(url);
};

export type { PreviewResult };
export { decodeText, looksLikeCsv, toBlob, missingDependencyReason };