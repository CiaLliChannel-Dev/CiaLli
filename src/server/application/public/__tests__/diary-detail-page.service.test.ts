import { describe, expect, it, vi } from "vitest";

import {
    loadDiaryDetailViewData,
    type DiaryInteractionSnapshot,
} from "@/server/application/public/diary-detail-page.service";
import type { DiaryDetail } from "@/server/api/v1/public-data";

function createDiary(overrides: Partial<DiaryDetail> = {}): DiaryDetail {
    return {
        id: "diary-1",
        short_id: "diary-short-1",
        author_id: "author-1",
        status: "published",
        content: "content",
        allow_comments: true,
        praviate: true,
        date_created: null,
        date_updated: null,
        author: {
            id: "author-1",
            name: "alice",
            username: "alice",
        },
        images: [],
        ...overrides,
    };
}

describe("diary-detail-page.service", () => {
    it("公开模式加载视图数据时只读取公共 profile，并把 interaction viewerId 固定为空", async () => {
        const loadPublicProfileByUserId = vi.fn().mockResolvedValue({
            user_id: "author-1",
            username: "alice",
            display_name: "Alice",
            bio: null,
            avatar_file: null,
            social_links: null,
            is_official: false,
        });
        const loadProfileForViewerByUserId = vi.fn();
        const loadDiaryInteractionSnapshotMock = vi
            .fn<() => Promise<DiaryInteractionSnapshot>>()
            .mockResolvedValue({
                likeCount: 12,
                commentCount: 3,
                viewerLiked: false,
            });

        const result = await loadDiaryDetailViewData({
            diary: createDiary(),
            mode: "public",
            sessionUserId: null,
            loadAuthorBundle: vi.fn().mockResolvedValue(new Map()),
            loadDiaryInteractionSnapshot: loadDiaryInteractionSnapshotMock,
            loadPublicProfileByUserId,
            loadProfileForViewerByUserId,
            renderDiaryMarkdown: vi.fn().mockResolvedValue("<p>body</p>"),
        });

        expect(result.authorProfile).toEqual(
            expect.objectContaining({
                username: "alice",
            }),
        );
        expect(loadPublicProfileByUserId).toHaveBeenCalledWith("author-1");
        expect(loadProfileForViewerByUserId).not.toHaveBeenCalled();
        expect(loadDiaryInteractionSnapshotMock).toHaveBeenCalledWith({
            diaryId: "diary-1",
            viewerId: null,
        });
        expect(result.diaryHtml).toBe("<p>body</p>");
    });

    it("owner 模式会读取 viewer-aware profile，并把 viewerId 传给 interaction", async () => {
        const loadPublicProfileByUserId = vi.fn();
        const loadProfileForViewerByUserId = vi.fn().mockResolvedValue({
            user_id: "author-1",
            username: "alice",
            display_name: "Alice",
            bio: null,
            avatar_file: null,
            social_links: null,
            is_official: false,
        });
        const loadDiaryInteractionSnapshotMock = vi
            .fn<() => Promise<DiaryInteractionSnapshot>>()
            .mockResolvedValue({
                likeCount: 5,
                commentCount: 2,
                viewerLiked: true,
            });

        const result = await loadDiaryDetailViewData({
            diary: createDiary({
                status: "published",
                praviate: true,
            }),
            mode: "owner",
            sessionUserId: "author-1",
            loadAuthorBundle: vi.fn().mockResolvedValue(new Map()),
            loadDiaryInteractionSnapshot: loadDiaryInteractionSnapshotMock,
            loadPublicProfileByUserId,
            loadProfileForViewerByUserId,
            renderDiaryMarkdown: vi.fn().mockResolvedValue("<p>draft</p>"),
        });

        expect(loadPublicProfileByUserId).not.toHaveBeenCalled();
        expect(loadProfileForViewerByUserId).toHaveBeenCalledWith(
            "author-1",
            "author-1",
        );
        expect(loadDiaryInteractionSnapshotMock).toHaveBeenCalledWith({
            diaryId: "diary-1",
            viewerId: "author-1",
        });
        expect(result.interaction.viewerLiked).toBe(true);
    });
});
