import type { Adapter } from "../core/adapter";
import type { MailAddress, MailAttachment, PreviewResult } from "../types";
import { escapeHtml, formatBytes } from "../core/binary";

interface PostalAddress {
	address?: string;
	name?: string;
}

interface PostalAttachment {
	filename?: string;
	mimeType?: string;
	content?: ArrayBuffer | Uint8Array | string;
}

interface PostalParsed {
	subject?: string;
	from?: PostalAddress;
	to?: PostalAddress[];
	cc?: PostalAddress[];
	date?: string;
	text?: string;
	html?: string;
	attachments?: PostalAttachment[];
}

interface PostalMimeModule {
	default?: { new (): { parse: (input: ArrayBuffer | Uint8Array | string) => Promise<PostalParsed> } };
	PostalMime?: { new (): { parse: (input: ArrayBuffer | Uint8Array | string) => Promise<PostalParsed> } };
}

const toAddress = (a: PostalAddress | undefined): MailAddress | undefined => {
	if (!a?.address) return undefined;
	return a.name ? { address: a.address, name: a.name } : { address: a.address };
};

const toAddressList = (list: PostalAddress[] | undefined): MailAddress[] =>
	(list ?? []).map(toAddress).filter((a): a is MailAddress => Boolean(a));

const toBytes = (content: PostalAttachment["content"]): Uint8Array => {
	if (!content) return new Uint8Array();
	if (typeof content === "string") return new TextEncoder().encode(content);
	if (content instanceof Uint8Array) return content;
	return new Uint8Array(content);
};

/**
 * eml 处理：只把邮件拆成「头 + 正文 + 附件」，不做 MIME 树可视化。
 *
 * 关键取舍：HTML 正文原样交出并标 unsafe。邮件正文的排版全靠内联 <style>
 * 与 table，净化会把它变成一堆断续的散字；正确隔离手段是调用方的
 * <iframe sandbox>，而不是在库里猜哪些标签该留。
 */
export const emlAdapter: Adapter = async (ctx) => {
	let mod: PostalMimeModule | undefined;
	try {
		mod = (await import("postal-mime")) as PostalMimeModule;
	} catch {
		mod = undefined;
	}
	const Ctor = mod?.PostalMime ?? mod?.default;
	if (!Ctor) {
		return { reason: "预览 eml 需要依赖 postal-mime，例如: npm i postal-mime" };
	}

	const parser = new Ctor();
	const parsed = await parser.parse(ctx.bytes);

	const attachments: MailAttachment[] = (parsed.attachments ?? []).map((a, i) => {
		const filename = a.filename || `attachment-${i + 1}`;
		const mimeType = a.mimeType || "application/octet-stream";
		const bytes = toBytes(a.content);
		return {
			filename,
			mimeType,
			size: bytes.byteLength,
			// 附件预览同样惰性：一封邮件挂 20 个附件时不该在首屏全解析
			preview: async (): Promise<PreviewResult> => ctx.preview(bytes, { ...ctx.options, name: filename }),
		};
	});

	return {
		html: renderMailHtml({
			subject: parsed.subject,
			from: toAddress(parsed.from),
			to: toAddressList(parsed.to),
			cc: toAddressList(parsed.cc),
			date: parsed.date,
			text: parsed.text,
			hasHtml: Boolean(parsed.html),
			attachments,
		}),
		// 头信息全部转义过，但正文 HTML 未净化——来源不可信，必须由调用方沙箱化
		unsafe: Boolean(parsed.html),
		mail: {
			subject: parsed.subject,
			from: toAddress(parsed.from),
			to: toAddressList(parsed.to),
			cc: toAddressList(parsed.cc),
			date: parsed.date,
			text: parsed.text,
			html: parsed.html,
			attachments,
		},
	};
};

const formatAddress = (a: MailAddress): string =>
	a.name ? `${escapeHtml(a.name)} &lt;${escapeHtml(a.address)}&gt;` : escapeHtml(a.address);

interface MailHeaderParts {
	subject?: string | undefined;
	from?: MailAddress | undefined;
	to: MailAddress[];
	cc: MailAddress[];
	date?: string | undefined;
	text?: string | undefined;
	hasHtml: boolean;
	attachments: MailAttachment[];
}

/**
 * 邮件头渲染成 HTML。正文与附件只出「承诺入口」不内嵌：
 * 正文 HTML 由调用方自己放进沙箱 iframe，附件由调用方点开再 preview()。
 */
const renderMailHtml = (h: MailHeaderParts): string => {
	const rows: string[] = [];
	if (h.subject) rows.push(`<tr><th>主题</th><td>${escapeHtml(h.subject)}</td></tr>`);
	if (h.from) rows.push(`<tr><th>发件人</th><td>${formatAddress(h.from)}</td></tr>`);
	if (h.to.length) rows.push(`<tr><th>收件人</th><td>${h.to.map(formatAddress).join(", ")}</td></tr>`);
	if (h.cc.length) rows.push(`<tr><th>抄送</th><td>${h.cc.map(formatAddress).join(", ")}</td></tr>`);
	if (h.date) rows.push(`<tr><th>时间</th><td>${escapeHtml(h.date)}</td></tr>`);

	const atts = h.attachments
		.map(
			(a, i) =>
				`<li data-index="${i}" data-mime="${escapeHtml(a.mimeType)}">` +
				`${escapeHtml(a.filename)} <span data-size>${escapeHtml(formatBytes(a.size))}</span></li>`
		)
		.join("");

	return (
		`<div class="fps-mail" data-attachments="${h.attachments.length}" data-body="${h.hasHtml ? "html" : "text"}">` +
		`<table class="fps-mail-head"><tbody>${rows.join("")}</tbody></table>` +
		(h.text ? `<pre class="fps-mail-text">${escapeHtml(h.text)}</pre>` : "") +
		(atts ? `<ul class="fps-mail-attachments">${atts}</ul>` : "") +
		`</div>`
	);
};

export type { MailAddress, MailAttachment } from "../types";