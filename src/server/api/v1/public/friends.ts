import type { APIContext } from "astro";

import type { JsonObject } from "@/types/json";
import { countItems, readMany } from "@/server/directus/client";
import { fail, ok } from "@/server/api/response";
import { parsePagination } from "@/server/api/utils";

import { filterPublicStatus, safeCsv } from "../shared";

export async function handlePublicFriends(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    if (context.request.method !== "GET") {
        return fail("方法不允许", 405);
    }
    if (segments.length !== 2) {
        return fail("未找到接口", 404);
    }

    const { page, limit, offset } = parsePagination(context.url);
    const tag = (context.url.searchParams.get("tag")?.trim() || "").slice(
        0,
        100,
    );
    const q = (context.url.searchParams.get("q")?.trim() || "").slice(0, 200);

    const andFilters: JsonObject[] = [filterPublicStatus()];
    if (tag) {
        andFilters.push({ tags: { _contains: tag } });
    }
    if (q) {
        andFilters.push({
            _or: [
                { title: { _icontains: q } },
                { description: { _icontains: q } },
                { site_url: { _icontains: q } },
            ],
        });
    }

    const filter = { _and: andFilters } as JsonObject;
    const [rows, total] = await Promise.all([
        readMany("app_friends", {
            filter,
            sort: ["sort", "-date_created"],
            limit,
            offset,
        }),
        countItems("app_friends", filter),
    ]);

    const items = rows.map((row) => ({
        ...row,
        tags: safeCsv(row.tags),
    }));

    return ok({
        items,
        page,
        limit,
        total,
    });
}
