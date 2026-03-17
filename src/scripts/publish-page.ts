/**
 * 发布中心页面逻辑 — 纯文章编辑器
 *
 * - VSCode 风格双栏布局（左编辑、右实时预览）
 * - 封面裁剪上传 + 正文粘贴即上传
 * - 所有上传暂存本地、发布时统一上传
 */

import {
    emitAuthState,
    getAuthState,
    subscribeAuthState,
    type AuthState,
} from "@/scripts/auth-state";
import { setupCodeCopyDelegation } from "@/scripts/code-copy";
import { showAuthRequiredDialog } from "@/scripts/dialogs";
import { refreshGithubCards } from "@/scripts/github-card-runtime";
import { ImageCropModal } from "@/scripts/image-crop-modal";
import {
    MarkdownPreviewClient,
    normalizeMarkdownPreviewHtml,
} from "@/scripts/markdown-preview-client";
import { SaveProgressOverlay } from "@/scripts/save-progress-overlay";
import {
    ARTICLE_TITLE_MAX,
    charWeight,
    weightedCharLength,
} from "@/constants/text-limits";
import I18nKey from "@/i18n/i18nKey";
import { requestApi as api } from "@/scripts/http-client";
import { t, tFmt } from "@/scripts/i18n-runtime";
import { buildOwnerArticlePasswordStorageKeys } from "@/utils/protected-content";
import { generateClientShortId } from "@/utils/short-id";

type PendingUpload = {
    file: File;
    localUrl: string; // URL.createObjectURL()
    purpose: "cover" | "inline";
    fileName: string; // "{shortId}-cover.jpg" or "{shortId}-1.jpg"
};

type ToolbarAction =
    | "bold"
    | "italic"
    | "underline"
    | "strike"
    | "quote"
    | "inline-code"
    | "code-block";

type PublishRuntimeWindow = Window &
    typeof globalThis & {
        renderMermaidDiagrams?: () => Promise<void>;
    };

// ── 常量 ──

const TOOLBAR_ACTIONS = new Set<ToolbarAction>([
    "bold",
    "italic",
    "underline",
    "strike",
    "quote",
    "inline-code",
    "code-block",
]);

const COVER_OUTPUT_WIDTH = 960;
const COVER_OUTPUT_HEIGHT = 576;
const TITLE_TOO_LONG_MESSAGE = tFmt(I18nKey.publishTitleMaxLength, {
    max: ARTICLE_TITLE_MAX,
});
const DEFAULT_BODY_PLACEHOLDER = t(I18nKey.publishBodyPlaceholder);
const DEFAULT_ENCRYPT_HINT = t(I18nKey.publishEncryptHintDefault);
const EXISTING_ENCRYPT_HINT = t(I18nKey.publishEncryptHintExisting);

const PROTECTED_VERSION_PREFIX = "CL2:";
const PROTECTED_MARKER = "CIALLI-VERIFY:";
const PROTECTED_PBKDF2_ITERATIONS = 210_000;
const PROTECTED_SALT_BYTES = 16;
const PROTECTED_IV_BYTES = 12;

type ProtectedPayloadV2 = {
    v: 2;
    alg: "AES-GCM";
    kdf: "PBKDF2";
    hash: "SHA-256";
    it: number;
    s: string;
    iv: string;
    ct: string;
};

type ProtectedArticlePlaintext = {
    format: "article-md-v1";
    markdown: string;
    html: string;
};

// ── 工具函数 ──

function toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function toStringValue(value: unknown): string {
    if (typeof value === "string") {
        return value.trim();
    }
    return "";
}

function toNullableString(value: unknown): string | null {
    const normalized = toStringValue(value);
    return normalized || null;
}

function toBooleanValue(value: unknown, fallback: boolean): boolean {
    if (typeof value === "boolean") {
        return value;
    }
    return fallback;
}

function toStringArrayValue(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .map((entry) => toStringValue(entry))
            .filter((entry) => Boolean(entry));
    }
    if (typeof value === "string") {
        return value
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
    }
    return [];
}

function csvToArray(raw: string): string[] {
    return raw
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function arrayToCsv(values: string[]): string {
    return values.join(", ");
}

function getApiMessage(
    data: Record<string, unknown> | null,
    fallback: string,
): string {
    const error = data?.error as Record<string, unknown> | undefined;
    const message = toStringValue(error?.message);
    return message || fallback;
}

function extractUploadFileId(data: Record<string, unknown> | null): string {
    const file = toRecord(data?.file);
    const idFromFile = toStringValue(file?.id);
    if (idFromFile) {
        return idFromFile;
    }
    return toStringValue(data?.id);
}

function buildDirectusAssetPreview(fileId: string): string {
    const normalized = String(fileId || "").trim();
    if (!normalized) {
        return "";
    }
    return `/api/v1/public/assets/${encodeURIComponent(normalized)}?width=960&height=540&fit=cover`;
}

function isToolbarAction(value: string): value is ToolbarAction {
    return TOOLBAR_ACTIONS.has(value as ToolbarAction);
}

function getImageFileExt(file: File): string {
    const mimeMap: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/gif": "gif",
        "image/webp": "webp",
        "image/avif": "avif",
    };
    return mimeMap[file.type] || "jpg";
}

function isProtectedContentBody(value: string): boolean {
    return String(value || "")
        .trim()
        .startsWith(PROTECTED_VERSION_PREFIX);
}

function toBase64Url(value: Uint8Array | string): string {
    const sourceBytes =
        typeof value === "string" ? new TextEncoder().encode(value) : value;
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < sourceBytes.length; i += chunkSize) {
        binary += String.fromCharCode(
            ...sourceBytes.subarray(i, i + chunkSize),
        );
    }
    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function fromBase64Url(input: string): Uint8Array {
    const normalized = String(input || "")
        .replace(/-/g, "+")
        .replace(/_/g, "/");
    const padLength =
        normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
    const padded = normalized + "=".repeat(padLength);
    const binary = atob(padded);
    const outputBuffer = new ArrayBuffer(binary.length);
    const output = new Uint8Array(outputBuffer);
    for (let i = 0; i < binary.length; i += 1) {
        output[i] = binary.charCodeAt(i);
    }
    return output;
}

function toStrictArrayBuffer(input: Uint8Array): ArrayBuffer {
    const { buffer, byteOffset, byteLength } = input;
    return buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer;
}

function createProtectedArticlePlaintext(
    markdown: string,
    html: string,
): string {
    return JSON.stringify({
        format: "article-md-v1",
        markdown,
        html,
    });
}

