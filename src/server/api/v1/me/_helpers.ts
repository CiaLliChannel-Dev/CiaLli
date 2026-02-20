import {
    renderMarkdown,
    type MarkdownRenderMode,
} from "@/server/markdown/render";
import { updateDirectusFileMetadata } from "@/server/directus/client";

import { normalizeDirectusFileId } from "../shared/file-cleanup";

export function isSlugUniqueConflict(error: unknown): boolean {
    const message = String(error).toLowerCase();
    return (
        message.includes('field "slug"') ||
        message.includes(" field slug ") ||
        message.includes(".slug")
    );
}

export async function renderMeMarkdownPreview(
    markdown: string,
    mode: MarkdownRenderMode = "full",
): Promise<string> {
    const source = String(markdown || "");
    if (!source.trim()) {
        return "";
    }
    try {
        return await renderMarkdown(source, { target: "page", mode });
    } catch (error) {
        console.error("[me] markdown preview failed:", error);
        return "";
    }
}

export async function bindFileOwnerToUser(
    fileValue: unknown,
    userId: string,
    title?: string,
): Promise<void> {
    const fileId = normalizeDirectusFileId(fileValue);
    if (!fileId) {
        return;
    }
    await updateDirectusFileMetadata(fileId, {
        uploaded_by: userId,
        title: title?.trim() || undefined,
    });
}
