import { getAuthorBundle } from "@/server/api/v1/shared/author-cache";
import { DIARY_FIELDS, safeCsv } from "@/server/api/v1/shared";
import { cacheManager } from "@/server/cache/manager";
import { hashParams } from "@/server/cache/key-utils";
import { readMany } from "@/server/directus/client";
import { initPostIdMap } from "@/utils/permalink-utils";
import { getSortedPosts } from "@/utils/content-utils";
import type { JsonObject } from "@/types/json";
import type { AppArticle, AppDiary, AppDiaryImage } from "@/types/app";
import type {
    HomeFeedArticleCandidate,
    HomeFeedBuildOptions,
    HomeFeedBuildResult,
    HomeFeedCandidate,
    HomeFeedDiaryCandidate,
    HomeFeedDiaryEntry,
    HomeFeedItem,
    HomeFeedItemType,
    HomeFeedPreferenceProfile,
    HomeFeedScoreInput,
    HomeFeedScoredCandidate,
} from "./home-feed.types";

const DEFAULT_ARTICLE_CANDIDATE_LIMIT = 240;
const DEFAULT_DIARY_CANDIDATE_LIMIT = 160;
const DEFAULT_OUTPUT_LIMIT = 180;
const DEFAULT_ENGAGEMENT_WINDOW_HOURS = 72;
const DEFAULT_PERSONALIZATION_LOOKBACK_DAYS = 30;

const AUTHOR_COOLDOWN_WINDOW = 2;
const MAX_TYPE_STREAK = 3;
const MIX_PATTERN: HomeFeedItemType[] = [
    "article",
    "article",
    "diary",
    "article",
    "diary",
];

const RECENCY_DECAY_HOURS = 36;

export const HOME_FEED_ALGO_VERSION = "home-feed-v1";

type InteractionCollection =
    | "app_article_likes"
    | "app_article_comments"
    | "app_diary_likes"
    | "app_diary_comments";

type InteractionRelationField = "article_id" | "diary_id";

type PickConstraint = {
    enforceAuthorCooldown: boolean;
    enforceTypeStreak: boolean;
};

const PICK_CONSTRAINTS: PickConstraint[] = [
    { enforceAuthorCooldown: true, enforceTypeStreak: true },
    { enforceAuthorCooldown: false, enforceTypeStreak: true },
    { enforceAuthorCooldown: false, enforceTypeStreak: false },
];

function clamp01(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    if (value <= 0) {
        return 0;
    }
    if (value >= 1) {
        return 1;
    }
    return value;
}

function normalizeIdentity(value: string | null | undefined): string {
    return String(value || "").trim();
}

function normalizePreferenceKey(value: string | null | undefined): string {
    return String(value || "")
        .trim()
        .toLowerCase();
}

function normalizePositiveInt(
    value: number | undefined,
    fallback: number,
    max: number,
): number {
    const normalized =
        typeof value === "number" && Number.isFinite(value)
            ? Math.floor(value)
            : fallback;
    if (normalized <= 0) {
        return fallback;
    }
    return Math.min(normalized, max);
}

function toSafeDate(value: Date | string | null | undefined): Date {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value;
    }
    const parsed = new Date(String(value || ""));
    if (Number.isNaN(parsed.getTime())) {
        return new Date(0);
    }
    return parsed;
}

function createEmptyPreferenceProfile(): HomeFeedPreferenceProfile {
    return {
        authorWeights: new Map(),
        tagWeights: new Map(),
        categoryWeights: new Map(),
    };
}

function incrementMapCounter(map: Map<string, number>, key: string): void {
    const normalizedKey = normalizeIdentity(key);
    if (!normalizedKey) {
        return;
    }
    map.set(normalizedKey, (map.get(normalizedKey) || 0) + 1);
}

function normalizeWeightMap(source: Map<string, number>): Map<string, number> {
    if (source.size === 0) {
        return new Map();
    }
    const maxValue = Math.max(...source.values());
    if (!Number.isFinite(maxValue) || maxValue <= 0) {
        return new Map();
    }
    const normalized = new Map<string, number>();
    for (const [key, value] of source.entries()) {
        normalized.set(key, clamp01(value / maxValue));
    }
    return normalized;
}

