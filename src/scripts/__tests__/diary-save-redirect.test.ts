import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    buildDiaryDetailSuccessRedirectUrl,
    buildDiarySaveSuccessRedirectUrl,
} from "@/scripts/shared/editor-save-redirect";
import { EDITOR_SAVE_FRESHNESS_PARAM } from "@/utils/editor-save-freshness";

const navigateToPage = vi.fn();
const materializePendingUploads = vi.fn();
const persistDiaryImages = vi.fn();
const updateTask = vi.fn();
const finishTask = vi.fn();
const startTask = vi.fn();

vi.mock("@/utils/navigation-utils", () => ({
    navigateToPage,
}));

vi.mock("@/scripts/shared/progress-overlay-manager", () => ({
    finishTask,
    startTask,
    updateTask,
}));

vi.mock("@/scripts/diary-editor/helpers", () => ({
    api: vi.fn(async () => ({
        response: new Response(JSON.stringify({ ok: true }), { status: 200 }),
        data: {
            ok: true,
            item: {
                id: "diary-1",
                short_id: "diary-short",
            },
        },
    })),
    getApiMessage: vi.fn(
        (_data: Record<string, unknown> | null, fallback: string) => fallback,
    ),
    materializePendingUploads,
    persistDiaryImages,
    toRecord: (value: unknown): Record<string, unknown> | null =>
        value && typeof value === "object" && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : null,
    toStringValue: (value: unknown): string => String(value ?? "").trim(),
}));

describe("diary save redirect", () => {
    beforeEach(() => {
        navigateToPage.mockClear();
        materializePendingUploads.mockResolvedValue({
            content: "content",
            uploads: [],
        });
        persistDiaryImages.mockResolvedValue(undefined);
        updateTask.mockClear();
        finishTask.mockClear();
        startTask.mockReturnValue(1);
    });

    it("日记草稿保存成功后返回日记列表", async () => {
        const { executeSaveDiary } =
            await import("@/scripts/diary-editor/save");

        await executeSaveDiary(makeSaveDiaryContext(), {
            successRedirectUrl: buildDiarySaveSuccessRedirectUrl("alice"),
            targetStatus: "draft",
        });

        expect(navigateToPage).toHaveBeenCalledWith("/alice/diary", {
            force: true,
            replace: true,
        });
    });

    it("日记发布和保存修改成功后进入日记详情页", async () => {
        const { executeSaveDiary } =
            await import("@/scripts/diary-editor/save");

        await executeSaveDiary(makeSaveDiaryContext(), {
            targetStatus: "published",
        });
        await executeSaveDiary(
            makeSaveDiaryContext({
                editorMode: "edit",
                getCurrentStatus: () => "published",
            }),
            {
                targetStatus: "published",
            },
        );

        expect(navigateToPage).toHaveBeenCalledTimes(2);
        expect(navigateToPage).toHaveBeenNthCalledWith(
            1,
            expect.stringMatching(
                new RegExp(
                    `^/alice/diary/diary-short\\?${EDITOR_SAVE_FRESHNESS_PARAM}=`,
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
                    `^/alice/diary/diary-short\\?${EDITOR_SAVE_FRESHNESS_PARAM}=`,
                ),
            ),
            {
                force: true,
                replace: true,
            },
        );
    });

    it("日记未保存守卫保存路径不触发列表跳转", async () => {
        const { executeSaveDiary } =
            await import("@/scripts/diary-editor/save");

        await executeSaveDiary(makeSaveDiaryContext(), {
            redirectOnSuccess: false,
            targetStatus: "draft",
        });

        expect(navigateToPage).not.toHaveBeenCalled();
    });

    it("日记详情跳转目标由同一共享模块生成", () => {
        expect(
            buildDiaryDetailSuccessRedirectUrl("alice", {
                id: "diary-1",
                short_id: "diary-short",
            }),
        ).toBe("/alice/diary/diary-short");
    });
});

function makeSaveDiaryContext(
    overrides: Partial<
        import("@/scripts/diary-editor/save").SaveDiaryContext
    > = {},
): import("@/scripts/diary-editor/save").SaveDiaryContext {
    return {
        editorMode: "create",
        contentInput: { value: "content" } as HTMLTextAreaElement,
        allowCommentsInput: { checked: true } as HTMLInputElement,
        isPublicInput: { checked: true } as HTMLInputElement,
        saveDraftBtn: null,
        savePublishedBtn: {
            disabled: false,
            textContent: "",
        } as HTMLButtonElement,
        publishButtonIdleText: "publish",
        publishButtonLoadingText: "publishing",
        draftButtonIdleText: "draft",
        draftButtonLoadingText: "saving",
        username: "alice",
        getCurrentDiaryId: () => "",
        setCurrentDiaryId: vi.fn(),
        getCurrentStatus: () => "",
        setCurrentStatus: vi.fn(),
        pendingUploads: new Map(),
        getImageOrderItems: () => [],
        deletedExistingImageIds: new Set(),
        getSaveTaskHandle: () => 1,
        setSaveTaskHandle: vi.fn(),
        setSubmitMessage: vi.fn(),
        setSubmitError: vi.fn(),
        setUploadMessage: vi.fn(),
        setSavingState: vi.fn(),
        markDraftSaved: vi.fn(),
        ...overrides,
    };
}
