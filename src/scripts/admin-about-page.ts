import I18nKey from "@/i18n/i18nKey";
import { setupCodeCopyDelegation } from "@/scripts/code-copy";
import { refreshGithubCards } from "@/scripts/github-card-runtime";
import { t } from "@/scripts/i18n-runtime";
import { MarkdownImagePasteUploader } from "@/scripts/markdown-image-paste";
import {
    MarkdownPreviewClient,
    normalizeMarkdownPreviewHtml,
} from "@/scripts/markdown-preview-client";
import { runWithTask } from "@/scripts/progress-overlay-manager";
import { getCsrfToken } from "@/utils/csrf";

type EditorMode = "edit" | "preview";
type ToolbarAction =
    | "bold"
    | "italic"
    | "underline"
    | "strike"
    | "quote"
    | "inline-code"
    | "code-block";

type ApiResult = {
    response: Response;
    data: Record<string, unknown> | null;
};

type RuntimeWindow = Window &
    typeof globalThis & {
        renderMermaidDiagrams?: () => Promise<void>;
    };

const TOOLBAR_ACTIONS = new Set<ToolbarAction>([
    "bold",
    "italic",
    "underline",
    "strike",
    "quote",
    "inline-code",
    "code-block",
]);

const DATA_BOUND = "data-admin-about-bound";

function normalizeApiUrl(input: string): string {
    const [pathname, search = ""] = String(input || "").split("?");
    const normalizedPath = pathname.endsWith("/")
        ? pathname.slice(0, -1)
        : pathname;
    return search ? `${normalizedPath}?${search}` : normalizedPath;
}

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

function getApiMessage(
    data: Record<string, unknown> | null,
    fallback: string,
): string {
    const error = toRecord(data?.error);
    const message = toStringValue(error?.message);
    return message || fallback;
}

function isToolbarAction(value: string): value is ToolbarAction {
    return TOOLBAR_ACTIONS.has(value as ToolbarAction);
}

async function api(url: string, init: RequestInit = {}): Promise<ApiResult> {
    const response = await fetch(normalizeApiUrl(url), {
        credentials: "include",
        headers: {
            Accept: "application/json",
            "x-csrf-token": getCsrfToken(),
            ...(init.body ? { "Content-Type": "application/json" } : {}),
            ...((init.headers as Record<string, string>) || {}),
        },
        ...init,
    });
    const data: Record<string, unknown> | null = await response
        .json()
        .catch(() => null);
    return { response, data };
}