function buildCountMapByRelation(
    rows: Array<Record<string, unknown>>,
    relationField: InteractionRelationField,
): Map<string, number> {
    const counter = new Map<string, number>();
    for (const row of rows) {
        const relationId = normalizeIdentity(
            String(row[relationField] || "").trim(),
        );
        if (!relationId) {
            continue;
        }
        counter.set(relationId, (counter.get(relationId) || 0) + 1);
    }
    return counter;
}

async function fetchInteractionCountMap(
    collection: InteractionCollection,
    relationField: InteractionRelationField,
    relationIds: string[],
    options?: {
        requirePublic?: boolean;
        windowStartIso?: string;
    },
): Promise<Map<string, number>> {
    if (relationIds.length === 0) {
        return new Map();
    }

    const andFilters: JsonObject[] = [
        { [relationField]: { _in: relationIds } } as JsonObject,
        { status: { _eq: "published" } },
    ];
    if (options?.requirePublic) {
        andFilters.push({ is_public: { _eq: true } });
    }
    if (options?.windowStartIso) {
        andFilters.push({ date_created: { _gte: options.windowStartIso } });
    }

    const rows = await readMany(collection, {
        filter: { _and: andFilters } as JsonObject,
        fields: [relationField],
        limit: -1,
    });

    return buildCountMapByRelation(
        rows as Array<Record<string, unknown>>,
        relationField,
    );
}

function toFallbackAuthor(userId: string): {
    id: string;
    name: string;
    display_name: string;
    username: string;
} {
    const normalized = normalizeIdentity(userId);
    const shortId = (normalized || "user").slice(0, 8);
    const username = `user-${shortId}`;
    return {
        id: normalized,
        name: username,
        display_name: username,
        username,
    };
}

function readAuthorFromMap(
    authorMap: Map<
        string,
        {
            id: string;
            name: string;
            display_name?: string;
            username?: string;
            avatar_url?: string;
        }
    >,
    userId: string,
): {
    id: string;
    name: string;
    display_name?: string;
    username?: string;
    avatar_url?: string;
} {
    const normalizedUserId = normalizeIdentity(userId);
    return (
        authorMap.get(normalizedUserId) || toFallbackAuthor(normalizedUserId)
    );
}

