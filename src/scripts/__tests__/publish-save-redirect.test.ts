import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    ARTICLE_SAVE_SUCCESS_REDIRECT_URL,
    buildArticleDetailSuccessRedirectUrl,
    buildDiarySaveSuccessRedirectUrl,
} from "@/scripts/shared/editor-save-redirect";
import { EDITOR_SAVE_FRESHNESS_PARAM } from "@/utils/editor-save-freshness";

const navigateToPage = vi.fn();

vi.mock("@/utils/navigation-utils", () => ({
    navigateToPage,
}));

describe("publish save redirect", () => {
    beforeEach(() => {
        navigateToPage.mockClear();
    });

    it("文章草稿保存成功后返回文章列表", async () => {
        const { handleSubmitApiResponse } =
            await import("@/scripts/publish/page-submit");
        await handleSubmitApiResponse(
            makePublishState(),
            makeUiHelpers(),
            async () => true,
            "",
            { item: { id: "draft-1", short_id: "draft-short" } },
            {
                successRedirectUrl: ARTICLE_SAVE_SUCCESS_REDIRECT_URL,
                targetStatus: "draft",
            },
        );

        expect(navigateToPage).toHaveBeenCalledWith("/posts", {
            force: true,
            replace: true,
        });
    });

    it("文章发布和保存修改成功后进入文章详情页", async () => {
        const { handleSubmitApiResponse } =
            await import("@/scripts/publish/page-submit");
        await handleSubmitApiResponse(
            makePublishState(),
            makeUiHelpers(),
            async () => true,
            "",
            {
                item: {
                    id: "post-1",
                    short_id: "post-short",
                    slug: "published post",
                },
            },
            {
                targetStatus: "published",
            },
        );
        await handleSubmitApiResponse(
            makePublishState({ currentStatus: "published" }),
            makeUiHelpers(),
            async () => true,
            "",
            { item: { id: "post-1", short_id: "post-short" } },
            {
                targetStatus: "published",
            },
        );

        expect(navigateToPage).toHaveBeenCalledTimes(2);
        expect(navigateToPage).toHaveBeenNthCalledWith(
            1,
            expect.stringMatching(
                new RegExp(
                    `^/posts/published%20post\\?${EDITOR_SAVE_FRESHNESS_PARAM}=`,
                ),
            ),
            {
                force: true,
                replace: true,
            },
        );
        expect(navigateToPage).toHaveBeenNthCalledWith(
            2,
            expect.stringMatching(
                new RegExp(
                    `^/posts/post-short\\?${EDITOR_SAVE_FRESHNESS_PARAM}=`,
                ),
            ),
            {
                force: true,
                replace: true,
            },
        );
    });

    it("文章未保存守卫保存路径不触发列表跳转", async () => {
        const { handleSubmitApiResponse } =
            await import("@/scripts/publish/page-submit");
        await handleSubmitApiResponse(
            makePublishState(),
            makeUiHelpers(),
            async () => true,
            "",
            { item: { id: "draft-1", short_id: "draft-short" } },
            {
                redirectOnSuccess: false,
                targetStatus: "draft",
            },
        );

        expect(navigateToPage).not.toHaveBeenCalled();
    });

    it("日记跳转目标由同一共享模块生成", () => {
        expect(buildDiarySaveSuccessRedirectUrl("alice")).toBe("/alice/diary");
        expect(
            buildArticleDetailSuccessRedirectUrl({
                id: "post-1",
                short_id: "post-short",
            }),
        ).toBe("/posts/post-short");
    });
});

function makePublishState(
    overrides: Partial<
        import("@/scripts/publish/page-submit").PublishState
    > = {},
): import("@/scripts/publish/page-submit").PublishState {
    return {
        currentItemId: "",
        currentItemShortId: "",
        currentStatus: "",
        currentCoverFileId: "",
        currentUsername: "alice",
        isLoggedIn: true,
        previewError: "",
        previewHtml: "",
        previewSource: "",
        previewDirty: false,
        renderedPreviewHtml: "",
        previewGeneration: 0,
        previewFastTimer: null,
        previewFullTimer: null,
        initializedAfterLogin: true,
        loadedEncryptedBody: "",
        loadedEncryptedBodyUnlocked: false,
        inlineImageCounter: 0,
        ...overrides,
    };
}

function makeUiHelpers(): import("@/scripts/publish/page-submit").UiHelpers {
    return {
        setSubmitError: vi.fn(),
        setSubmitMessage: vi.fn(),
        setCoverMessage: vi.fn(),
        updateEncryptHint: vi.fn(),
        updateEncryptPanel: vi.fn(),
        updateTitleHint: vi.fn(),
        updateEditorHeader: vi.fn(),
        updateSettingsActions: vi.fn(),
        updateUrlState: vi.fn(),
        updateCoverPreview: vi.fn(),
    };
}
