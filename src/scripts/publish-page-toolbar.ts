/**
 * 发布页面工具栏操作
 *
 * Markdown 编辑器工具栏的各类文本插入/包裹动作。
 * 不依赖 DOM 状态或业务逻辑，可独立测试。
 */

import I18nKey from "@/i18n/i18nKey";
import { t } from "@/scripts/i18n-runtime";
import {
    type ToolbarAction,
    TOOLBAR_ACTIONS,
} from "@/scripts/publish-page-helpers";

function isToolbarAction(value: string): value is ToolbarAction {
    return TOOLBAR_ACTIONS.has(value as ToolbarAction);
}

function replaceSelection(
    textarea: HTMLTextAreaElement,
    replacement: string,
    selectionStartOffset: number,
    selectionEndOffset: number,
    markPreviewDirty: () => void,
): void {
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
}

function applyWrapAction(
    textarea: HTMLTextAreaElement,
    prefix: string,
    suffix: string,
    placeholder: string,
    markPreviewDirty: () => void,
): void {
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
        markPreviewDirty,
    );
}

function applyQuoteAction(
    textarea: HTMLTextAreaElement,
    markPreviewDirty: () => void,
): void {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end);
    const source = selected || t(I18nKey.articleEditorToolbarQuotePlaceholder);
    const quoted = source
        .replaceAll("\r\n", "\n")
        .split("\n")
        .map((line) => (line.startsWith("> ") ? line : `> ${line}`))
        .join("\n");
    replaceSelection(textarea, quoted, 0, quoted.length, markPreviewDirty);
}

function applyCodeBlockAction(
    textarea: HTMLTextAreaElement,
    markPreviewDirty: () => void,
): void {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const source = textarea.value;
    const selected =
        source.slice(start, end) ||
        t(I18nKey.articleEditorToolbarCodeBlockPlaceholder);
    const language = "text";
    const block = `\`\`\`${language}\n${selected}\n\`\`\``;
    const needsLeadingBreak = start > 0 && source[start - 1] !== "\n";
    const needsTrailingBreak = end < source.length && source[end] !== "\n";
    const prefix = needsLeadingBreak ? "\n" : "";
    const suffix = needsTrailingBreak ? "\n" : "";
    const replacement = `${prefix}${block}${suffix}`;
    const contentStart = prefix.length + `\`\`\`${language}\n`.length;
    const contentEnd = contentStart + selected.length;
    replaceSelection(
        textarea,
        replacement,
        contentStart,
        contentEnd,
        markPreviewDirty,
    );
}

export function applyToolbarAction(
    action: string,
    articleBodyInput: HTMLTextAreaElement,
    markPreviewDirty: () => void,
): void {
    if (!isToolbarAction(action)) {
        return;
    }
    if (action === "bold") {
        applyWrapAction(
            articleBodyInput,
            "**",
            "**",
            t(I18nKey.articleEditorToolbarBoldPlaceholder),
            markPreviewDirty,
        );
        return;
    }
    if (action === "italic") {
        applyWrapAction(
            articleBodyInput,
            "*",
            "*",
            t(I18nKey.articleEditorToolbarItalicPlaceholder),
            markPreviewDirty,
        );
        return;
    }
    if (action === "underline") {
        applyWrapAction(
            articleBodyInput,
            "<u>",
            "</u>",
            t(I18nKey.articleEditorToolbarUnderlinePlaceholder),
            markPreviewDirty,
        );
        return;
    }
    if (action === "strike") {
        applyWrapAction(
            articleBodyInput,
            "~~",
            "~~",
            t(I18nKey.articleEditorToolbarStrikePlaceholder),
            markPreviewDirty,
        );
        return;
    }
    if (action === "quote") {
        applyQuoteAction(articleBodyInput, markPreviewDirty);
        return;
    }
    if (action === "inline-code") {
        applyWrapAction(
            articleBodyInput,
            "`",
            "`",
            t(I18nKey.articleEditorToolbarInlineCodePlaceholder),
            markPreviewDirty,
        );
        return;
    }
    applyCodeBlockAction(articleBodyInput, markPreviewDirty);
}