function stripTextLength(value: string | null | undefined): number {
    return String(value || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim().length;
}

function buildDiaryImageMap(
    images: AppDiaryImage[],
): Map<string, AppDiaryImage[]> {
    const map = new Map<string, AppDiaryImage[]>();
    for (const image of images) {
        const diaryId = normalizeIdentity(image.diary_id);
        if (!diaryId) {
            continue;
        }
        const list = map.get(diaryId) || [];
        list.push(image);
        map.set(diaryId, list);
    }
    return map;
}

function scoreTagPreference(
    tags: string[],
    tagWeights: Map<string, number>,
): number {
    if (tags.length === 0 || tagWeights.size === 0) {
        return 0;
    }
    const uniqueTags = Array.from(
        new Set(tags.map((tag) => normalizePreferenceKey(tag)).filter(Boolean)),
    );
    if (uniqueTags.length === 0) {
        return 0;
    }
    let sum = 0;
    for (const tag of uniqueTags) {
        sum += tagWeights.get(tag) || 0;
    }
    return clamp01(sum / uniqueTags.length);
}

function scoreArticlePersonalization(
    authorId: string,
    tags: string[],
    category: string | undefined,
    profile: HomeFeedPreferenceProfile,
): number {
    if (
        profile.authorWeights.size === 0 &&
        profile.tagWeights.size === 0 &&
        profile.categoryWeights.size === 0
    ) {
        return 0;
    }
    const authorScore =
        profile.authorWeights.get(normalizeIdentity(authorId)) || 0;
    const tagScore = scoreTagPreference(tags, profile.tagWeights);
    const categoryScore =
        profile.categoryWeights.get(normalizePreferenceKey(category)) || 0;

    return clamp01(authorScore * 0.5 + tagScore * 0.3 + categoryScore * 0.2);
}

function scoreDiaryPersonalization(
    authorId: string,
    profile: HomeFeedPreferenceProfile,
): number {
    if (profile.authorWeights.size === 0) {
        return 0;
    }
    return clamp01(profile.authorWeights.get(normalizeIdentity(authorId)) || 0);
}

async function loadPreferenceProfile(
    viewerId: string,
    now: Date,
    lookbackDays: number,
): Promise<HomeFeedPreferenceProfile> {
    const normalizedViewerId = normalizeIdentity(viewerId);
    if (!normalizedViewerId) {
        return createEmptyPreferenceProfile();
    }

    const lookbackStartIso = new Date(
        now.getTime() - lookbackDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    const [articleLikes, diaryLikes] = await Promise.all([
        readMany("app_article_likes", {
            filter: {
                _and: [
                    { user_id: { _eq: normalizedViewerId } },
                    { status: { _eq: "published" } },
                    { date_created: { _gte: lookbackStartIso } },
                ],
            } as JsonObject,
            fields: ["article_id"],
            limit: -1,
        }),
        readMany("app_diary_likes", {
            filter: {
                _and: [
                    { user_id: { _eq: normalizedViewerId } },
                    { status: { _eq: "published" } },
                    { date_created: { _gte: lookbackStartIso } },
                ],
            } as JsonObject,
            fields: ["diary_id"],
            limit: -1,
        }),
    ]);

    const articleIds = Array.from(
        new Set(
            (articleLikes as Array<Record<string, unknown>>)
                .map((like) => normalizeIdentity(String(like.article_id || "")))
                .filter(Boolean),
        ),
    );
    const diaryIds = Array.from(
        new Set(
            (diaryLikes as Array<Record<string, unknown>>)
                .map((like) => normalizeIdentity(String(like.diary_id || "")))
                .filter(Boolean),
        ),
    );

    const [likedArticles, likedDiaries] = await Promise.all([
        articleIds.length > 0
            ? readMany("app_articles", {
                  filter: { id: { _in: articleIds } } as JsonObject,
                  fields: ["id", "author_id", "tags", "category"],
                  limit: Math.max(articleIds.length, 20),
              })
            : Promise.resolve([] as AppArticle[]),
        diaryIds.length > 0
            ? readMany("app_diaries", {
                  filter: { id: { _in: diaryIds } } as JsonObject,
                  fields: ["id", "author_id"],
                  limit: Math.max(diaryIds.length, 20),
              })
            : Promise.resolve([] as AppDiary[]),
    ]);

    const authorCounts = new Map<string, number>();
    const tagCounts = new Map<string, number>();
    const categoryCounts = new Map<string, number>();

    for (const article of likedArticles) {
        incrementMapCounter(authorCounts, article.author_id);
        for (const tag of safeCsv(article.tags)) {
            incrementMapCounter(tagCounts, normalizePreferenceKey(tag));
        }
        const category = normalizePreferenceKey(article.category);
        if (category) {
            incrementMapCounter(categoryCounts, category);
        }
    }

    for (const diary of likedDiaries) {
        incrementMapCounter(authorCounts, diary.author_id);
    }

    return {
        authorWeights: normalizeWeightMap(authorCounts),
        tagWeights: normalizeWeightMap(tagCounts),
        categoryWeights: normalizeWeightMap(categoryCounts),
    };
}

export function calculateRecencyScore(hoursSincePublish: number): number {
    const safeHours =
        Number.isFinite(hoursSincePublish) && hoursSincePublish > 0
            ? hoursSincePublish
            : 0;
    return clamp01(Math.exp(-safeHours / RECENCY_DECAY_HOURS));
}

export function calculateEngagementRaw(
    likes72h: number,
    comments72h: number,
): number {
    const likes = Math.max(0, likes72h);
    const comments = Math.max(0, comments72h);
    return Math.log1p(likes) * 0.45 + Math.log1p(comments) * 0.55;
}

export function normalizeMinMax(values: number[]): number[] {
    if (values.length === 0) {
        return [];
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
        return values.map(() => 0);
    }
    return values.map((value) => clamp01((value - min) / (max - min)));
}

export function calculateArticleQualityScore(entry: {
    body: string;
    data: {
        title: string;
        description?: string;
        image?: string;
    };
}): number {
    const titleLength = stripTextLength(entry.data.title);
    const summaryLength = stripTextLength(entry.data.description);
    const bodyLength = stripTextLength(entry.body);
    const hasCover = Boolean(normalizeIdentity(entry.data.image));

    const titleScore = clamp01(titleLength / 18);
    const summaryScore = summaryLength > 0 ? 1 : 0;
    const bodyScore = clamp01(bodyLength / 1600);
    const coverScore = hasCover ? 1 : 0;

    return clamp01(
        titleScore * 0.3 +
            summaryScore * 0.2 +
            bodyScore * 0.3 +
            coverScore * 0.2,
    );
}

export function calculateDiaryQualityScore(entry: {
    content: string;
    images: Array<unknown>;
}): number {
    const contentLength = stripTextLength(entry.content);
    const imageCount = Array.isArray(entry.images) ? entry.images.length : 0;
    const contentScore = clamp01(contentLength / 400);
    const imageScore = clamp01(imageCount / 4);
    return clamp01(contentScore * 0.75 + imageScore * 0.25);
}

export function calculateFinalScore(input: HomeFeedScoreInput): number {
    if (input.isLoggedIn) {
        return (
            input.recency * 0.56 +
            input.engagement * 0.19 +
            input.quality * 0.1 +
            input.personalization * 0.15
        );
    }
    return input.recency * 0.68 + input.engagement * 0.22 + input.quality * 0.1;
}

export function scoreHomeFeedCandidates(
    candidates: HomeFeedCandidate[],
    options: { now: Date; isLoggedIn: boolean },
): HomeFeedScoredCandidate[] {
    if (candidates.length === 0) {
        return [];
    }

    // 先对互动分做批内归一化，再按登录态权重计算最终分。
    const engagementRawScores = candidates.map((candidate) =>
        calculateEngagementRaw(candidate.likes72h, candidate.comments72h),
    );
    const normalizedEngagement = normalizeMinMax(engagementRawScores);

    const scored = candidates.map((candidate, index) => {
        const hoursSincePublish = Math.max(
            0,
            (options.now.getTime() - candidate.publishedAt.getTime()) /
                (60 * 60 * 1000),
        );
        const recency = calculateRecencyScore(hoursSincePublish);
        const engagement = normalizedEngagement[index] || 0;
        const quality = clamp01(candidate.qualityScore);
        const personalization = options.isLoggedIn
            ? clamp01(candidate.personalizationScore)
            : 0;
        const score = calculateFinalScore({
            recency,
            engagement,
            quality,
            personalization,
            isLoggedIn: options.isLoggedIn,
        });

        return {
            ...candidate,
            score,
            signals: {
                recency,
                engagement,
                quality,
                personalization,
                engagementRaw: engagementRawScores[index] || 0,
                likes72h: candidate.likes72h,
                comments72h: candidate.comments72h,
            },
        } satisfies HomeFeedScoredCandidate;
    });

    return scored.sort((left, right) => {
        if (right.score !== left.score) {
            return right.score - left.score;
        }
        return right.publishedAt.getTime() - left.publishedAt.getTime();
    });
}

function violatesAuthorCooldown(
    candidate: HomeFeedScoredCandidate,
    recentAuthors: string[],
): boolean {
    if (AUTHOR_COOLDOWN_WINDOW <= 0 || recentAuthors.length === 0) {
        return false;
    }
    return recentAuthors
        .slice(-AUTHOR_COOLDOWN_WINDOW)
        .includes(candidate.authorId);
}

function violatesTypeStreak(
    candidate: HomeFeedScoredCandidate,
    recentTypes: HomeFeedItemType[],
): boolean {
    if (MAX_TYPE_STREAK <= 0 || recentTypes.length < MAX_TYPE_STREAK) {
        return false;
    }
    for (let index = 1; index <= MAX_TYPE_STREAK; index += 1) {
        if (recentTypes[recentTypes.length - index] !== candidate.type) {
            return false;
        }
    }
    return true;
}

function takeCandidateFromQueue(
    queue: HomeFeedScoredCandidate[],
    recentAuthors: string[],
    recentTypes: HomeFeedItemType[],
    constraint: PickConstraint,
): HomeFeedScoredCandidate | null {
    for (let index = 0; index < queue.length; index += 1) {
        const candidate = queue[index];
        if (
            constraint.enforceAuthorCooldown &&
            violatesAuthorCooldown(candidate, recentAuthors)
        ) {
            continue;
        }
        if (
            constraint.enforceTypeStreak &&
            violatesTypeStreak(candidate, recentTypes)
        ) {
            continue;
        }
        queue.splice(index, 1);
        return candidate;
    }
    return null;
}

function pickCandidateByType(
    articleQueue: HomeFeedScoredCandidate[],
    diaryQueue: HomeFeedScoredCandidate[],
    expectedType: HomeFeedItemType,
    recentAuthors: string[],
    recentTypes: HomeFeedItemType[],
): HomeFeedScoredCandidate | null {
    const primaryQueue = expectedType === "article" ? articleQueue : diaryQueue;
    const secondaryQueue =
        expectedType === "article" ? diaryQueue : articleQueue;

    for (const constraint of PICK_CONSTRAINTS) {
        const preferred = takeCandidateFromQueue(
            primaryQueue,
            recentAuthors,
            recentTypes,
            constraint,
        );
        if (preferred) {
            return preferred;
        }
        const fallback = takeCandidateFromQueue(
            secondaryQueue,
            recentAuthors,
            recentTypes,
            constraint,
        );
        if (fallback) {
            return fallback;
        }
    }

    return null;
}

export function mixHomeFeedCandidates(
    candidates: HomeFeedScoredCandidate[],
    limit: number,
): HomeFeedItem[] {
    if (candidates.length === 0 || limit <= 0) {
        return [];
    }

    const sorted = [...candidates].sort((left, right) => {
        if (right.score !== left.score) {
            return right.score - left.score;
        }
        return right.publishedAt.getTime() - left.publishedAt.getTime();
    });
    const articleQueue = sorted.filter(
        (candidate) => candidate.type === "article",
    );
    const diaryQueue = sorted.filter((candidate) => candidate.type === "diary");

    const output: HomeFeedItem[] = [];
    const recentAuthors: string[] = [];
    const recentTypes: HomeFeedItemType[] = [];

    let patternIndex = 0;
    while (
        output.length < limit &&
        (articleQueue.length > 0 || diaryQueue.length > 0)
    ) {
        // 按 6:4 节奏模板取候选，冲突时自动回退到另一类型并逐步放宽约束。
        const expectedType = MIX_PATTERN[patternIndex % MIX_PATTERN.length];
        patternIndex += 1;

        const selected = pickCandidateByType(
            articleQueue,
            diaryQueue,
            expectedType,
            recentAuthors,
            recentTypes,
        );
        if (!selected) {
            break;
        }

        output.push(selected);
        recentAuthors.push(selected.authorId);
        recentTypes.push(selected.type);

        if (recentAuthors.length > AUTHOR_COOLDOWN_WINDOW) {
            recentAuthors.shift();
        }
        if (recentTypes.length > MAX_TYPE_STREAK) {
            recentTypes.shift();
        }
    }

    return output;
}

function hydrateHomeFeedResult(
    result: HomeFeedBuildResult,
): HomeFeedBuildResult {
    return {
        ...result,
        items: result.items.map((item) => {
            if (item.type === "article") {
                return {
                    ...item,
                    publishedAt: toSafeDate(item.publishedAt),
                    entry: {
                        ...item.entry,
                        data: {
                            ...item.entry.data,
                            published: toSafeDate(item.entry.data.published),
                            updated: toSafeDate(item.entry.data.updated),
                        },
                    },
                };
            }

            return {
                ...item,
                publishedAt: toSafeDate(item.publishedAt),
            };
        }),
    };
}

export async function buildHomeFeed(
    options: HomeFeedBuildOptions = {},
): Promise<HomeFeedBuildResult> {
    const viewerId = normalizeIdentity(options.viewerId || "") || null;
    const outputLimit = normalizePositiveInt(
        options.outputLimit,
        DEFAULT_OUTPUT_LIMIT,
        DEFAULT_OUTPUT_LIMIT,
    );
    const limit = normalizePositiveInt(options.limit, outputLimit, outputLimit);
    const articleCandidateLimit = normalizePositiveInt(
        options.articleCandidateLimit,
        DEFAULT_ARTICLE_CANDIDATE_LIMIT,
        DEFAULT_ARTICLE_CANDIDATE_LIMIT,
    );
    const diaryCandidateLimit = normalizePositiveInt(
        options.diaryCandidateLimit,
        DEFAULT_DIARY_CANDIDATE_LIMIT,
        DEFAULT_DIARY_CANDIDATE_LIMIT,
    );
    const engagementWindowHours = normalizePositiveInt(
        options.engagementWindowHours,
        DEFAULT_ENGAGEMENT_WINDOW_HOURS,
        24 * 14,
    );
    const personalizationLookbackDays = normalizePositiveInt(
        options.personalizationLookbackDays,
        DEFAULT_PERSONALIZATION_LOOKBACK_DAYS,
        365,
    );
    const algoVersion =
        normalizeIdentity(options.algoVersion) || HOME_FEED_ALGO_VERSION;
    const now = options.now ? toSafeDate(options.now) : new Date();

    const cacheKey = hashParams({
        viewerId: viewerId || "guest",
        limit,
        algoVersion,
        windowHours: engagementWindowHours,
    });
    const cached = await cacheManager.get<HomeFeedBuildResult>(
        "home-feed",
        cacheKey,
    );
    if (cached) {
        return hydrateHomeFeedResult(cached);
    }

    const [allArticles, diaryRows, preferenceProfile] = await Promise.all([
        getSortedPosts(),
        readMany("app_diaries", {
            filter: {
                _and: [
                    { status: { _eq: "published" } },
                    { praviate: { _eq: true } },
                ],
            } as JsonObject,
            fields: [...DIARY_FIELDS],
            sort: ["-date_created"],
            limit: diaryCandidateLimit,
        }),
        viewerId
            ? loadPreferenceProfile(viewerId, now, personalizationLookbackDays)
            : Promise.resolve(createEmptyPreferenceProfile()),
    ]);

    // 关键链路：继续使用完整文章列表初始化 permalink 序号映射，避免序号链接漂移。
    initPostIdMap(allArticles);

    const articleEntries = allArticles.slice(0, articleCandidateLimit);
    const articleIds = Array.from(
        new Set(
            articleEntries
                .map((entry) =>
                    normalizeIdentity(entry.data.article_id || entry.id),
                )
                .filter(Boolean),
        ),
    );
    const diaryIds = Array.from(
        new Set(
            diaryRows.map((row) => normalizeIdentity(row.id)).filter(Boolean),
        ),
    );
    const diaryAuthorIds = Array.from(
        new Set(
            diaryRows
                .map((row) => normalizeIdentity(row.author_id))
                .filter(Boolean),
        ),
    );

    const windowStartIso = new Date(
        now.getTime() - engagementWindowHours * 60 * 60 * 1000,
    ).toISOString();

    const [
        articleLike72hMap,
        articleComment72hMap,
        diaryImages,
        diaryAuthorMap,
        diaryLikeCountMap,
        diaryCommentCountMap,
        diaryLike72hMap,
        diaryComment72hMap,
    ] = await Promise.all([
        fetchInteractionCountMap(
            "app_article_likes",
            "article_id",
            articleIds,
            { windowStartIso },
        ),
        fetchInteractionCountMap(
            "app_article_comments",
            "article_id",
            articleIds,
            {
                requirePublic: true,
                windowStartIso,
            },
        ),
        diaryIds.length > 0
            ? readMany("app_diary_images", {
                  filter: {
                      _and: [
                          { diary_id: { _in: diaryIds } },
                          { status: { _eq: "published" } },
                          { is_public: { _eq: true } },
                      ],
                  } as JsonObject,
                  sort: ["sort", "-date_created"],
                  limit: -1,
              })
            : Promise.resolve([] as AppDiaryImage[]),
        getAuthorBundle(diaryAuthorIds),
        fetchInteractionCountMap("app_diary_likes", "diary_id", diaryIds),
        fetchInteractionCountMap("app_diary_comments", "diary_id", diaryIds, {
            requirePublic: true,
        }),
        fetchInteractionCountMap("app_diary_likes", "diary_id", diaryIds, {
            windowStartIso,
        }),
        fetchInteractionCountMap("app_diary_comments", "diary_id", diaryIds, {
            requirePublic: true,
            windowStartIso,
        }),
    ]);

    const diaryImageMap = buildDiaryImageMap(diaryImages);
    const diaryEntries: HomeFeedDiaryEntry[] = diaryRows.map((row) => ({
        ...row,
        author: readAuthorFromMap(diaryAuthorMap, row.author_id),
        images: diaryImageMap.get(row.id) || [],
        comment_count: diaryCommentCountMap.get(row.id) || 0,
        like_count: diaryLikeCountMap.get(row.id) || 0,
    }));

    const articleCandidates: HomeFeedArticleCandidate[] = articleEntries
        .map((entry) => {
            const articleId = normalizeIdentity(
                entry.data.article_id || entry.id,
            );
            const authorId = normalizeIdentity(entry.data.author_id);
            if (!articleId || !authorId) {
                return null;
            }
            const tags = safeCsv(entry.data.tags);
            return {
                type: "article",
                id: articleId,
                authorId,
                publishedAt: toSafeDate(entry.data.published),
                entry,
                likes72h: articleLike72hMap.get(articleId) || 0,
                comments72h: articleComment72hMap.get(articleId) || 0,
                qualityScore: calculateArticleQualityScore(entry),
                personalizationScore: scoreArticlePersonalization(
                    authorId,
                    tags,
                    entry.data.category,
                    preferenceProfile,
                ),
            };
        })
        .filter(
            (candidate): candidate is HomeFeedArticleCandidate =>
                candidate !== null,
        );

    const diaryCandidates: HomeFeedDiaryCandidate[] = diaryEntries
        .map((entry) => {
            const diaryId = normalizeIdentity(entry.id);
            const authorId = normalizeIdentity(entry.author_id);
            if (!diaryId || !authorId) {
                return null;
            }
            return {
                type: "diary",
                id: diaryId,
                authorId,
                publishedAt: toSafeDate(
                    entry.date_created || entry.date_updated,
                ),
                entry,
                likes72h: diaryLike72hMap.get(diaryId) || 0,
                comments72h: diaryComment72hMap.get(diaryId) || 0,
                qualityScore: calculateDiaryQualityScore(entry),
                personalizationScore: scoreDiaryPersonalization(
                    authorId,
                    preferenceProfile,
                ),
            };
        })
        .filter(
            (candidate): candidate is HomeFeedDiaryCandidate =>
                candidate !== null,
        );

    const scoredCandidates = scoreHomeFeedCandidates(
        [...articleCandidates, ...diaryCandidates],
        {
            now,
            isLoggedIn: Boolean(viewerId),
        },
    );
    // 评分后再混排，保证每种类型都优先按自身得分顺序出队。
    const items = mixHomeFeedCandidates(scoredCandidates, limit);

    const result: HomeFeedBuildResult = {
        items,
        generatedAt: now.toISOString(),
        meta: {
            viewerId,
            limit,
            outputLimit,
            articleCandidateLimit,
            diaryCandidateLimit,
            articleCandidateCount: articleCandidates.length,
            diaryCandidateCount: diaryCandidates.length,
            engagementWindowHours,
            personalizationLookbackDays,
            algoVersion,
        },
    };

    void cacheManager.set("home-feed", cacheKey, result);

    return result;
}
