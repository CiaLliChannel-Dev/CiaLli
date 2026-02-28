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
import { getApiErrorMessage, requestApi as api } from "@/scripts/http-client";

type EditorMode = "edit" | "preview";
type ToolbarAction =
    | "bold"
    | "italic"
    | "underline"
    | "strike"
    | "quote"
    | "inline-code"
    | "code-block";

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

const DATA_BOUND = "data-admin-bulletin-bound";

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

function isToolbarAction(value: string): value is ToolbarAction {
    return TOOLBAR_ACTIONS.has(value as ToolbarAction);
}

export function initAdminBulletinPage(): void {
    const normalizedPath = window.location.pathname.replace(/\/+$/, "") || "/";
    if (normalizedPath !== "/admin/settings/bulletin") {
        return;
    }

    const formEl = document.getElementById(
        "bulletin-form",
    ) as HTMLFormElement | null;
    if (!formEl || formEl.hasAttribute(DATA_BOUND)) {
        return;
    }
    formEl.setAttribute(DATA_BOUND, "1");

    const titleEl = document.getElementById(
        "bulletin-title",
    ) as HTMLInputElement | null;
    const summaryEl = document.getElementById(
        "bulletin-summary",
    ) as HTMLTextAreaElement | null;
    const closableEl = document.getElementById(
        "bulletin-closable",
    ) as HTMLInputElement | null;
    const bodyEl = document.getElementById(
        "bulletin-body-markdown",
    ) as HTMLTextAreaElement | null;
    const modeEditEl = document.getElementById(
        "bulletin-mode-edit",
    ) as HTMLButtonElement | null;
    const modePreviewEl = document.getElementById(
        "bulletin-mode-preview",
    ) as HTMLButtonElement | null;
    const editorPanelEl = document.getElementById("bulletin-editor-panel");
    const toolbarEl = document.getElementById("bulletin-toolbar");
    const saveMsgEl = document.getElementById("bulletin-save-msg");
    const saveErrorEl = document.getElementById("bulletin-save-error");
    const saveBtnEl = document.getElementById(
        "bulletin-save",
    ) as HTMLButtonElement | null;

    const previewPanelEl = document.getElementById("bulletin-preview-panel");
    const previewLoadingEl = document.getElementById(
        "bulletin-preview-loading",
    );
    const previewErrorEl = document.getElementById("bulletin-preview-error");
    const previewEmptyEl = document.getElementById("bulletin-preview-empty");
    const previewContentEl = document.getElementById(
        "bulletin-preview-content",
    );

    if (
        !titleEl ||
        !summaryEl ||
        !closableEl ||
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
    const previewClient = new MarkdownPreviewClient("bulletin");

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
            console.warn(
                "[admin-bulletin] refresh github cards failed:",
                error,
            );
        }
        if (typeof runtimeWindow.renderMermaidDiagrams === "function") {
            void runtimeWindow.renderMermaidDiagrams().catch((error) => {
                console.warn("[admin-bulletin] refresh mermaid failed:", error);
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
        fileNamePrefix: "bulletin",
        autoUpload: false,
        buildUploadTitle: ({ sequence }) =>
            `About-${String(sequence).padStart(2, "0")}`,
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
            console.error("[admin-bulletin] preview failed:", error);
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

    const fillForm = (announcement: Record<string, unknown> | null): void => {
        titleEl.value = toStringValue(announcement?.title);
        summaryEl.value = toStringValue(announcement?.summary);
        bodyEl.value = toStringValue(announcement?.body_markdown);
        closableEl.checked = Boolean(announcement?.closable);
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

    const loadBulletin = async (): Promise<void> => {
        setError("");
        setMsg(t(I18nKey.commonLoading));
        try {
            const { response, data } = await api(
                "/api/v1/admin/settings/bulletin",
            );
            if (!response.ok || !data?.ok) {
                setMsg("");
                setError(
                    getApiErrorMessage(
                        data,
                        t(I18nKey.adminBulletinLoadFailed),
                    ),
                );
                return;
            }
            const announcement = toRecord(data.announcement);
            fillForm(announcement);
            setMsg(t(I18nKey.commonLoaded));
            window.setTimeout(() => {
                if (saveMsgEl.textContent === t(I18nKey.commonLoaded)) {
                    setMsg("");
                }
            }, 1200);
        } catch (error) {
            console.error("[admin-bulletin] load failed:", error);
            setMsg("");
            setError(t(I18nKey.adminBulletinLoadFailedRetry));
        }
    };

    const saveBulletin = async (): Promise<void> => {
        setError("");
        setMsg(t(I18nKey.commonSaving));
        saveBtnEl.disabled = true;
        await runWithTask(
            {
                title: t(I18nKey.adminBulletinSavingTitle),
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
                        setError(t(I18nKey.adminBulletinBodyRequired));
                        return;
                    }

                    update({ text: t(I18nKey.adminBulletinSavingText) });
                    const payload = {
                        title: String(titleEl.value || "").trim(),
                        summary: String(summaryEl.value || "").trim(),
                        body_markdown: bodyMarkdown,
                        closable: Boolean(closableEl.checked),
                    };
                    const { response, data } = await api(
                        "/api/v1/admin/settings/bulletin",
                        {
                            method: "PATCH",
                            body: JSON.stringify(payload),
                        },
                    );
                    if (!response.ok || !data?.ok) {
                        setMsg("");
                        setError(
                            getApiErrorMessage(
                                data,
                                t(I18nKey.commonSaveFailed),
                            ),
                        );
                        return;
                    }
                    update({ text: t(I18nKey.commonSaveCompleted) });
                    fillForm(toRecord(data.announcement));
                    setMsg(t(I18nKey.commonSaveSuccess));
                } catch (error) {
                    console.error("[admin-bulletin] save failed:", error);
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
        void saveBulletin();
    });

    window.addEventListener("beforeunload", () => {
        imagePasteUploader.dispose();
    });

    setEditorMode("edit");
    void loadBulletin();
}
