import { MIME_BY_CONTAINER, sniffContainer, type ContainerFormat } from "../core/binary";

/**
 * 浏览器原生能否播放某个容器 + MIME。
 *
 * 为什么需要这一层：`<video src>` 播不了时浏览器只会发 error 事件，
 * 用户看到的是黑屏；而 avi / mkv 这类「能识别但解不了」的格式在附件场景极常见。
 * 提前给出 playable + 原因，调用方就能直接显示「下载 / 转码」而不是让人对着黑屏发呆。
 *
 * 判定只用 `canPlayType`，不做编解码探测：真要精确到 H.264 profile 得解容器，
 * 那是浏览器内部的事，前端重造只会更不准。
 */
export const canPlayMime = (mime: string): boolean | undefined => {
	const doc = (globalThis as { document?: Document }).document;
	if (!doc || typeof doc.createElement !== "function") return undefined;
	const el = doc.createElement("video");
	if (typeof el.canPlayType !== "function") return undefined;
	const verdict = el.canPlayType(mime);
	if (!verdict) return false;
	// "maybe" 也算可播：Chrome 对 webm 常返回 "maybe"，拒掉会误伤大量正常文件
	return true;
};

/** 明确已知不可播的容器，附带原因（这类判定不依赖 canPlayType，Node 侧同样有效） */
const KNOWN_UNPLAYABLE: Partial<Record<ContainerFormat, string>> = {
	avi: "AVI 容器浏览器不支持（无论内部编码是 DivX/Xvid/H.264），需要转码为 MP4",
	"ebml-mkv": "MKV（Matroska）容器浏览器不支持，需要转码为 MP4 或 WebM",
};

const MIME_TO_CONTAINER: Record<string, ContainerFormat> = {
	"video/x-msvideo": "avi",
	"video/x-matroska": "ebml-mkv",
	"video/webm": "ebml-webm",
	"video/mp4": "mp4",
	"audio/wav": "wav",
	"audio/x-wav": "wav",
	"audio/flac": "flac",
	"audio/mpeg": "mp3",
	"audio/ogg": "ogg",
};

export interface Playability {
	playable?: boolean;
	/**
	 * 不可播原因。
	 *
	 * 必须用独立字段而非 PreviewResult.reason：`reason` 在 createPreview 里是
	 * 「降级信号」，会连带改写 kind（video → unsupported）。而「不能播」并不是
	 * 降级——kind 仍然是 video，只是要提示用户转码，两件事不能混用同一个字段。
	 */
	playableReason?: string;
}

/**
 * 音视频可播性判定。
 *
 * 优先级：**真实容器魔数 > 声明 MIME**。
 * 因为扩展名与 Content-Type 都可能撒谎（.mkv 被改名为 .mp4 的情况在邮件附件里很常见），
 * 而魔数不会。嗅探不出来时才退回 MIME 询问 canPlayType。
 */
export const checkPlayability = (bytes: Uint8Array, mime: string): Playability => {
	const sniffed = sniffContainer(bytes);

	if (sniffed && KNOWN_UNPLAYABLE[sniffed]) {
		return { playable: false, playableReason: KNOWN_UNPLAYABLE[sniffed] };
	}

	// 嗅探出的是与音视频无关的容器（zip/rar/ole/pdf/位图）时，声明 MIME 一定是错的：
	// 典型场景是扩展名被改过或服务器乱填 Content-Type。此时不必再问 canPlayType，
	// 直接判定不可播并指出真实格式。
	if (sniffed && !MIME_TO_CONTAINER[MIME_BY_CONTAINER[sniffed]] && MIME_TO_CONTAINER[mime.toLowerCase()]) {
		return {
			playable: false,
			playableReason: `文件真实容器为 ${sniffed}（与声明的 ${mime} 不符），浏览器无法按音视频播放`,
		};
	}

	// EBML 的 WebM 分支是唯一真正能播的 Matroska 变体，但还要看内部编码
	const effectiveMime =
		sniffed !== undefined && MIME_BY_CONTAINER[sniffed] !== undefined
			? MIME_BY_CONTAINER[sniffed]
			: mime;
	if (!effectiveMime) return {};

	// 容器嗅探结论与声明 MIME 冲突时以嗅探为准：这是「改了后缀」的典型特征
	const sniffedName = sniffed ? MIME_TO_CONTAINER[effectiveMime] : undefined;
	const declaredName = MIME_TO_CONTAINER[mime.toLowerCase()];
	if (sniffedName && declaredName && sniffedName !== declaredName) {
		const verdict = canPlayMime(effectiveMime);
		if (verdict === false) {
			return {
				playable: false,
				playableReason: `文件真实格式为 ${effectiveMime}（与声明的 ${mime} 不一致），浏览器不支持该容器`,
			};
		}
	}

	const canPlay = canPlayMime(effectiveMime);
	if (canPlay === undefined) return {}; // Node 侧无法判定，交给调用方尝试播放
	if (!canPlay) {
		return { playable: false, playableReason: `当前浏览器不支持 ${effectiveMime}，请下载或转码后播放` };
	}
	return { playable: true };
};