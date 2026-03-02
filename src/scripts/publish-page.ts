/* eslint-disable max-lines -- 文件行数较长，按页面驱动与模块边界保留当前结构 */
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
import { ImageCropModal } from "@/scripts/image-crop-modal";
import { MarkdownPreviewClient } from "@/scripts/markdown-preview-client";
import { SaveProgressOverlay } from "@/scripts/save-progress-overlay";
import { ARTICLE_TITLE_MAX, charWeight } from "@/constants/text-limits";
import I18nKey from "@/i18n/i18nKey";
import { requestApi as api } from "@/scripts/http-client";
import { t, tFmt } from "@/scripts/i18n-runtime";
import { generateClientShortId } from "@/utils/short-id";
import {
    type PendingUpload,
    type PublishRuntimeWindow,
    COVER_OUTPUT_WIDTH,
    COVER_OUTPUT_HEIGHT,
    applyToolbarAction,
    arrayToCsv,
    clearPendingUploads,
    getApiMessage,
    getImageFileExt,
    isProtectedContentBody,
    removePendingCover,
    toBooleanValue,
    toRecord,
    toStringArrayValue,
    toStringValue,
    trimToWeightedMax,
} from "@/scripts/publish-page-helpers";
import {
    type PublishDomRefs,
    collectDomRefs,
} from "@/scripts/publish-page-dom";
import {
    type PublishState,
    type UiHelpers,
    fillEncryptedBody,
    submit,
} from "@/scripts/publish-page-submit";
import {
    type PreviewHelpers,
    makePreviewHelpers,
} from "@/scripts/publish-page-preview";
import { makeUiHelpers } from "@/scripts/publish-page-ui";

// ── 常量（依赖 i18n，在模块顶层初始化）──

const TITLE_TOO_LONG_MESSAGE = tFmt(I18nKey.articleEditorTitleMaxLength, {
    max: ARTICLE_TITLE_MAX,
});
const DEFAULT_BODY_PLACEHOLDER = t(I18nKey.articleEditorBodyPlaceholder);

// ── 表单操作 ──

async function fillArticleForm(
    dom: PublishDomRefs,
    state: PublishState,
    updateEncryptPanel: () => void,
    updateCoverPreview: () => void,
    updateTitleHint: () => void,
    item: Record<string, unknown>,
): Promise<boolean> {
    dom.articleTitleInput.value = toStringValue(item.title);
    dom.articleSummaryInput.value = toStringValue(item.summary);
    const rawBodyMarkdown = toStringValue(item.body_markdown);
    const isEncryptedBody = isProtectedContentBody(rawBodyMarkdown);
    let unlockedEncryptedBody = false;
    if (isEncryptedBody) {
        unlockedEncryptedBody = await fillEncryptedBody(
            dom,
            state,
            rawBodyMarkdown,
            item,
            DEFAULT_BODY_PLACEHOLDER,
        );
    } else {
        state.loadedEncryptedBody = "";
        state.loadedEncryptedBodyUnlocked = false;
        dom.articleEncryptEnabledInput.checked = false;
        dom.articleBodyInput.value = rawBodyMarkdown;
        dom.articleBodyInput.placeholder = DEFAULT_BODY_PLACEHOLDER;
        dom.articleEncryptPasswordInput.value = "";
    }
    updateEncryptPanel();
    dom.articleCoverUrlInput.value = toStringValue(item.cover_url);
    dom.articleTagsInput.value = arrayToCsv(toStringArrayValue(item.tags));
    dom.articleCategoryInput.value = toStringValue(item.category);
    dom.articleAllowCommentsInput.checked = toBooleanValue(
        item.allow_comments,
        true,
    );
    dom.articleIsPublicInput.checked = toBooleanValue(item.is_public, true);
    state.currentCoverFileId = toStringValue(item.cover_file);
    updateCoverPreview();
    updateTitleHint();
    return unlockedEncryptedBody;
}

// ── 事件绑定 ──

