import { describe, expect, it, vi } from "vitest";

import {
    DETAIL_PAGE_PRIVATE_CACHE_CONTROL,
    DETAIL_PAGE_PUBLIC_CACHE_CONTROL,
    resolveDetailPageAccess,
    resolveDetailPageCacheControl,
} from "@/server/application/public/detail-page-access.service";

type MockDetail = {
    id: string;
    author_id: string;
};

function createDetail(overrides: Partial<MockDetail> = {}): MockDetail {
    return {
        id: "detail-1",
        author_id: "author-1",
        ...overrides,
    };
}

describe("detail-page-access.service", () => {
    it("公开详情命中时不会读取 session 或 owner fallback", async () => {
        const loadSessionUser = vi.fn();
        const getSessionAccessToken = vi.fn();
        const loadOwnerDetail = vi.fn();

        const result = await resolveDetailPageAccess({
            routeId: "post-1",
            loadPublicDetail: vi.fn().mockResolvedValue(createDetail()),
            loadSessionUser,
            getSessionAccessToken,
            loadOwnerDetail,
        });

        expect(result).toMatchObject({
            mode: "public",
            sessionUserId: null,
        });
        expect(loadSessionUser).not.toHaveBeenCalled();
        expect(getSessionAccessToken).not.toHaveBeenCalled();
        expect(loadOwnerDetail).not.toHaveBeenCalled();
    });

    it("公开未命中且作者本人回退命中时返回 owner 模式", async () => {
        const result = await resolveDetailPageAccess({
            routeId: "draft-1",
            loadPublicDetail: vi.fn().mockResolvedValue(null),
            loadSessionUser: vi.fn().mockResolvedValue({
                id: "author-1",
            }),
            getSessionAccessToken: vi.fn().mockReturnValue("token"),
            loadOwnerDetail: vi.fn().mockResolvedValue(
                createDetail({
                    id: "draft-1",
                }),
            ),
        });

        expect(result).toMatchObject({
            mode: "owner",
            sessionUserId: "author-1",
        });
    });

    it("owner 详情不是当前用户时返回 not_found", async () => {
        const result = await resolveDetailPageAccess({
            routeId: "draft-1",
            loadPublicDetail: vi.fn().mockResolvedValue(null),
            loadSessionUser: vi.fn().mockResolvedValue({
                id: "viewer-1",
            }),
            getSessionAccessToken: vi.fn().mockReturnValue("token"),
            loadOwnerDetail: vi.fn().mockResolvedValue(
                createDetail({
                    author_id: "author-1",
                }),
            ),
        });

        expect(result).toEqual({
            mode: "not_found",
            sessionUserId: "viewer-1",
        });
    });

    it("缓存头对 owner/public/404/500 分支与详情模式一致", () => {
        expect(
            resolveDetailPageCacheControl({
                responseStatus: 200,
                mode: "owner",
            }),
        ).toBe(DETAIL_PAGE_PRIVATE_CACHE_CONTROL);
        expect(
            resolveDetailPageCacheControl({
                responseStatus: 200,
                mode: "public",
            }),
        ).toBe(DETAIL_PAGE_PUBLIC_CACHE_CONTROL);
        expect(
            resolveDetailPageCacheControl({
                responseStatus: 404,
                mode: "not_found",
            }),
        ).toBe(DETAIL_PAGE_PUBLIC_CACHE_CONTROL);
        expect(
            resolveDetailPageCacheControl({
                responseStatus: 500,
                mode: "error",
            }),
        ).toBeNull();
    });
});
