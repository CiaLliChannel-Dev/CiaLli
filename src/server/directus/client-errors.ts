/**
 * Directus 客户端错误处理工具函数。
 * 从 client.ts 分离以保持文件大小在限制内。
 */

import { isDirectusError } from "@directus/sdk";

import { AppError, internal } from "@/server/api/errors";

export function getDirectusErrorStatus(error: unknown): number | null {
    if (!isDirectusError(error)) {
        return null;
    }
    const response = error.response;
    if (response instanceof Response) {
        return response.status;
    }
    return null;
}

export function getDirectusErrorCodes(error: unknown): string[] {
    if (!isDirectusError(error) || !Array.isArray(error.errors)) {
        return [];
    }
    return error.errors
        .map((entry) => entry.extensions?.code)
        .filter(
            (code): code is string => typeof code === "string" && Boolean(code),
        );
}

export function toDirectusError(action: string, error: unknown): AppError {
    if (!isDirectusError(error)) {
        if (error instanceof AppError) {
            return error;
        }
        return error instanceof Error
            ? internal(`[directus/client] ${action}失败: ${error.message}`)
            : internal(`[directus/client] ${action}失败: ${String(error)}`);
    }

    const status = getDirectusErrorStatus(error);
    const statusText =
        typeof status === "number" ? `(${status})` : "(unknown status)";
    const codeText = getDirectusErrorCodes(error).join(",");
    const detail =
        error.errors
            ?.map((entry) => {
                const code = entry.extensions?.code || "UNKNOWN";
                return `${code}:${entry.message}`;
            })
            .join("; ") || error.message;

    const suffix = codeText ? ` codes=${codeText}` : "";
    const message = `[directus/client] ${action}失败 ${statusText}${suffix}: ${detail}`;

    if (status === 403) {
        return new AppError("DIRECTUS_FORBIDDEN", message, 403);
    }
    if (status === 404) {
        return new AppError("DIRECTUS_NOT_FOUND", message, 404);
    }
    return new AppError("DIRECTUS_ERROR", message, status || 500);
}

export function isDirectusItemNotFound(error: unknown): boolean {
    const status = getDirectusErrorStatus(error);
    if (status === 404) {
        return true;
    }
    return getDirectusErrorCodes(error).includes("ITEM_NOT_FOUND");
}