type PageContext = {
    dom: PublishDomRefs;
    state: PublishState;
    pendingUploads: Map<string, PendingUpload>;
    saveOverlay: SaveProgressOverlay;
    previewClient: MarkdownPreviewClient;
    ui: UiHelpers;
    preview: PreviewHelpers;
    cropModal: ImageCropModal;
    clientShortId: string;
    updateCoverPreview: () => void;
    fillForm: (item: Record<string, unknown>) => Promise<boolean>;
    resetForm: () => void;
    loadDetail: (id: string) => Promise<void>;
};

function bindEditorEvents(ctx: PageContext): void {
    const { dom, state, ui, preview } = ctx;

    dom.toolbarEl.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null;
        if (!target) {
            return;
        }
        const button = target.closest<HTMLButtonElement>("[data-md-action]");
        if (!button) {
            return;
        }
        const action = toStringValue(button.dataset.mdAction);
        applyToolbarAction(
            action,
            dom.articleBodyInput,
            preview.markPreviewDirty,
        );
    });

    dom.articleTitleInput.addEventListener("input", () => {
        const raw = String(dom.articleTitleInput.value || "");
        const limited = trimToWeightedMax(raw, ARTICLE_TITLE_MAX, charWeight);
        if (raw !== limited) {
            dom.articleTitleInput.value = limited;
            ui.setSubmitError(TITLE_TOO_LONG_MESSAGE);
        }
        ui.updateTitleHint();
    });

    dom.articleEncryptEnabledInput.addEventListener("change", () => {
        ui.updateEncryptPanel();
    });

    dom.articleBodyInput.addEventListener("input", () => {
        ui.updateEncryptHint();
        preview.markPreviewDirty();
    });

    dom.articleBodyInput.addEventListener("blur", () => {
        if (!state.previewDirty) {
            return;
        }
        if (state.previewFastTimer !== null) {
            window.clearTimeout(state.previewFastTimer);
            state.previewFastTimer = null;
        }
        if (state.previewFullTimer !== null) {
            window.clearTimeout(state.previewFullTimer);
            state.previewFullTimer = null;
        }
        const generation = state.previewGeneration;
        void preview.requestPreview("full", generation, true);
    });

    dom.articleBodyInput.addEventListener("paste", (event: ClipboardEvent) => {
        const items = event.clipboardData?.items;
        if (!items) {
            return;
        }
        for (const item of items) {
            if (!item.type.startsWith("image/")) {
                continue;
            }
            const file = item.getAsFile();
            if (!file) {
                continue;
            }
            event.preventDefault();
            const localUrl = URL.createObjectURL(file);
            state.inlineImageCounter += 1;
            const ext = getImageFileExt(file);
            const fileName = `${ctx.clientShortId}-${state.inlineImageCounter}.${ext}`;
            ctx.pendingUploads.set(localUrl, {
                file,
                localUrl,
                purpose: "inline",
                fileName,
            });
            const markdown = `![image](${localUrl})`;
            const start = dom.articleBodyInput.selectionStart;
            const end = dom.articleBodyInput.selectionEnd;
            const before = dom.articleBodyInput.value.slice(0, start);
            const after = dom.articleBodyInput.value.slice(end);
            dom.articleBodyInput.value = `${before}${markdown}${after}`;
            const nextCursor = before.length + markdown.length;
            dom.articleBodyInput.focus();
            dom.articleBodyInput.setSelectionRange(nextCursor, nextCursor);
            preview.markPreviewDirty();
            break;
        }
    });
}

function bindScrollSync(dom: PublishDomRefs): void {
    let syncScrollSource: "editor" | "preview" | null = null;
    let syncScrollTimer: number | null = null;

    const syncScroll = (
        source: HTMLElement,
        target: HTMLElement,
        origin: "editor" | "preview",
    ): void => {
        if (syncScrollSource && syncScrollSource !== origin) {
            return;
        }
        syncScrollSource = origin;
        if (syncScrollTimer !== null) {
            window.clearTimeout(syncScrollTimer);
        }
        syncScrollTimer = window.setTimeout(() => {
            syncScrollSource = null;
            syncScrollTimer = null;
        }, 80);
        const sourceMax = source.scrollHeight - source.clientHeight;
        if (sourceMax <= 0) {
            return;
        }
        const ratio = source.scrollTop / sourceMax;
        const targetMax = target.scrollHeight - target.clientHeight;
        target.scrollTop = ratio * targetMax;
    };

    dom.articleBodyInput.addEventListener("scroll", () => {
        if (dom.previewScrollEl) {
            syncScroll(dom.articleBodyInput, dom.previewScrollEl, "editor");
        }
    });
    dom.previewScrollEl?.addEventListener("scroll", () => {
        syncScroll(dom.previewScrollEl!, dom.articleBodyInput, "preview");
    });
}

