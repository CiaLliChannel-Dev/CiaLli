import type {
    AppArticle,
    AppArticleComment,
    AppArticleLike,
    AppProfile,
} from "@/types/app";
import type { JsonObject } from "@/types/json";
import { readMany } from "@/server/directus/client";
import { buildPublicAssetUrl } from "@/server/directus-auth";
import { excludeSpecialArticleSlugFilter } from "@/server/api/v1/shared";
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import { getCategoryUrl } from "@utils/url-utils";

type PostAuthor = {
    id: string;
    name: string;
    display_name?: string;
    username?: string;
    avatar_url?: string;
};

export type DirectusPostEntry = {
    id: string;
    slug: string | null;
    body: string;
    url: string;
    data: {
        article_id: string;
        author_id: string;
        author: PostAuthor;
        title: string;
        description?: string;
        image?: string;
        tags: string[];
        category?: string;
        comment_count: number;
        like_count: number;
        published: Date;
        updated: Date;
        nextSlug?: string;
        nextTitle?: string;
        prevSlug?: string;
        prevTitle?: string;
        alias?: string;
        permalink?: string;
        encrypted?: boolean;
    };
};

function normalizeTags(tags: AppArticle["tags"]): string[] {
    if (!tags || !Array.isArray(tags)) return [];
    return tags.map((s) => String(s).trim()).filter(Boolean);
}

function isProtectedContentBody(value: string | null | undefined): boolean {
    return String(value || "")
        .trim()
        .startsWith("CL2:");
}