export function initAdminAboutPage(): void {
    const normalizedPath = window.location.pathname.replace(/\/+$/, "") || "/";
    if (normalizedPath !== "/admin/settings/about") {
        return;
    }

    const formEl = document.getElementById(
        "about-form",
    ) as HTMLFormElement | null;
    if (!formEl || formEl.hasAttribute(DATA_BOUND)) {
        return;
    }
    formEl.setAttribute(DATA_BOUND, "1");

    const titleEl = document.getElementById(
        "about-title",
    ) as HTMLInputElement | null;
    const summaryEl = document.getElementById(
        "about-summary",
    ) as HTMLTextAreaElement | null;
    const bodyEl = document.getElementById(
        "about-body-markdown",
    ) as HTMLTextAreaElement | null;
    const modeEditEl = document.getElementById(
        "about-mode-edit",
    ) as HTMLButtonElement | null;
    const modePreviewEl = document.getElementById(
        "about-mode-preview",
    ) as HTMLButtonElement | null;
    const editorPanelEl = document.getElementById("about-editor-panel");
    const toolbarEl = document.getElementById("about-toolbar");
    const saveMsgEl = document.getElementById("about-save-msg");
    const saveErrorEl = document.getElementById("about-save-error");
    const saveBtnEl = document.getElementById(
        "about-save",
    ) as HTMLButtonElement | null;

    const previewPanelEl = document.getElementById("about-preview-panel");
    const previewLoadingEl = document.getElementById("about-preview-loading");
    const previewErrorEl = document.getElementById("about-preview-error");
    const previewEmptyEl = document.getElementById("about-preview-empty");
    const previewContentEl = document.getElementById("about-preview-content");

    if (
        !titleEl ||
        !summaryEl ||
        !bodyEl ||
        !modeEditEl ||
        !modePreviewEl ||
        !editorPanelEl ||
        !toolbarEl ||
        !saveMsgEl ||
        !saveErrorEl ||
        !saveBtnEl ||
        !previewPanelEl ||
        !previewLoadingEl ||
        !previewErrorEl ||
        !previewEmptyEl ||
        !previewContentEl
    ) {
        return;
    }

    const runtimeWindow = window as RuntimeWindow;
    const previewClient = new MarkdownPreviewClient("about");

    let currentMode: EditorMode = "edit";
    let previewLoading = false;
    let previewError = "";
    let previewHtml = "";
    let previewSource = "";
    let previewDirty = false;
    let previewGeneration = 0;
    let previewFastTimer: number | null = null;
    let previewFullTimer: number | null = null;
    let renderedPreviewHtml = "";

    const setMsg = (message: string): void => {
        saveMsgEl.textContent = message;
    };

    const setError = (message: string): void => {
        if (!message) {
            saveErrorEl.textContent = "";
            saveErrorEl.classList.add("hidden");
            return;
        }
        saveErrorEl.textContent = message;
        saveErrorEl.classList.remove("hidden");
    };

    const refreshMarkdownRuntime = async (): Promise<void> => {
        setupCodeCopyDelegation();
        try {
            await refreshGithubCards();
        } catch (error) {
            console.warn("[admin-about] refresh github cards failed:", error);
        }
        if (typeof runtimeWindow.renderMermaidDiagrams === "function") {
            void runtimeWindow.renderMermaidDiagrams().catch((error) => {
                console.warn("[admin-about] refresh mermaid failed:", error);
            });
        }
    };

    const updateModeButtonStyle = (
        button: HTMLButtonElement,
        active: boolean,
    ): void => {
        button.setAttribute("aria-pressed", active ? "true" : "false");
        button.classList.toggle("text-90", active);
        button.classList.toggle("text-60", !active);
        button.classList.toggle("bg-(--btn-plain-bg-hover)", active);
        button.classList.toggle("border-(--primary)", active);
    };

    const renderPreview = (): void => {
        previewLoadingEl.classList.toggle("hidden", !previewLoading);

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
                void refreshMarkdownRuntime();
            }
            previewContentEl.classList.remove("hidden");
            previewEmptyEl.classList.add("hidden");
            return;
        }

        previewContentEl.innerHTML = "";
        renderedPreviewHtml = "";
        previewContentEl.classList.add("hidden");
        previewEmptyEl.classList.remove("hidden");
    };

    const setEditorMode = (mode: EditorMode): void => {
        currentMode = mode;
        editorPanelEl.classList.toggle("hidden", mode !== "edit");
        previewPanelEl.classList.toggle("hidden", mode !== "preview");
        updateModeButtonStyle(modeEditEl, mode === "edit");
        updateModeButtonStyle(modePreviewEl, mode === "preview");
        if (mode === "preview") {
            schedulePreview();
        }
    };

    const markPreviewDirty = (): void => {
        previewDirty = true;
        previewGeneration += 1;
    };

    const imagePasteUploader = new MarkdownImagePasteUploader({
        textarea: bodyEl,
        fileNamePrefix: "about",
        autoUpload: false,
        onContentChange: () => {
            markPreviewDirty();
            schedulePreview();
        },
        onError: (message) => {
            setMsg("");
            setError(message);
        },
    });

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
        const source = selected || t(I18nKey.adminMarkdownQuotePlaceholder);
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
            source.slice(start, end) || t(I18nKey.adminMarkdownCodePlaceholder);
        const language = "text";
        const block = `\`\`\`${language}\n${selected}\n\`\`\``;
        const needsLeadingBreak = start > 0 && source[start - 1] !== "\n";
        const needsTrailingBreak = end < source.length && source[end] !== "\n";
        const replacement = `${needsLeadingBreak ? "\n" : ""}${block}${needsTrailingBreak ? "\n" : ""}`;
        const contentStartOffset = (needsLeadingBreak ? 1 : 0) + 8;
        const contentEndOffset = contentStartOffset + selected.length;
        replaceSelection(
            textarea,
            replacement,
            contentStartOffset,
            contentEndOffset,
        );
    };

    const applyToolbarAction = (action: ToolbarAction): void => {
        if (action === "bold") {
            applyWrapAction(
                bodyEl,
                "**",
                "**",
                t(I18nKey.adminMarkdownBoldPlaceholder),
            );
            return;
        }
        if (action === "italic") {
            applyWrapAction(
                bodyEl,
                "*",
                "*",
                t(I18nKey.adminMarkdownItalicPlaceholder),
            );
            return;
        }
        if (action === "underline") {
            applyWrapAction(
                bodyEl,
                "<u>",
                "</u>",
                t(I18nKey.adminMarkdownUnderlinePlaceholder),
            );
            return;
        }
        if (action === "strike") {
            applyWrapAction(
                bodyEl,
                "~~",
                "~~",
                t(I18nKey.adminMarkdownStrikePlaceholder),
            );
            return;
        }
        if (action === "quote") {
            applyQuoteAction(bodyEl);
            return;
        }
        if (action === "inline-code") {
            applyWrapAction(
                bodyEl,
                "`",
                "`",
                t(I18nKey.adminMarkdownCodePlaceholder),
            );
            return;
        }
        applyCodeBlockAction(bodyEl);
    };

    const requestPreview = async (
        mode: "fast" | "full",
        generation: number,
        force = false,
    ): Promise<void> => {
        if (generation !== previewGeneration) {
            return;
        }
        const source = String(bodyEl.value || "");
        const markdown = source.trim();
        if (
            !force &&
            mode === "fast" &&
            !previewDirty &&
            source === previewSource
        ) {
            return;
        }

        if (!markdown) {
            previewSource = source;
            previewHtml = "";
            previewError = "";
            previewLoading = false;
            previewDirty = false;
            renderPreview();
            return;
        }

        previewLoading = true;
        previewError = "";
        if (mode === "fast") {
            const incrementalHtml = previewClient.getIncrementalPreview(source);
            if (incrementalHtml) {
                previewHtml = incrementalHtml;
            }
        }
        renderPreview();

        try {
            const result = await previewClient.preview(markdown, {
                force,
                mode,
            });
            if (generation !== previewGeneration) {
                return;
            }
            if (result.aborted) {
                return;
            }
            if (result.error) {
                previewHtml = "";
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
            console.error("[admin-about] preview failed:", error);
            if (generation !== previewGeneration) {
                return;
            }
            previewHtml = "";
            previewError = t(I18nKey.adminMarkdownPreviewFailedRetry);
            previewDirty = true;
        } finally {
            if (generation === previewGeneration) {
                previewLoading = false;
                renderPreview();
            }
        }
    };

    const schedulePreview = (): void => {
        if (currentMode !== "preview") {
            return;
        }
        if (!previewDirty) {
            return;
        }
        if (previewFastTimer !== null) {
            window.clearTimeout(previewFastTimer);
        }
        if (previewFullTimer !== null) {
            window.clearTimeout(previewFullTimer);
        }
        const generation = previewGeneration;
        previewFastTimer = window.setTimeout(() => {
            previewFastTimer = null;
            void requestPreview("fast", generation);
        }, previewClient.getFastDebounceDelay());
        previewFullTimer = window.setTimeout(() => {
            previewFullTimer = null;
            void requestPreview("full", generation);
        }, previewClient.getFullDebounceDelay());
    };

    const fillForm = (about: Record<string, unknown> | null): void => {
        titleEl.value = toStringValue(about?.title);
        summaryEl.value = toStringValue(about?.summary);
        bodyEl.value = toStringValue(about?.body_markdown);
        previewHtml = "";
        previewError = "";
        previewLoading = false;
        previewDirty = true;
        previewSource = bodyEl.value;
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

    const loadAbout = async (): Promise<void> => {
        setError("");
        setMsg(t(I18nKey.commonLoading));
        try {
            const { response, data } = await api(
                "/api/v1/admin/settings/about",
            );
            if (!response.ok || !data?.ok) {
                setMsg("");
                setError(getApiMessage(data, t(I18nKey.adminAboutLoadFailed)));
                return;
            }
            const about = toRecord(data.about);
            fillForm(about);
            setMsg(t(I18nKey.commonLoaded));
            window.setTimeout(() => {
                if (saveMsgEl.textContent === t(I18nKey.commonLoaded)) {
                    setMsg("");
                }
            }, 1200);
        } catch (error) {
            console.error("[admin-about] load failed:", error);
            setMsg("");
            setError(t(I18nKey.adminAboutLoadFailedRetry));
        }
    };

    const saveAbout = async (): Promise<void> => {
        setError("");
        setMsg(t(I18nKey.commonSaving));
        saveBtnEl.disabled = true;
        await runWithTask(
            {
                title: t(I18nKey.adminAboutSavingTitle),
                mode: "indeterminate",
                text: imagePasteUploader.hasPendingUploads()
                    ? t(I18nKey.commonImageUploading)
                    : t(I18nKey.commonSaving),
            },
            async ({ update }) => {
                try {
                    const uploadsReady =
                        await imagePasteUploader.flushPendingUploads();
                    if (!uploadsReady) {
                        setMsg("");
                        setError(t(I18nKey.commonImageUploadFailedRetry));
                        return;
                    }

                    const bodyMarkdown = String(bodyEl.value || "").trim();
                    if (!bodyMarkdown) {
                        setError(t(I18nKey.adminAboutBodyRequired));
                        return;
                    }

                    update({ text: t(I18nKey.adminAboutSavingText) });
                    const payload = {
                        title: String(titleEl.value || "").trim(),
                        summary: String(summaryEl.value || "").trim(),
                        body_markdown: bodyMarkdown,
                    };
                    const { response, data } = await api(
                        "/api/v1/admin/settings/about",
                        {
                            method: "PATCH",
                            body: JSON.stringify(payload),
                        },
                    );
                    if (!response.ok || !data?.ok) {
                        setMsg("");
                        setError(
                            getApiMessage(data, t(I18nKey.commonSaveFailed)),
                        );
                        return;
                    }
                    update({ text: t(I18nKey.commonSaveCompleted) });
                    fillForm(toRecord(data.about));
                    setMsg(t(I18nKey.commonSaveSuccess));
                } catch (error) {
                    console.error("[admin-about] save failed:", error);
                    setMsg("");
                    setError(t(I18nKey.commonSaveFailedRetry));
                } finally {
                    saveBtnEl.disabled = false;
                }
            },
        );
    };

    modeEditEl.addEventListener("click", () => {
        setEditorMode("edit");
    });
    modePreviewEl.addEventListener("click", () => {
        setEditorMode("preview");
    });

    bodyEl.addEventListener("input", () => {
        markPreviewDirty();
        schedulePreview();
    });
    bodyEl.addEventListener("paste", (event) => {
        imagePasteUploader.handlePaste(event);
    });
    bodyEl.addEventListener("blur", () => {
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

    toolbarEl.addEventListener("click", (event: Event) => {
        const target = event.target as HTMLElement | null;
        if (!target) {
            return;
        }
        const button = target.closest<HTMLButtonElement>("[data-md-action]");
        if (!button) {
            return;
        }
        const action = String(button.dataset.mdAction || "");
        if (!isToolbarAction(action)) {
            return;
        }
        applyToolbarAction(action);
        schedulePreview();
    });

    formEl.addEventListener("submit", (event: Event) => {
        event.preventDefault();
        void saveAbout();
    });

    window.addEventListener("beforeunload", () => {
        imagePasteUploader.dispose();
    });

    setEditorMode("edit");
    void loadAbout();
}