function bindCoverEvents(ctx: PageContext): void {
    const {
        dom,
        state,
        ui,
        cropModal,
        updateCoverPreview,
        pendingUploads,
        clientShortId,
    } = ctx;

    dom.coverCropBtn?.addEventListener("click", () => {
        void (async () => {
            const blob = await cropModal.open();
            if (!blob) {
                return;
            }
            removePendingCover(pendingUploads);
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
            state.currentCoverFileId = "";
            updateCoverPreview();
            ui.setCoverMessage(t(I18nKey.articleEditorCoverUpdatedPendingSave));
        })();
    });

    dom.coverClearBtn?.addEventListener("click", () => {
        removePendingCover(pendingUploads);
        state.currentCoverFileId = "";
        dom.articleCoverUrlInput.value = "";
        updateCoverPreview();
        ui.setCoverMessage("");
    });

    dom.articleCoverUrlInput.addEventListener("input", () => {
        updateCoverPreview();
    });
}

function bindSubmitAndAuth(ctx: PageContext, initialIdFromUrl: string): void {
    const {
        dom,
        state,
        ui,
        preview,
        pendingUploads,
        saveOverlay,
        previewClient,
        fillForm,
        resetForm,
        loadDetail,
        cropModal,
    } = ctx;

    dom.savePublishedBtn.addEventListener("click", () => {
        void submit({
            dom,
            state,
            pendingUploads,
            saveOverlay,
            previewClient,
            ui,
            fillForm,
        });
    });

    const applyAuthState = (authState: AuthState): void => {
        state.isLoggedIn = authState.isLoggedIn;
        state.currentUsername = toStringValue(authState.username);
        dom.workspaceEl.classList.toggle("hidden", !state.isLoggedIn);
        if (!state.isLoggedIn) {
            return;
        }
        if (!state.initializedAfterLogin) {
            state.initializedAfterLogin = true;
            void (async () => {
                if (initialIdFromUrl) {
                    await loadDetail(initialIdFromUrl);
                } else {
                    resetForm();
                }
            })();
        }
    };

    subscribeAuthState((authState) => {
        applyAuthState(authState);
    });
    applyAuthState(getAuthState());

    void (async () => {
        if (getAuthState().isLoggedIn) {
            return;
        }
        try {
            const { response, data } = await api("/api/auth/me", {
                method: "GET",
                headers: { "Cache-Control": "no-store" },
            });
            if (!response.ok || !data?.ok) {
                return;
            }
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

    window.addEventListener("beforeunload", () => {
        clearPendingUploads(pendingUploads);
        cropModal.destroy();
        saveOverlay.destroy();
    });

    void preview;
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
    const dom = collectDomRefs();
    if (!dom) {
        return;
    }

    const initialIdFromUrl = root.dataset.articleId || "";
    const clientShortId = generateClientShortId();
    const previewClient = new MarkdownPreviewClient("article");
    const saveOverlay = new SaveProgressOverlay();
    const pendingUploads = new Map<string, PendingUpload>();
    const cropModal = new ImageCropModal({
        outputWidth: COVER_OUTPUT_WIDTH,
        outputHeight: COVER_OUTPUT_HEIGHT,
        title: t(I18nKey.articleEditorCoverCropTitle),
    });

    const state: PublishState = {
        currentItemId: "",
        currentItemShortId: "",
        currentCoverFileId: "",
        currentUsername: "",
        isLoggedIn: false,
        previewError: "",
        previewHtml: "",
        previewSource: "",
        previewDirty: false,
        renderedPreviewHtml: "",
        previewGeneration: 0,
        previewFastTimer: null,
        previewFullTimer: null,
        initializedAfterLogin: false,
        loadedEncryptedBody: "",
        loadedEncryptedBodyUnlocked: false,
        inlineImageCounter: 0,
    };

    const ui = makeUiHelpers(dom, state);
    const updateCoverPreview = (): void =>
        ui.updateCoverPreview(pendingUploads);
    const preview = makePreviewHelpers(
        dom,
        state,
        previewClient,
        runtimeWindow,
    );

    const fillForm = async (item: Record<string, unknown>): Promise<boolean> =>
        fillArticleForm(
            dom,
            state,
            ui.updateEncryptPanel,
            updateCoverPreview,
            ui.updateTitleHint,
            item,
        );

    const resetForm = (): void => {
        dom.articleTitleInput.value = "";
        dom.articleSummaryInput.value = "";
        dom.articleBodyInput.value = "";
        dom.articleBodyInput.placeholder = DEFAULT_BODY_PLACEHOLDER;
        dom.articleCoverUrlInput.value = "";
        dom.articleTagsInput.value = "";
        dom.articleCategoryInput.value = "";
        dom.articleAllowCommentsInput.checked = true;
        dom.articleIsPublicInput.checked = true;
        dom.articleEncryptEnabledInput.checked = false;
        dom.articleEncryptPasswordInput.value = "";
        state.loadedEncryptedBody = "";
        state.loadedEncryptedBodyUnlocked = false;
        ui.updateEncryptPanel();
        state.currentCoverFileId = "";
        clearPendingUploads(pendingUploads);
        state.inlineImageCounter = 0;
        updateCoverPreview();
        state.currentItemId = "";
        ui.updateEditorHeader();
        ui.updateUrlState();
        preview.resetPreviewState();
        ui.setSubmitError("");
        ui.setSubmitMessage("");
        ui.setCoverMessage("");
        ui.updateTitleHint();
    };

    const loadDetail = async (id: string): Promise<void> => {
        const targetId = String(id || "").trim();
        if (!targetId || !state.isLoggedIn) {
            return;
        }
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
                ui.setSubmitError(
                    getApiMessage(data, t(I18nKey.articleEditorLoadFailed)),
                );
                return;
            }
            const item = toRecord(data.item);
            if (!item) {
                ui.setSubmitError(
                    t(I18nKey.articleEditorEditableContentNotFound),
                );
                return;
            }
            clearPendingUploads(pendingUploads);
            state.inlineImageCounter = 0;
            const unlockedEncryptedBody = await fillForm(item);
            state.currentItemId = toStringValue(item.id) || targetId;
            const loadedShortId = toStringValue(item.short_id);
            if (loadedShortId) {
                state.currentItemShortId = loadedShortId;
            }
            ui.updateEditorHeader();
            ui.updateUrlState();
            preview.resetPreviewState();
            ui.setSubmitError("");
            ui.setSubmitMessage(
                state.loadedEncryptedBody
                    ? unlockedEncryptedBody
                        ? t(I18nKey.articleEditorEncryptedAutoUnlocked)
                        : t(
                              I18nKey.articleEditorEncryptedAutoUnlockMissingPassword,
                          )
                    : "",
            );
            preview.markPreviewDirty();
        } catch (error) {
            console.error("[publish] load detail failed:", error);
            ui.setSubmitError(t(I18nKey.articleEditorLoadFailedRetry));
        }
    };

    const ctx: PageContext = {
        dom,
        state,
        pendingUploads,
        saveOverlay,
        previewClient,
        ui,
        preview,
        cropModal,
        clientShortId,
        updateCoverPreview,
        fillForm,
        resetForm,
        loadDetail,
    };

    ui.updateEditorHeader();
    ui.updateUrlState();
    preview.renderPreview();
    ui.updateTitleHint();
    ui.updateEncryptPanel();

    bindEditorEvents(ctx);
    bindScrollSync(dom);
    bindCoverEvents(ctx);
    bindSubmitAndAuth(ctx, initialIdFromUrl);
}