function resolveProtectedArticleMarkdown(
    raw: string,
): ProtectedArticlePlaintext {
    const parsed = JSON.parse(String(raw || ""));
    if (
        !parsed ||
        typeof parsed !== "object" ||
        parsed.format !== "article-md-v1" ||
        typeof parsed.markdown !== "string" ||
        typeof parsed.html !== "string"
    ) {
        throw new Error("INVALID_PROTECTED_CONTENT");
    }
    return parsed as ProtectedArticlePlaintext;
}

function isWrongProtectedPasswordError(error: unknown): boolean {
    if (error instanceof DOMException && error.name === "OperationError") {
        return true;
    }
    if (!(error instanceof Error)) {
        return false;
    }
    return error.message === "PASSWORD_INVALID";
}

async function deriveProtectedAesKey(
    password: string,
    salt: Uint8Array,
): Promise<CryptoKey> {
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveKey"],
    );
    return await window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            hash: "SHA-256",
            salt: toStrictArrayBuffer(salt),
            iterations: PROTECTED_PBKDF2_ITERATIONS,
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt"],
    );
}

async function encryptArticleBody(
    markdown: string,
    html: string,
    password: string,
): Promise<string> {
    if (!window.crypto?.subtle) {
        throw new Error(t(I18nKey.publishEncryptUnsupported));
    }
    const cleanPassword = String(password || "").trim();
    if (!cleanPassword) {
        throw new Error(t(I18nKey.publishPasswordRequired));
    }

    const plaintext = `${PROTECTED_MARKER}${createProtectedArticlePlaintext(markdown, html)}`;
    const salt = window.crypto.getRandomValues(
        new Uint8Array(PROTECTED_SALT_BYTES),
    );
    const iv = window.crypto.getRandomValues(
        new Uint8Array(PROTECTED_IV_BYTES),
    );
    const key = await deriveProtectedAesKey(cleanPassword, salt);
    const encrypted = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: toStrictArrayBuffer(iv) },
        key,
        new TextEncoder().encode(plaintext),
    );
    const payload: ProtectedPayloadV2 = {
        v: 2,
        alg: "AES-GCM",
        kdf: "PBKDF2",
        hash: "SHA-256",
        it: PROTECTED_PBKDF2_ITERATIONS,
        s: toBase64Url(salt),
        iv: toBase64Url(iv),
        ct: toBase64Url(new Uint8Array(encrypted)),
    };

    return `${PROTECTED_VERSION_PREFIX}${toBase64Url(JSON.stringify(payload))}`;
}

async function decryptArticleBodyWithPassword(
    encryptedBody: string,
    password: string,
): Promise<string> {
    if (!window.crypto?.subtle) {
        throw new Error(t(I18nKey.publishDecryptUnsupported));
    }
    if (!isProtectedContentBody(encryptedBody)) {
        throw new Error("UNSUPPORTED_FORMAT");
    }
    const cleanPassword = String(password || "").trim();
    if (!cleanPassword) {
        throw new Error("PASSWORD_REQUIRED");
    }

    const encodedPayload = String(encryptedBody).slice(
        PROTECTED_VERSION_PREFIX.length,
    );
    const payloadJson = new TextDecoder().decode(fromBase64Url(encodedPayload));
    const payload = JSON.parse(payloadJson) as Partial<ProtectedPayloadV2>;
    if (
        payload.v !== 2 ||
        payload.kdf !== "PBKDF2" ||
        payload.alg !== "AES-GCM" ||
        typeof payload.it !== "number" ||
        !payload.s ||
        !payload.iv ||
        !payload.ct
    ) {
        throw new Error("INVALID_PAYLOAD");
    }

    const keyMaterial = await window.crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(cleanPassword),
        { name: "PBKDF2" },
        false,
        ["deriveKey"],
    );
    const key = await window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            hash: "SHA-256",
            salt: toStrictArrayBuffer(fromBase64Url(payload.s)),
            iterations: payload.it,
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"],
    );
    const decrypted = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: toStrictArrayBuffer(fromBase64Url(payload.iv)) },
        key,
        toStrictArrayBuffer(fromBase64Url(payload.ct)),
    );
    const plaintext = new TextDecoder().decode(decrypted);
    if (!plaintext.startsWith(PROTECTED_MARKER)) {
        throw new Error("PASSWORD_INVALID");
    }
    return plaintext.slice(PROTECTED_MARKER.length);
}

async function refreshMarkdownRuntime(
    runtimeWindow: PublishRuntimeWindow,
): Promise<void> {
    setupCodeCopyDelegation();
    try {
        await refreshGithubCards();
    } catch (error) {
        console.warn("[publish] refresh github cards failed:", error);
    }
    if (typeof runtimeWindow.renderMermaidDiagrams === "function") {
        try {
            await runtimeWindow.renderMermaidDiagrams();
        } catch (error) {
            console.warn("[publish] refresh mermaid failed:", error);
        }
    }
}

// ── 主函数 ──

