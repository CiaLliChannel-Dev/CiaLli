import type { APIContext } from "astro";

import { readDirectusAssetResponse } from "@/server/directus/client";
import { AppError } from "@/server/api/errors";
import { fail } from "@/server/api/response";

import { parseRouteId, toDirectusAssetQuery } from "../shared";

export async function handlePublicAsset(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    if (context.request.method !== "GET") {
        return fail("方法不允许", 405);
    }

    if (segments.length !== 3) {
        return fail("资源不存在", 404);
    }

    const fileId = parseRouteId(segments[2]);
    if (!fileId) {
        return fail("缺少文件 ID", 400);
    }

    const response = await readDirectusAssetResponse({
        fileId,
        query: toDirectusAssetQuery(context.url.searchParams),
    });

    if (!response.ok) {
        if (response.status === 404 || response.status === 403) {
            return fail("资源不存在", 404);
        }
        throw new AppError(
            "ASSET_FETCH_FAILED",
            `资源获取失败: ${response.status} ${response.statusText}`,
            response.status >= 400 && response.status < 500
                ? response.status
                : 502,
        );
    }

    const headers = new Headers();
    const contentType = response.headers.get("content-type");
    const contentLength = response.headers.get("content-length");
    const cacheControl = response.headers.get("cache-control");
    const etag = response.headers.get("etag");
    const lastModified = response.headers.get("last-modified");

    if (contentType) {
        headers.set("content-type", contentType);
    }
    if (contentLength) {
        headers.set("content-length", contentLength);
    }
    if (etag) {
        headers.set("etag", etag);
    }
    if (lastModified) {
        headers.set("last-modified", lastModified);
    }

    // 图片资源使用长缓存（文件 ID 内容寻址，更换文件 = 新 ID）
    const isImage = Boolean(contentType && contentType.startsWith("image/"));
    headers.set(
        "cache-control",
        isImage
            ? "public, max-age=31536000, immutable"
            : cacheControl || "public, max-age=300, s-maxage=300",
    );

    return new Response(response.body, {
        status: 200,
        headers,
    });
}
