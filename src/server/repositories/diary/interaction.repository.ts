import type { JsonObject } from "@/types/json";
import { cacheManager } from "@/server/cache/manager";
import { countItems, readMany } from "@/server/directus/client";

type DiaryInteractionAggregate = {
    likeCount: number;
    commentCount: number;
};

export type DiaryInteractionSnapshot = DiaryInteractionAggregate & {
    viewerLiked: boolean;
};

function normalizeIdentity(value: string | null | undefined): string {
    return String(value || "").trim();
}

function buildAggregateKey(diaryId: string): string {
    return `agg:${diaryId}`;
}

function buildViewerKey(diaryId: string, viewerId: string): string {
    return `viewer:${diaryId}:${viewerId}`;
}

async function loadDiaryInteractionAggregate(
    diaryId: string,
): Promise<DiaryInteractionAggregate> {
    const normalizedDiaryId = normalizeIdentity(diaryId);
    if (!normalizedDiaryId) {
        return {
            likeCount: 0,
            commentCount: 0,
        };
    }

    const cacheKey = buildAggregateKey(normalizedDiaryId);
    const cached = await cacheManager.get<DiaryInteractionAggregate>(
        "diary-interaction",
        cacheKey,
    );
    if (cached) {
        return cached;
    }

    const [likeCount, commentCount] = await Promise.all([
        countItems("app_diary_likes", {
            _and: [
                { diary_id: { _eq: normalizedDiaryId } },
                { status: { _eq: "published" } },
            ],
        } as JsonObject),
        countItems("app_diary_comments", {
            _and: [
                { diary_id: { _eq: normalizedDiaryId } },
                { status: { _eq: "published" } },
                { is_public: { _eq: true } },
            ],
        } as JsonObject),
    ]);

    const value = {
        likeCount,
        commentCount,
    } satisfies DiaryInteractionAggregate;
    void cacheManager.set("diary-interaction", cacheKey, value);
    return value;
}

async function loadViewerLikedState(
    diaryId: string,
    viewerId: string | null | undefined,
): Promise<boolean> {
    const normalizedDiaryId = normalizeIdentity(diaryId);
    const normalizedViewerId = normalizeIdentity(viewerId);
    if (!normalizedDiaryId || !normalizedViewerId) {
        return false;
    }

    const cacheKey = buildViewerKey(normalizedDiaryId, normalizedViewerId);
    const cached = await cacheManager.get<boolean>(
        "diary-interaction",
        cacheKey,
    );
    if (typeof cached === "boolean") {
        return cached;
    }

    const rows = await readMany("app_diary_likes", {
        filter: {
            _and: [
                { diary_id: { _eq: normalizedDiaryId } },
                { user_id: { _eq: normalizedViewerId } },
                { status: { _eq: "published" } },
            ],
        } as JsonObject,
        limit: 1,
        fields: ["id"],
    });
    const liked = rows.length > 0;
    void cacheManager.set("diary-interaction", cacheKey, liked);
    return liked;
}

export async function loadDiaryInteractionSnapshotFromRepository(input: {
    diaryId: string;
    viewerId?: string | null;
}): Promise<DiaryInteractionSnapshot> {
    const diaryId = normalizeIdentity(input.diaryId);
    const viewerId = normalizeIdentity(input.viewerId);
    if (!diaryId) {
        return {
            likeCount: 0,
            commentCount: 0,
            viewerLiked: false,
        };
    }

    const [aggregate, viewerLiked] = await Promise.all([
        loadDiaryInteractionAggregate(diaryId),
        viewerId
            ? loadViewerLikedState(diaryId, viewerId)
            : Promise.resolve(false),
    ]);

    return {
        ...aggregate,
        viewerLiked,
    };
}

export async function invalidateDiaryInteractionAggregateFromRepository(
    diaryId: string,
): Promise<void> {
    const normalizedDiaryId = normalizeIdentity(diaryId);
    if (!normalizedDiaryId) {
        return;
    }
    await cacheManager.invalidate(
        "diary-interaction",
        buildAggregateKey(normalizedDiaryId),
    );
}

export async function invalidateDiaryInteractionViewerStateFromRepository(
    diaryId: string,
    viewerId: string,
): Promise<void> {
    const normalizedDiaryId = normalizeIdentity(diaryId);
    const normalizedViewerId = normalizeIdentity(viewerId);
    if (!normalizedDiaryId || !normalizedViewerId) {
        return;
    }
    await cacheManager.invalidate(
        "diary-interaction",
        buildViewerKey(normalizedDiaryId, normalizedViewerId),
    );
}