export function initPublishPage(): void {
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    const isNewPage = path === "/posts/new";
    const editMatch = path.match(/^\/posts\/([^/]+)\/edit$/);
    if (!isNewPage && !editMatch) {
        return;
    }

    const root = document.getElementById("publish-root");
    if (!root || root.dataset.publishBound === "1") {
        return;
    }
    root.dataset.publishBound = "1";

    const runtimeWindow = window as PublishRuntimeWindow;

    // ── DOM 引用 ──

    const workspaceEl = document.getElementById("publish-workspace");
    const currentHintEl = document.getElementById("publish-current-hint");
    const editorTitleEl = document.getElementById("publish-editor-title");
    const previewErrorEl = document.getElementById("publish-preview-error");
    const previewContentEl = document.getElementById("publish-preview-content");
    const previewScrollEl = document.getElementById("publish-preview-scroll");
    const toolbarEl = document.getElementById("publish-toolbar");
    const submitMsgEl = document.getElementById("publish-submit-msg");
    const submitErrorEl = document.getElementById("publish-submit-error");
    const savePublishedBtn = document.getElementById(
        "publish-save-published",
    ) as HTMLButtonElement | null;

    // 封面
    const coverCropBtn = document.getElementById(
        "publish-cover-crop-btn",
    ) as HTMLButtonElement | null;
    const coverClearBtn = document.getElementById(
        "publish-cover-clear-btn",
    ) as HTMLButtonElement | null;
    const coverMsgEl = document.getElementById("publish-cover-msg");
    const coverPreviewWrapEl = document.getElementById(
        "publish-cover-preview-wrap",
    );
    const coverPreviewEl = document.getElementById(
        "publish-cover-preview",
    ) as HTMLImageElement | null;

    // 文章表单
    const articleTitleInput = document.getElementById(
        "publish-article-title",
    ) as HTMLInputElement | null;
    const articleTitleHintEl = document.getElementById(
        "publish-article-title-hint",
    );
    const articleSummaryInput = document.getElementById(
        "publish-article-summary",
    ) as HTMLTextAreaElement | null;
    const articleBodyInput = document.getElementById(
        "publish-article-body",
    ) as HTMLTextAreaElement | null;
    const articleCoverUrlInput = document.getElementById(
        "publish-article-cover-url",
    ) as HTMLInputElement | null;
    const articleTagsInput = document.getElementById(
        "publish-article-tags",
    ) as HTMLInputElement | null;
    const articleCategoryInput = document.getElementById(
        "publish-article-category",
    ) as HTMLInputElement | null;
    const articleAllowCommentsInput = document.getElementById(
        "publish-article-allow-comments",
    ) as HTMLInputElement | null;
    const articleIsPublicInput = document.getElementById(
        "publish-article-is-public",
    ) as HTMLInputElement | null;
    const articleEncryptEnabledInput = document.getElementById(
        "publish-article-encrypt-enabled",
    ) as HTMLInputElement | null;
    const articleEncryptPanelEl = document.getElementById(
        "publish-article-encrypt-panel",
    );
    const articleEncryptPasswordInput = document.getElementById(
        "publish-article-encrypt-password",
    ) as HTMLInputElement | null;
    const articleEncryptHintEl = document.getElementById(
        "publish-article-encrypt-hint",
    );

    if (
        !workspaceEl ||
        !editorTitleEl ||
        !toolbarEl ||
        !submitMsgEl ||
        !submitErrorEl ||
        !savePublishedBtn ||
        !articleTitleInput ||
        !articleSummaryInput ||
        !articleBodyInput ||
        !articleCoverUrlInput ||
        !articleTagsInput ||
        !articleCategoryInput ||
        !articleAllowCommentsInput ||
        !articleIsPublicInput ||
        !articleEncryptEnabledInput ||
        !articleEncryptPanelEl ||
        !articleEncryptPasswordInput
    ) {
        console.warn("[publish] required dom nodes missing");
        return;
    }

    // ── 状态 ──

    const initialIdFromUrl = root.dataset.articleId || "";

    const clientShortId = generateClientShortId();
    const previewClient = new MarkdownPreviewClient("article");
    const saveOverlay = new SaveProgressOverlay();
    const pendingUploads = new Map<string, PendingUpload>();
    let inlineImageCounter = 0;

    let currentItemId = "";
    let currentCoverFileId = ""; // 已有的服务端封面 file ID
    let currentUsername = "";
    let isLoggedIn = false;
    let previewError = "";
    let previewHtml = "";
    let previewSource = "";
    let previewDirty = false;
    let renderedPreviewHtml = "";
    let previewGeneration = 0;
    let previewFastTimer: number | null = null;
    let previewFullTimer: number | null = null;
    let initializedAfterLogin = false;
    let loadedEncryptedBody = "";
    let loadedEncryptedBodyUnlocked = false;

    // ── UI 辅助 ──

    const setSubmitError = (message: string): void => {
        if (!message) {
            submitErrorEl.textContent = "";
            submitErrorEl.classList.add("hidden");
            return;
        }
        submitErrorEl.textContent = message;
        submitErrorEl.classList.remove("hidden");
    };

    const setSubmitMessage = (message: string): void => {
        submitMsgEl.textContent = message;
    };

    const setCoverMessage = (message: string): void => {
        if (coverMsgEl) coverMsgEl.textContent = message;
    };

    const persistOwnerPassword = (
        password: string,
        item: Record<string, unknown> | null,
    ): void => {
        const cleanPassword = toStringValue(password);
        if (!cleanPassword) {
            return;
        }
        const keys = buildOwnerArticlePasswordStorageKeys({
            id: toStringValue(item?.id) || currentItemId,
            shortId: toStringValue(item?.short_id) || currentItemShortId,
            slug: toStringValue(item?.slug),
        });
        if (keys.length === 0) {
            return;
        }
        try {
            for (const key of keys) {
                sessionStorage.setItem(key, cleanPassword);
            }
        } catch (error) {
            console.warn("[publish] persist owner password failed:", error);
        }
    };

    const updateEncryptHint = (): void => {
        if (!articleEncryptHintEl) {
            return;
        }
        if (!articleEncryptEnabledInput.checked) {
            articleEncryptHintEl.textContent = DEFAULT_ENCRYPT_HINT;
            return;
        }
        if (loadedEncryptedBody && !loadedEncryptedBodyUnlocked) {
            articleEncryptHintEl.textContent = t(
                I18nKey.publishEncryptHintLocked,
            );
            return;
        }
        if (
            loadedEncryptedBody &&
            !String(articleBodyInput.value || "").trim()
        ) {
            articleEncryptHintEl.textContent = EXISTING_ENCRYPT_HINT;
            return;
        }
        articleEncryptHintEl.textContent = DEFAULT_ENCRYPT_HINT;
    };

    const updateEncryptPanel = (): void => {
        const enabled = articleEncryptEnabledInput.checked;
        articleEncryptPanelEl.classList.toggle("hidden", !enabled);
        if (!enabled) {
            articleEncryptPasswordInput.value = "";
        }
        updateEncryptHint();
    };

    const trimToWeightedMax = (value: string, max: number): string => {
        let total = 0;
        let result = "";
        for (const ch of value) {
            const nextWeight = charWeight(ch);
            if (total + nextWeight > max) {
                break;
            }
            result += ch;
            total += nextWeight;
        }
        return result;
    };

    const updateTitleHint = (): void => {
        if (!articleTitleHintEl) {
            return;
        }
        const current = weightedCharLength(
            String(articleTitleInput.value || ""),
        );
        articleTitleHintEl.textContent = `${current}/${ARTICLE_TITLE_MAX}`;
        articleTitleHintEl.classList.toggle(
            "text-red-500",
            current > ARTICLE_TITLE_MAX,
        );
        articleTitleHintEl.classList.toggle(
            "text-60",
            current <= ARTICLE_TITLE_MAX,
        );
    };

    const enforceTitleLength = (): void => {
        const raw = String(articleTitleInput.value || "");
        const limited = trimToWeightedMax(raw, ARTICLE_TITLE_MAX);
        if (raw !== limited) {
            articleTitleInput.value = limited;
            setSubmitError(TITLE_TOO_LONG_MESSAGE);
        }
        updateTitleHint();
    };

    const updateEditorHeader = (): void => {
        if (currentItemId) {
            editorTitleEl.textContent = t(I18nKey.publishEditorTitleEdit);
            if (currentHintEl) {
                currentHintEl.textContent = t(I18nKey.publishEditorHintEdit);
            }
            return;
        }
        editorTitleEl.textContent = t(I18nKey.publishEditorTitleCreate);
        if (currentHintEl) {
            currentHintEl.textContent = t(I18nKey.publishEditorHintCreate);
        }
    };

    let currentItemShortId = "";

    const updateUrlState = (): void => {
        if (currentItemShortId) {
            const nextUrl = `/posts/${encodeURIComponent(currentItemShortId)}/edit`;
            window.history.replaceState(null, "", nextUrl);
        }
    };

    // ── 封面预览 ──

    const updateCoverPreview = (): void => {
        if (!coverPreviewWrapEl || !coverPreviewEl) return;
        // 优先显示本地暂存封面
        const pendingCover = Array.from(pendingUploads.values()).find(
            (p) => p.purpose === "cover",
        );
        if (pendingCover) {
            coverPreviewEl.src = pendingCover.localUrl;
            coverPreviewWrapEl.classList.remove("hidden");
            return;
        }
        // 已有服务端封面
        if (currentCoverFileId) {
            coverPreviewEl.src = buildDirectusAssetPreview(currentCoverFileId);
            coverPreviewWrapEl.classList.remove("hidden");
            return;
        }
        // 外部 URL
        const externalUrl = toStringValue(articleCoverUrlInput.value);
        if (externalUrl) {
            coverPreviewEl.src = externalUrl;
            coverPreviewWrapEl.classList.remove("hidden");
            return;
        }
        coverPreviewWrapEl.classList.add("hidden");
        coverPreviewEl.src = "";
    };

    // ── 实时预览 ──

    const renderPreview = (): void => {
        if (!previewErrorEl || !previewContentEl) {
            return;
        }
        if (previewError) {
            previewErrorEl.textContent = previewError;
            previewErrorEl.classList.remove("hidden");
        } else {
            previewErrorEl.textContent = "";
            previewErrorEl.classList.add("hidden");
        }
        if (previewHtml) {
            if (renderedPreviewHtml !== previewHtml) {
                previewContentEl.innerHTML = previewHtml;
                renderedPreviewHtml = previewHtml;
                void refreshMarkdownRuntime(runtimeWindow);
            }
            previewContentEl.classList.remove("hidden");
            return;
        }
        previewContentEl.innerHTML = "";
        renderedPreviewHtml = "";
        previewContentEl.classList.add("hidden");
    };

    const resetPreviewState = (): void => {
        previewSource = "";
        previewHtml = "";
        previewError = "";
        previewDirty = false;
        previewGeneration += 1;
        previewClient.resetIncrementalState();
        if (previewFastTimer !== null) {
            window.clearTimeout(previewFastTimer);
            previewFastTimer = null;
        }
        if (previewFullTimer !== null) {
            window.clearTimeout(previewFullTimer);
            previewFullTimer = null;
        }
        renderPreview();
    };

    const schedulePreview = (): void => {
        if (previewFastTimer !== null) {
            window.clearTimeout(previewFastTimer);
        }
        if (previewFullTimer !== null) {
            window.clearTimeout(previewFullTimer);
        }
        const generation = previewGeneration;
        const fastDelay = previewClient.getFastDebounceDelay();
        const fullDelay = previewClient.getFullDebounceDelay();
        previewFastTimer = window.setTimeout(() => {
            previewFastTimer = null;
            void requestPreview("fast", generation);
        }, fastDelay);
        previewFullTimer = window.setTimeout(() => {
            previewFullTimer = null;
            void requestPreview("full", generation);
        }, fullDelay);
    };

    const markPreviewDirty = (): void => {
        previewDirty = true;
        previewGeneration += 1;
        schedulePreview();
    };

    const requestPreview = async (
        mode: "fast" | "full",
        generation: number,
        force = false,
    ): Promise<void> => {
        if (generation !== previewGeneration) {
            return;
        }
        const source = String(articleBodyInput.value || "");
        const trimmed = source.trim();
        if (
            !force &&
            mode === "fast" &&
            !previewDirty &&
            source === previewSource
        ) {
            return;
        }
        if (!trimmed) {
            previewSource = source;
            previewHtml = "";
            previewError = "";
            previewDirty = false;
            renderPreview();
            return;
        }
        if (!isLoggedIn) {
            previewSource = source;
            previewHtml = "";
            previewError = t(I18nKey.publishPreviewLoginRequired);
            previewDirty = false;
            renderPreview();
            return;
        }

        previewError = "";

        if (mode === "fast") {
            const incrementalHtml = previewClient.getIncrementalPreview(source);
            if (incrementalHtml) {
                previewHtml = incrementalHtml;
            }
        }
        renderPreview();

        try {
            const result = await previewClient.preview(source, { force, mode });
            if (generation !== previewGeneration) {
                return;
            }
            if (result.aborted) {
                return;
            }
            if (result.unauthorized) {
                emitAuthState({
                    isLoggedIn: false,
                    isAdmin: false,
                    userId: "",
                    username: "",
                });
                previewHtml = "";
                previewError = t(I18nKey.publishPreviewLoginRequired);
                previewDirty = true;
                return;
            }
            if (result.error) {
                previewError = result.error;
                previewDirty = true;
                return;
            }
            previewSource = source;
            previewHtml = normalizeMarkdownPreviewHtml(result.html);
            previewError = "";
            if (mode === "full") {
                previewDirty = false;
            }
        } catch (error) {
            console.error("[publish] preview failed:", error);
            if (generation !== previewGeneration) {
                return;
            }
            previewHtml = "";
            previewError = t(I18nKey.publishPreviewFailedRetry);
            previewDirty = true;
        } finally {
            if (generation === previewGeneration) {
                renderPreview();
            }
        }
    };

    // ── 工具栏操作 ──

    const replaceSelection = (
        textarea: HTMLTextAreaElement,
        replacement: string,
        selectionStartOffset: number,
        selectionEndOffset: number,
    ): void => {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const source = textarea.value;
        const before = source.slice(0, start);
        const after = source.slice(end);
        textarea.value = `${before}${replacement}${after}`;
        const nextStart = before.length + selectionStartOffset;
        const nextEnd = before.length + selectionEndOffset;
        textarea.focus();
        textarea.setSelectionRange(nextStart, nextEnd);
        markPreviewDirty();
    };

    const applyWrapAction = (
        textarea: HTMLTextAreaElement,
        prefix: string,
        suffix: string,
        placeholder: string,
    ): void => {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selected = textarea.value.slice(start, end);
        const content = selected || placeholder;
        const replacement = `${prefix}${content}${suffix}`;
        replaceSelection(
            textarea,
            replacement,
            prefix.length,
            prefix.length + content.length,
        );
    };

    const applyQuoteAction = (textarea: HTMLTextAreaElement): void => {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selected = textarea.value.slice(start, end);
        const source = selected || t(I18nKey.publishToolbarQuotePlaceholder);
        const quoted = source
            .replaceAll("\r\n", "\n")
            .split("\n")
            .map((line) => (line.startsWith("> ") ? line : `> ${line}`))
            .join("\n");
        replaceSelection(textarea, quoted, 0, quoted.length);
    };

    const applyCodeBlockAction = (textarea: HTMLTextAreaElement): void => {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const source = textarea.value;
        const selected =
            source.slice(start, end) ||
            t(I18nKey.publishToolbarCodeBlockPlaceholder);
        const language = "text";
        const block = `\`\`\`${language}\n${selected}\n\`\`\``;
        const needsLeadingBreak = start > 0 && source[start - 1] !== "\n";
        const needsTrailingBreak = end < source.length && source[end] !== "\n";
        const prefix = needsLeadingBreak ? "\n" : "";
        const suffix = needsTrailingBreak ? "\n" : "";
        const replacement = `${prefix}${block}${suffix}`;
        const contentStart = prefix.length + `\`\`\`${language}\n`.length;
        const contentEnd = contentStart + selected.length;
        replaceSelection(textarea, replacement, contentStart, contentEnd);
    };

    const applyToolbarAction = (action: ToolbarAction): void => {
        if (action === "bold") {
            applyWrapAction(
                articleBodyInput,
                "**",
                "**",
                t(I18nKey.publishToolbarBoldPlaceholder),
            );
            return;
        }
        if (action === "italic") {
            applyWrapAction(
                articleBodyInput,
                "*",
                "*",
                t(I18nKey.publishToolbarItalicPlaceholder),
            );
            return;
        }
        if (action === "underline") {
            applyWrapAction(
                articleBodyInput,
                "<u>",
                "</u>",
                t(I18nKey.publishToolbarUnderlinePlaceholder),
            );
            return;
        }
        if (action === "strike") {
            applyWrapAction(
                articleBodyInput,
                "~~",
                "~~",
                t(I18nKey.publishToolbarStrikePlaceholder),
            );
            return;
        }
        if (action === "quote") {
            applyQuoteAction(articleBodyInput);
            return;
        }
        if (action === "inline-code") {
            applyWrapAction(
                articleBodyInput,
                "`",
                "`",
                t(I18nKey.publishToolbarInlineCodePlaceholder),
            );
            return;
        }
        applyCodeBlockAction(articleBodyInput);
    };

    // ── 暂存上传管理 ──

    const clearPendingUploads = (): void => {
        for (const pending of pendingUploads.values()) {
            URL.revokeObjectURL(pending.localUrl);
        }
        pendingUploads.clear();
    };

    const removePendingCover = (): void => {
        for (const [key, pending] of pendingUploads.entries()) {
            if (pending.purpose === "cover") {
                URL.revokeObjectURL(pending.localUrl);
                pendingUploads.delete(key);
            }
        }
    };

    // ── 封面裁剪 ──

    const cropModal = new ImageCropModal({
        outputWidth: COVER_OUTPUT_WIDTH,
        outputHeight: COVER_OUTPUT_HEIGHT,
        title: t(I18nKey.publishCoverCropTitle),
    });

    const handleCoverCrop = async (): Promise<void> => {
        const blob = await cropModal.open();
        if (!blob) return;

        // 移除旧的暂存封面
        removePendingCover();

        const localUrl = URL.createObjectURL(blob);
        const ext = blob.type === "image/png" ? "png" : "jpg";
        const fileName = `${clientShortId}-cover.${ext}`;
        const file = new File([blob], fileName, { type: blob.type });

        pendingUploads.set(localUrl, {
            file,
            localUrl,
            purpose: "cover",
            fileName,
        });

        // 清空已有服务端封面（将在保存时用新的替换）
        currentCoverFileId = "";
        updateCoverPreview();
        setCoverMessage(t(I18nKey.publishCoverUpdatedPendingSave));
    };

    // ── 粘贴即上传 ──

    const handlePaste = (event: ClipboardEvent): void => {
        const items = event.clipboardData?.items;
        if (!items) return;

        for (const item of items) {
            if (!item.type.startsWith("image/")) continue;

            const file = item.getAsFile();
            if (!file) continue;

            event.preventDefault();

            const localUrl = URL.createObjectURL(file);
            inlineImageCounter += 1;
            const ext = getImageFileExt(file);
            const fileName = `${clientShortId}-${inlineImageCounter}.${ext}`;

            pendingUploads.set(localUrl, {
                file,
                localUrl,
                purpose: "inline",
                fileName,
            });

            // 在光标位置插入 markdown 图片引用
            const markdown = `![image](${localUrl})`;
            const start = articleBodyInput.selectionStart;
            const end = articleBodyInput.selectionEnd;
            const before = articleBodyInput.value.slice(0, start);
            const after = articleBodyInput.value.slice(end);
            articleBodyInput.value = `${before}${markdown}${after}`;
            const nextCursor = before.length + markdown.length;
            articleBodyInput.focus();
            articleBodyInput.setSelectionRange(nextCursor, nextCursor);
            markPreviewDirty();
            break; // 每次粘贴只处理第一张图片
        }
    };

    // ── 表单操作 ──

    const resetForm = (): void => {
        articleTitleInput.value = "";
        articleSummaryInput.value = "";
        articleBodyInput.value = "";
        articleBodyInput.placeholder = DEFAULT_BODY_PLACEHOLDER;
        articleCoverUrlInput.value = "";
        articleTagsInput.value = "";
        articleCategoryInput.value = "";
        articleAllowCommentsInput.checked = true;
        articleIsPublicInput.checked = true;
        articleEncryptEnabledInput.checked = false;
        articleEncryptPasswordInput.value = "";
        loadedEncryptedBody = "";
        loadedEncryptedBodyUnlocked = false;
        updateEncryptPanel();
        currentCoverFileId = "";
        clearPendingUploads();
        inlineImageCounter = 0;
        updateCoverPreview();
        currentItemId = "";
        updateEditorHeader();
        updateUrlState();
        resetPreviewState();
        setSubmitError("");
        setSubmitMessage("");
        setCoverMessage("");
        updateTitleHint();
    };

    const collectSavedPasswords = (item: Record<string, unknown>): string[] => {
        const keys = buildOwnerArticlePasswordStorageKeys({
            id: toStringValue(item.id),
            shortId: toStringValue(item.short_id),
            slug: toStringValue(item.slug),
        });
        const candidatePaths = new Set<string>();
        const shortId = toStringValue(item.short_id);
        const slug = toStringValue(item.slug);
        if (slug) {
            candidatePaths.add(`/posts/${slug}`);
            candidatePaths.add(`/posts/${encodeURIComponent(slug)}`);
        }
        if (shortId) {
            candidatePaths.add(`/posts/${shortId}`);
            candidatePaths.add(`/posts/${encodeURIComponent(shortId)}`);
        }

        const passwords = new Set<string>();
        try {
            for (const key of keys) {
                const value = toStringValue(sessionStorage.getItem(key));
                if (value) {
                    passwords.add(value);
                }
            }
        } catch (error) {
            console.warn("[publish] read owner password failed:", error);
        }
        try {
            for (const path of candidatePaths) {
                const value = toStringValue(
                    sessionStorage.getItem(`page-password-${path}`),
                );
                if (value) {
                    passwords.add(value);
                }
            }
        } catch (error) {
            console.warn("[publish] read session password failed:", error);
        }
        return Array.from(passwords);
    };

    const fillArticleForm = async (
        item: Record<string, unknown>,
    ): Promise<boolean> => {
        articleTitleInput.value = toStringValue(item.title);
        articleSummaryInput.value = toStringValue(item.summary);
        const rawBodyMarkdown = toStringValue(item.body_markdown);
        const isEncryptedBody = isProtectedContentBody(rawBodyMarkdown);
        let unlockedEncryptedBody = false;
        if (isEncryptedBody) {
            loadedEncryptedBody = rawBodyMarkdown;
            loadedEncryptedBodyUnlocked = false;
            articleEncryptEnabledInput.checked = true;
            articleBodyInput.value = "";
            const passwordCandidates = collectSavedPasswords(item);
            for (const password of passwordCandidates) {
                try {
                    const rawPlaintext = await decryptArticleBodyWithPassword(
                        rawBodyMarkdown,
                        password,
                    );
                    const resolved =
                        resolveProtectedArticleMarkdown(rawPlaintext);
                    articleBodyInput.value = resolved.markdown;
                    articleBodyInput.placeholder = DEFAULT_BODY_PLACEHOLDER;
                    if (!toStringValue(articleEncryptPasswordInput.value)) {
                        articleEncryptPasswordInput.value = password;
                    }
                    unlockedEncryptedBody = true;
                    loadedEncryptedBodyUnlocked = true;
                    break;
                } catch (error) {
                    if (isWrongProtectedPasswordError(error)) {
                        continue;
                    }
                    console.warn(
                        "[publish] decrypt encrypted article failed:",
                        error,
                    );
                    break;
                }
            }
            if (!unlockedEncryptedBody) {
                articleBodyInput.value = "";
                articleBodyInput.placeholder = t(
                    I18nKey.publishEncryptedBodyLockedPlaceholder,
                );
                articleEncryptPasswordInput.value = "";
            }
        } else {
            loadedEncryptedBody = "";
            loadedEncryptedBodyUnlocked = false;
            articleEncryptEnabledInput.checked = false;
            articleBodyInput.value = rawBodyMarkdown;
            articleBodyInput.placeholder = DEFAULT_BODY_PLACEHOLDER;
            articleEncryptPasswordInput.value = "";
        }
        updateEncryptPanel();
        articleCoverUrlInput.value = toStringValue(item.cover_url);
        articleTagsInput.value = arrayToCsv(toStringArrayValue(item.tags));
        articleCategoryInput.value = toStringValue(item.category);
        articleAllowCommentsInput.checked = toBooleanValue(
            item.allow_comments,
            true,
        );
        articleIsPublicInput.checked = toBooleanValue(item.is_public, true);

        // 封面：保存服务端文件 ID
        currentCoverFileId = toStringValue(item.cover_file);
        updateCoverPreview();
        updateTitleHint();
        return unlockedEncryptedBody;
    };

    const loadDetail = async (id: string): Promise<void> => {
        const targetId = String(id || "").trim();
        if (!targetId || !isLoggedIn) return;

        try {
            const { response, data } = await api(
                `/api/v1/me/articles/${encodeURIComponent(targetId)}`,
                { method: "GET" },
            );
            if (response.status === 401) {
                emitAuthState({
                    isLoggedIn: false,
                    isAdmin: false,
                    userId: "",
                    username: "",
                });
                return;
            }
            if (!response.ok || !data?.ok) {
                setSubmitError(
                    getApiMessage(data, t(I18nKey.publishLoadFailed)),
                );
                return;
            }
            const item = toRecord(data.item);
            if (!item) {
                setSubmitError(t(I18nKey.publishEditableContentNotFound));
                return;
            }
            clearPendingUploads();
            inlineImageCounter = 0;
            const unlockedEncryptedBody = await fillArticleForm(item);
            currentItemId = toStringValue(item.id) || targetId;
            const loadedShortId = toStringValue(item.short_id);
            if (loadedShortId) {
                currentItemShortId = loadedShortId;
            }
            updateEditorHeader();
            updateUrlState();
            resetPreviewState();
            setSubmitError("");
            setSubmitMessage(
                loadedEncryptedBody
                    ? unlockedEncryptedBody
                        ? t(I18nKey.publishEncryptedAutoUnlocked)
                        : t(I18nKey.publishEncryptedAutoUnlockMissingPassword)
                    : "",
            );
            // 触发初始预览
            markPreviewDirty();
        } catch (error) {
            console.error("[publish] load detail failed:", error);
            setSubmitError(t(I18nKey.publishLoadFailedRetry));
        }
    };

    // ── 发布流程 ──

    const materializePendingUploads = async (
        bodyMarkdown: string,
    ): Promise<{
        body: string;
        coverFileId: string | null;
    }> => {
        const entries = Array.from(pendingUploads.entries());
        if (entries.length === 0) {
            return { body: bodyMarkdown, coverFileId: null };
        }

        let nextBody = bodyMarkdown;
        let coverFileId: string | null = null;
        const total = entries.length;

        for (let i = 0; i < entries.length; i++) {
            const [localUrl, pending] = entries[i];
            const progressPercent = ((i + 1) / (total + 1)) * 80; // 留 20% 给最终保存
            saveOverlay.update(
                progressPercent,
                tFmt(I18nKey.publishUploadProgress, {
                    current: i + 1,
                    total,
                }),
            );

            const formData = new FormData();
            formData.set("file", pending.file, pending.fileName);
            formData.set(
                "purpose",
                pending.purpose === "cover" ? "article-cover" : "general",
            );
            formData.set(
                "title",
                `${currentUsername || "user"}-${pending.fileName}`,
            );

            const { response, data } = await api("/api/v1/uploads", {
                method: "POST",
                body: formData,
            });

            if (response.status === 401) {
                throw new Error(t(I18nKey.publishLoginExpired));
            }
            if (!response.ok || !data?.ok) {
                throw new Error(
                    getApiMessage(
                        data,
                        tFmt(I18nKey.publishUploadFileFailed, {
                            filename: pending.fileName,
                        }),
                    ),
                );
            }

            const fileId = extractUploadFileId(data);
            if (!fileId) {
                throw new Error(
                    tFmt(I18nKey.publishUploadMissingFileId, {
                        filename: pending.fileName,
                    }),
                );
            }

            if (pending.purpose === "cover") {
                coverFileId = fileId;
            } else {
                // 替换正文中的 blob: URL
                const remoteUrl = `/api/v1/public/assets/${encodeURIComponent(fileId)}`;
                nextBody = nextBody.split(localUrl).join(remoteUrl);
            }

            URL.revokeObjectURL(localUrl);
            pendingUploads.delete(localUrl);
        }

        return { body: nextBody, coverFileId };
    };

    const renderFullPreviewHtml = async (markdown: string): Promise<string> => {
        const result = await previewClient.preview(markdown, {
            mode: "full",
            force: true,
        });
        if (result.aborted) {
            throw new Error(t(I18nKey.publishRenderInterruptedRetry));
        }
        if (result.unauthorized) {
            emitAuthState({
                isLoggedIn: false,
                isAdmin: false,
                userId: "",
                username: "",
            });
            throw new Error(t(I18nKey.publishLoginExpired));
        }
        if (result.error) {
            throw new Error(result.error);
        }
        const normalized = normalizeMarkdownPreviewHtml(result.html);
        if (!normalized) {
            throw new Error(t(I18nKey.publishRenderEncryptedFailed));
        }
        return normalized;
    };

    const submit = async (): Promise<void> => {
        if (!isLoggedIn) {
            showAuthRequiredDialog();
            return;
        }

        setSubmitError("");
        setSubmitMessage("");

        // 验证必填字段
        const title = toStringValue(articleTitleInput.value);
        const bodyMarkdown = String(articleBodyInput.value || "").trim();
        const encryptEnabled = articleEncryptEnabledInput.checked;
        const inputPassword = toStringValue(articleEncryptPasswordInput.value);
        const canReuseEncryptedBody =
            encryptEnabled &&
            !bodyMarkdown &&
            Boolean(loadedEncryptedBody) &&
            !inputPassword;
        if (
            encryptEnabled &&
            !bodyMarkdown &&
            Boolean(loadedEncryptedBody) &&
            inputPassword
        ) {
            setSubmitError(t(I18nKey.publishBodyEmptyCannotChangePasswordOnly));
            return;
        }
        if (!title || (!bodyMarkdown && !canReuseEncryptedBody)) {
            setSubmitError(t(I18nKey.publishTitleBodyRequired));
            return;
        }
        if (weightedCharLength(title) > ARTICLE_TITLE_MAX) {
            setSubmitError(TITLE_TOO_LONG_MESSAGE);
            return;
        }

        const publishLabel =
            savePublishedBtn.textContent || t(I18nKey.commonPublishNow);
        savePublishedBtn.disabled = true;

        saveOverlay.show(t(I18nKey.publishSavingTitle));

        try {
            const ownerPasswordForStorage = encryptEnabled ? inputPassword : "";
            // 物化暂存上传
            const { body, coverFileId } = await materializePendingUploads(
                canReuseEncryptedBody ? "" : bodyMarkdown,
            );

            saveOverlay.update(85, t(I18nKey.publishSavingData));

            let nextBodyMarkdown = body;
            if (canReuseEncryptedBody) {
                nextBodyMarkdown = loadedEncryptedBody;
            } else if (encryptEnabled) {
                const password = inputPassword;
                if (!password) {
                    throw new Error(
                        t(I18nKey.publishEncryptEnabledPasswordRequired),
                    );
                }
                saveOverlay.update(
                    90,
                    t(I18nKey.publishGeneratingEncryptedContent),
                );
                const bodyHtml = await renderFullPreviewHtml(nextBodyMarkdown);
                nextBodyMarkdown = await encryptArticleBody(
                    nextBodyMarkdown,
                    bodyHtml,
                    password,
                );
            }

            // 构建 payload
            const payload: Record<string, unknown> = {
                title,
                summary: toNullableString(articleSummaryInput.value),
                body_markdown: nextBodyMarkdown,
                cover_url: toNullableString(articleCoverUrlInput.value),
                tags: csvToArray(articleTagsInput.value),
                category: toNullableString(articleCategoryInput.value),
                allow_comments: articleAllowCommentsInput.checked,
                is_public: articleIsPublicInput.checked,
                status: "published",
            };

            // 封面 file ID：优先用新上传的，否则保留已有的
            if (coverFileId) {
                payload.cover_file = coverFileId;
            } else if (currentCoverFileId) {
                payload.cover_file = currentCoverFileId;
            } else {
                payload.cover_file = null;
            }

            const isEditing = Boolean(currentItemId);
            const endpoint = isEditing
                ? `/api/v1/me/articles/${encodeURIComponent(currentItemId)}`
                : "/api/v1/me/articles";
            const method = isEditing ? "PATCH" : "POST";

            const { response, data } = await api(endpoint, {
                method,
                body: JSON.stringify(payload),
            });

            if (response.status === 401) {
                emitAuthState({
                    isLoggedIn: false,
                    isAdmin: false,
                    userId: "",
                    username: "",
                });
                showAuthRequiredDialog();
                return;
            }
            if (!response.ok || !data?.ok) {
                setSubmitError(
                    getApiMessage(data, t(I18nKey.publishSaveFailedRetry)),
                );
                return;
            }

            saveOverlay.update(100, t(I18nKey.publishSaveCompleted));
            await new Promise((resolve) => setTimeout(resolve, 300));

            const item = toRecord(data.item);
            const nextId = toStringValue(item?.id) || currentItemId;
            if (nextId) {
                currentItemId = nextId;
            }
            const nextShortId = toStringValue(item?.short_id);
            if (nextShortId) {
                currentItemShortId = nextShortId;
            }
            if (item) {
                await fillArticleForm(item);
            }
            if (encryptEnabled && ownerPasswordForStorage) {
                persistOwnerPassword(ownerPasswordForStorage, item);
            }
            updateEditorHeader();
            updateUrlState();
            setSubmitMessage(t(I18nKey.publishPublished));
            setSubmitError("");

            // 发布成功后跳转到文章详情页
            if (item) {
                const slug = toStringValue(item.slug);
                const shortId = toStringValue(item.short_id);
                if (slug) {
                    window.location.href = `/posts/${encodeURIComponent(slug)}`;
                    return;
                }
                if (shortId) {
                    window.location.href = `/posts/${encodeURIComponent(shortId)}`;
                    return;
                }
            }
        } catch (error) {
            console.error("[publish] submit failed:", error);
            const message =
                error instanceof Error
                    ? error.message
                    : t(I18nKey.publishSaveFailedRetry);
            setSubmitError(message);
        } finally {
            saveOverlay.hide();
            savePublishedBtn.disabled = false;
            savePublishedBtn.textContent = publishLabel;
        }
    };

    // ── 认证状态 ──

    const applyAuthState = (state: AuthState): void => {
        isLoggedIn = state.isLoggedIn;
        currentUsername = toStringValue(state.username);

        workspaceEl.classList.toggle("hidden", !isLoggedIn);

        if (!isLoggedIn) return;

        if (!initializedAfterLogin) {
            initializedAfterLogin = true;
            void (async () => {
                if (initialIdFromUrl) {
                    await loadDetail(initialIdFromUrl);
                } else {
                    resetForm();
                }
            })();
        }
    };

    // ── 事件绑定 ──

    updateEditorHeader();
    updateUrlState();
    renderPreview();
    updateTitleHint();
    updateEncryptPanel();

    toolbarEl.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null;
        if (!target) return;
        const button = target.closest<HTMLButtonElement>("[data-md-action]");
        if (!button) return;
        const action = toStringValue(button.dataset.mdAction);
        if (!isToolbarAction(action)) return;
        applyToolbarAction(action);
    });

    articleTitleInput.addEventListener("input", () => {
        enforceTitleLength();
    });

    articleEncryptEnabledInput.addEventListener("change", () => {
        updateEncryptPanel();
    });

    // 实时预览：textarea input → debounced 预览
    articleBodyInput.addEventListener("input", () => {
        updateEncryptHint();
        markPreviewDirty();
    });
    articleBodyInput.addEventListener("blur", () => {
        if (!previewDirty) {
            return;
        }
        if (previewFastTimer !== null) {
            window.clearTimeout(previewFastTimer);
            previewFastTimer = null;
        }
        if (previewFullTimer !== null) {
            window.clearTimeout(previewFullTimer);
            previewFullTimer = null;
        }
        const generation = previewGeneration;
        void requestPreview("full", generation, true);
    });

    // 粘贴即上传
    articleBodyInput.addEventListener("paste", handlePaste);

    // 双向滚动同步：编辑器 ↔ 预览
    {
        let syncScrollSource: "editor" | "preview" | null = null;
        let syncScrollTimer: number | null = null;

        const syncScroll = (
            source: HTMLElement,
            target: HTMLElement,
            origin: "editor" | "preview",
        ): void => {
            if (syncScrollSource && syncScrollSource !== origin) return;
            syncScrollSource = origin;
            if (syncScrollTimer !== null) window.clearTimeout(syncScrollTimer);
            syncScrollTimer = window.setTimeout(() => {
                syncScrollSource = null;
                syncScrollTimer = null;
            }, 80);

            const sourceMax = source.scrollHeight - source.clientHeight;
            if (sourceMax <= 0) return;
            const ratio = source.scrollTop / sourceMax;
            const targetMax = target.scrollHeight - target.clientHeight;
            target.scrollTop = ratio * targetMax;
        };

        articleBodyInput.addEventListener("scroll", () => {
            if (previewScrollEl) {
                syncScroll(articleBodyInput, previewScrollEl, "editor");
            }
        });
        previewScrollEl?.addEventListener("scroll", () => {
            syncScroll(previewScrollEl!, articleBodyInput, "preview");
        });
    }

    // 封面裁剪
    coverCropBtn?.addEventListener("click", () => {
        void handleCoverCrop();
    });

    // 清空封面
    coverClearBtn?.addEventListener("click", () => {
        removePendingCover();
        currentCoverFileId = "";
        articleCoverUrlInput.value = "";
        updateCoverPreview();
        setCoverMessage("");
    });

    // 外部封面 URL 变化 → 更新预览
    articleCoverUrlInput.addEventListener("input", () => {
        updateCoverPreview();
    });

    // 保存/发布
    savePublishedBtn.addEventListener("click", () => {
        void submit();
    });

    // 认证
    subscribeAuthState((state) => {
        applyAuthState(state);
    });
    applyAuthState(getAuthState());

    // 自动 hydrate 认证状态
    void (async () => {
        if (getAuthState().isLoggedIn) return;
        try {
            const { response, data } = await api("/api/auth/me", {
                method: "GET",
                headers: { "Cache-Control": "no-store" },
            });
            if (!response.ok || !data?.ok) return;
            const user = toRecord(data.user);
            emitAuthState({
                isLoggedIn: true,
                isAdmin: Boolean(data.is_admin || data.isAdmin),
                userId: toStringValue(user?.id),
                username: toStringValue(user?.username),
            });
        } catch (error) {
            console.warn("[publish] hydrate auth state failed:", error);
        }
    })();

    // beforeunload 清理
    window.addEventListener("beforeunload", () => {
        clearPendingUploads();
        cropModal.destroy();
        saveOverlay.destroy();
    });
}
