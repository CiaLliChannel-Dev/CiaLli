export const DETAIL_PAGE_PUBLIC_CACHE_CONTROL =
    "public, s-maxage=60, stale-while-revalidate=300";
export const DETAIL_PAGE_PRIVATE_CACHE_CONTROL = "private, no-store";

type SessionUser = {
    id: string;
};

export type DetailPageMode = "public" | "owner";

export type DetailPageAccessResolution<T extends { author_id: string }> =
    | {
          mode: DetailPageMode;
          detail: T;
          sessionUserId: string | null;
      }
    | {
          mode: "not_found";
          sessionUserId: string | null;
      };

type ResolveDetailPageAccessInput<T extends { author_id: string }> = {
    routeId: string;
    loadPublicDetail: (routeId: string) => Promise<T | null>;
    loadSessionUser: () => Promise<SessionUser | null>;
    getSessionAccessToken: () => string;
    loadOwnerDetail: (
        routeId: string,
        accessToken: string,
        sessionUserId: string,
    ) => Promise<T | null>;
};

export async function resolveDetailPageAccess<T extends { author_id: string }>(
    input: ResolveDetailPageAccessInput<T>,
): Promise<DetailPageAccessResolution<T>> {
    const publicDetail = await input.loadPublicDetail(input.routeId);
    if (publicDetail) {
        return {
            mode: "public",
            detail: publicDetail,
            sessionUserId: null,
        };
    }

    // 仅在公开快照未命中时才读取会话，避免公共详情因为 cookie 降级为私有缓存。
    const sessionUser = await input.loadSessionUser();
    if (!sessionUser) {
        return {
            mode: "not_found",
            sessionUserId: null,
        };
    }

    const accessToken = input.getSessionAccessToken();
    if (!accessToken) {
        return {
            mode: "not_found",
            sessionUserId: sessionUser.id,
        };
    }

    const ownerDetail = await input.loadOwnerDetail(
        input.routeId,
        accessToken,
        sessionUser.id,
    );
    if (!ownerDetail || ownerDetail.author_id !== sessionUser.id) {
        return {
            mode: "not_found",
            sessionUserId: sessionUser.id,
        };
    }

    return {
        mode: "owner",
        detail: ownerDetail,
        sessionUserId: sessionUser.id,
    };
}

export function resolveDetailPageCacheControl(input: {
    responseStatus: number;
    mode: DetailPageMode | "not_found" | "error";
}): string | null {
    if (input.responseStatus >= 500) {
        return null;
    }
    if (input.mode === "owner") {
        return DETAIL_PAGE_PRIVATE_CACHE_CONTROL;
    }
    return DETAIL_PAGE_PUBLIC_CACHE_CONTROL;
}
