export const ARTICLE_SAVE_SUCCESS_REDIRECT_URL = "/posts";

type SavedContentRouteItem = {
    id?: unknown;
    short_id?: unknown;
    slug?: unknown;
};

function toRouteSegment(value: unknown): string {
    return String(value ?? "").trim();
}

export function buildDiarySaveSuccessRedirectUrl(username: string): string {
    return `/${encodeURIComponent(username)}/diary`;
}

export function buildArticleDetailSuccessRedirectUrl(
    item: SavedContentRouteItem,
): string {
    const routeId =
        toRouteSegment(item.slug) ||
        toRouteSegment(item.short_id) ||
        toRouteSegment(item.id);
    return routeId ? `/posts/${encodeURIComponent(routeId)}` : "";
}

export function buildDiaryDetailSuccessRedirectUrl(
    username: string,
    item: SavedContentRouteItem,
): string {
    const normalizedUsername = toRouteSegment(username);
    const routeId = toRouteSegment(item.short_id) || toRouteSegment(item.id);
    if (!normalizedUsername || !routeId) {
        return "";
    }
    return `/${encodeURIComponent(normalizedUsername)}/diary/${encodeURIComponent(routeId)}`;
}