function resolvePublishedAt(post: AppArticle): Date {
    const raw = post.published_at || post.date_created || post.date_updated;
    const parsed = raw ? new Date(raw) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function resolveUpdatedAt(post: AppArticle): Date {
    const raw = post.date_updated || post.date_created || post.published_at;
    const parsed = raw ? new Date(raw) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function buildPostUrl(shortId: string | null, articleId: string): string {
    return `/posts/${shortId || articleId}`;
}

function resolveCoverImage(post: AppArticle): string | undefined {
    const coverUrl = post.cover_url ? String(post.cover_url).trim() : "";
    if (coverUrl) {
        return coverUrl;
    }

    const coverFile = post.cover_file ? String(post.cover_file).trim() : "";
    if (!coverFile) {
        return undefined;
    }

    return buildPublicAssetUrl(coverFile, {
        width: 1200,
        height: 675,
        fit: "cover",
    });
}

async function fetchProfilesByUserIds(
    userIds: string[],
): Promise<Map<string, AppProfile>> {
    if (userIds.length === 0) {
        return new Map();
    }
    const profiles = await readMany("app_user_profiles", {
        filter: {
            user_id: { _in: userIds },
        } as JsonObject,
        limit: Math.max(userIds.length, 20),
    });
    const profileMap = new Map<string, AppProfile>();
    for (const profile of profiles) {
        if (profile.user_id) {
            profileMap.set(profile.user_id, profile);
        }
    }
    return profileMap;
}

type AuthorUser = {
    id: string;
    email?: string;
    name?: string;
    avatar?: string | null;
};

async function fetchUsersByIds(
    userIds: string[],
): Promise<Map<string, AuthorUser>> {
    if (userIds.length === 0) {
        return new Map();
    }
    const users = await readMany("directus_users", {
        filter: {
            id: { _in: userIds },
        } as JsonObject,
        limit: Math.max(userIds.length, 20),
        fields: ["id", "email", "first_name", "last_name", "avatar"],
    });

    const userMap = new Map<string, AuthorUser>();
    for (const user of users) {
        const fullName = [user.first_name, user.last_name]
            .map((entry) => (entry || "").trim())
            .filter(Boolean)
            .join(" ")
            .trim();
        userMap.set(user.id, {
            id: user.id,
            email: user.email || undefined,
            name: fullName || undefined,
            avatar: user.avatar,
        });
    }
    return userMap;
}

function buildAuthor(
    userId: string,
    profileMap: Map<string, AppProfile>,
    userMap: Map<string, AuthorUser>,
): PostAuthor {
    const profile = profileMap.get(userId);
    const user = userMap.get(userId);

    const rawUsername = String(profile?.username || "").trim();
    const usernameWithoutDomain = rawUsername.includes("@")
        ? (rawUsername.split("@")[0] || "").trim()
        : rawUsername;
    const username =
        usernameWithoutDomain || `user-${String(userId || "").slice(0, 8)}`;
    const displayName =
        String(profile?.display_name || "").trim() ||
        user?.name?.trim() ||
        username;
    const name = displayName || username || "Member";

    let avatarUrl: string | undefined;
    if (profile?.avatar_url?.trim()) {
        avatarUrl = profile.avatar_url;
    } else if (profile?.avatar_file) {
        avatarUrl = buildPublicAssetUrl(profile.avatar_file, {
            width: 96,
            height: 96,
            fit: "cover",
        });
    } else if (user?.avatar) {
        avatarUrl = buildPublicAssetUrl(user.avatar, {
            width: 96,
            height: 96,
            fit: "cover",
        });
    }

    return {
        id: userId,
        name,
        display_name: displayName || username || "Member",
        username,
        avatar_url: avatarUrl,
    };
}

function buildArticleCountMap<T extends { article_id: string }>(
    rows: T[],
): Map<string, number> {
    const map = new Map<string, number>();
    for (const row of rows) {
        const articleId = String(row.article_id || "").trim();
        if (!articleId) {
            continue;
        }
        map.set(articleId, (map.get(articleId) || 0) + 1);
    }
    return map;
}

async function fetchArticleCommentCountMap(
    articleIds: string[],
): Promise<Map<string, number>> {
    if (articleIds.length === 0) {
        return new Map();
    }
    try {
        const comments = await readMany("app_article_comments", {
            filter: {
                _and: [
                    { article_id: { _in: articleIds } },
                    { status: { _eq: "published" } },
                    { is_public: { _eq: true } },
                ],
            } as JsonObject,
            limit: Math.max(articleIds.length * 20, 200),
            fields: ["article_id"],
        });
        return buildArticleCountMap(comments as AppArticleComment[]);
    } catch (error) {
        console.warn(
            "[content-utils] failed to load article comment counts:",
            error,
        );
        return new Map();
    }
}

async function fetchArticleLikeCountMap(
    articleIds: string[],
): Promise<Map<string, number>> {
    if (articleIds.length === 0) {
        return new Map();
    }
    try {
        const likes = await readMany("app_article_likes", {
            filter: {
                _and: [
                    { article_id: { _in: articleIds } },
                    { status: { _eq: "published" } },
                ],
            } as JsonObject,
            limit: Math.max(articleIds.length * 20, 200),
            fields: ["article_id"],
        });
        return buildArticleCountMap(likes as AppArticleLike[]);
    } catch (error) {
        console.warn(
            "[content-utils] failed to load article like counts:",
            error,
        );
        return new Map();
    }
}

async function loadDirectusPosts(): Promise<DirectusPostEntry[]> {
    const andFilters: JsonObject[] = [
        { is_public: { _eq: true } },
        excludeSpecialArticleSlugFilter(),
    ];
    if (import.meta.env.PROD) {
        andFilters.push({ status: { _eq: "published" } });
    }

    try {
        const rows = await readMany("app_articles", {
            filter: { _and: andFilters } as JsonObject,
            sort: ["-published_at", "-date_created"],
            limit: 1000,
        });

        const articleIds = rows
            .map((row) => String(row.id || "").trim())
            .filter(Boolean);
        const authorIds = Array.from(
            new Set(
                rows
                    .map((row) => String(row.author_id || "").trim())
                    .filter(Boolean),
            ),
        );
        const [profileMap, userMap, commentCountMap, likeCountMap] =
            await Promise.all([
                fetchProfilesByUserIds(authorIds),
                fetchUsersByIds(authorIds),
                fetchArticleCommentCountMap(articleIds),
                fetchArticleLikeCountMap(articleIds),
            ]);

        const mapped = rows.map((post) => {
            const normalizedSlug = String(post.slug || "").trim();
            const slug = normalizedSlug || null;
            const title = String(post.title || "").trim();
            const category = post.category ? String(post.category).trim() : "";
            const articleId = String(post.id || "").trim();
            const authorId = String(post.author_id || "").trim();
            const shortId = String(post.short_id || "").trim() || null;
            const routeId = shortId || articleId || normalizedSlug;
            return {
                id: routeId,
                slug,
                body: String(post.body_markdown || ""),
                url: buildPostUrl(shortId, articleId),
                data: {
                    article_id: articleId,
                    author_id: authorId,
                    author: buildAuthor(authorId, profileMap, userMap),
                    title: title || normalizedSlug || articleId || "Untitled",
                    description: post.summary || undefined,
                    image: resolveCoverImage(post),
                    tags: normalizeTags(post.tags),
                    category: category || undefined,
                    comment_count: commentCountMap.get(articleId) || 0,
                    like_count: likeCountMap.get(articleId) || 0,
                    published: resolvePublishedAt(post),
                    updated: resolveUpdatedAt(post),
                    encrypted: isProtectedContentBody(post.body_markdown),
                },
            } satisfies DirectusPostEntry;
        });

        return mapped.sort(
            (a, b) => b.data.published.getTime() - a.data.published.getTime(),
        );
    } catch (error) {
        console.warn(
            "[content-utils] failed to load posts from Directus:",
            error,
        );
        return [];
    }
}

async function getRawSortedPosts(): Promise<DirectusPostEntry[]> {
    return await loadDirectusPosts();
}

export async function getSortedPosts(): Promise<DirectusPostEntry[]> {
    const sorted = await getRawSortedPosts();

    for (let i = 1; i < sorted.length; i += 1) {
        sorted[i].data.nextSlug = sorted[i - 1].id;
        sorted[i].data.nextTitle = sorted[i - 1].data.title;
    }
    for (let i = 0; i < sorted.length - 1; i += 1) {
        sorted[i].data.prevSlug = sorted[i + 1].id;
        sorted[i].data.prevTitle = sorted[i + 1].data.title;
    }

    return sorted;
}

export type PostForList = {
    id: string;
    data: DirectusPostEntry["data"];
    url?: string;
};

export async function getSortedPostsList(): Promise<PostForList[]> {
    const sortedFullPosts = await getRawSortedPosts();
    return sortedFullPosts.map((post) => ({
        id: post.id,
        data: post.data,
        url: post.url,
    }));
}

export type Tag = {
    name: string;
    count: number;
};

export async function getTagList(): Promise<Tag[]> {
    const allBlogPosts = await getRawSortedPosts();
    const countMap: Record<string, number> = {};

    for (const post of allBlogPosts) {
        for (const tag of post.data.tags ?? []) {
            if (!countMap[tag]) {
                countMap[tag] = 0;
            }
            countMap[tag] += 1;
        }
    }

    const keys = Object.keys(countMap).sort((a, b) =>
        a.toLowerCase().localeCompare(b.toLowerCase()),
    );

    return keys.map((key) => ({ name: key, count: countMap[key] }));
}

export type Category = {
    name: string;
    count: number;
    url: string;
};

export async function getCategoryList(): Promise<Category[]> {
    const allBlogPosts = await getRawSortedPosts();
    const count: Record<string, number> = {};

    for (const post of allBlogPosts) {
        if (!post.data.category) {
            const uncategorizedKey = i18n(I18nKey.uncategorized);
            count[uncategorizedKey] = (count[uncategorizedKey] || 0) + 1;
            continue;
        }
        const categoryName = String(post.data.category).trim();
        count[categoryName] = (count[categoryName] || 0) + 1;
    }

    const categories = Object.keys(count).sort((a, b) =>
        a.toLowerCase().localeCompare(b.toLowerCase()),
    );

    return categories.map((category) => ({
        name: category,
        count: count[category],
        url: getCategoryUrl(category),
    }));
}
