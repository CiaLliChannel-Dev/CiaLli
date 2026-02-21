import {
    getAuthState,
    subscribeAuthState,
    type AuthState,
} from "@/scripts/auth-state";
import {
    showAuthRequiredDialog,
    showConfirmDialog,
    showFormDialog,
    showNoticeDialog,
} from "@/scripts/dialogs";
import I18nKey from "@i18n/i18nKey";
import { t } from "@/scripts/i18n-runtime";
import { getCsrfToken } from "@/utils/csrf";

type CalendarFilterDetail = {
    type: "day" | "month" | "year";
    key: string;
    posts: Array<{
        id: string;
        title: string;
        date: string;
        url: string;
    }>;
};

type RuntimeWindow = Window &
    typeof globalThis & {
        _calendarFilterListenerAttached?: boolean;
        _postCardActionsAttached?: boolean;
        _postInteractionsInitialized?: boolean;
    };

const runtimeWindow = window as RuntimeWindow;

function getFilterDom() {
    return {
        postList: document.getElementById("post-list-container"),
        pagination: document.getElementById("pagination-container"),
    };
}

function isArchivePage(): boolean {
    return Boolean(document.querySelector(".archive-posts"));
}

function applyCalendarFilter(detail: CalendarFilterDetail) {
    // archive 页面有自己的筛选系统，跳过此处理
    if (isArchivePage()) {
        return;
    }

    const { postList, pagination } = getFilterDom();
    if (!postList) {
        return;
    }
    const items = Array.from(
        postList.querySelectorAll<HTMLElement>(".post-list-item"),
    );
    items.forEach((item) => {
        const match =
            detail.type === "year"
                ? item.dataset.year === detail.key
                : detail.type === "month"
                  ? item.dataset.month === detail.key
                  : item.dataset.day === detail.key;
        item.classList.toggle("hidden", !match);
    });
    pagination?.classList.add("hidden");
}

function clearCalendarFilter() {
    // archive 页面有自己的筛选系统，跳过此处理
    if (isArchivePage()) {
        return;
    }

    const { postList, pagination } = getFilterDom();
    if (!postList) {
        return;
    }
    postList
        .querySelectorAll<HTMLElement>(".post-list-item.hidden")
        .forEach((item) => item.classList.remove("hidden"));
    pagination?.classList.remove("hidden");
}

function setupCalendarFilterListeners() {
    if (runtimeWindow._calendarFilterListenerAttached) {
        return;
    }

    window.addEventListener("calendarFilterChange", (event) => {
        const detail = (event as CustomEvent<CalendarFilterDetail>).detail;
        if (!detail || !Array.isArray(detail.posts)) {
            return;
        }
        applyCalendarFilter(detail);
    });

    window.addEventListener("calendarFilterClear", () => {
        clearCalendarFilter();
    });

    runtimeWindow._calendarFilterListenerAttached = true;
}

let currentAuthState: AuthState = {
    userId: "",
    username: "",
    isAdmin: false,
    isLoggedIn: false,
};

function updateCurrentAuthState(state: AuthState) {
    currentAuthState = state;
}

async function applyBlockedUsersFilter() {
    if (!currentAuthState.isLoggedIn) {
        return;
    }
    try {
        const response = await fetch("/api/v1/me/blocks?limit=200", {
            credentials: "include",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.ok || !Array.isArray(data.items)) {
            return;
        }
        for (const item of data.items) {
            const blockedUserId = item?.blocked_user_id
                ? String(item.blocked_user_id)
                : "";
            if (blockedUserId) {
                removeCardsByAuthorId(blockedUserId);
            }
        }
    } catch (error) {
        console.error("[PostPage] failed to apply blocked user filter:", error);
    }
}

function applyCardActionVisibility(
    card: HTMLElement,
    state: AuthState,
    deleteOwnAction: string,
    deleteAdminAction: string,
) {
    const authorId = String(card.dataset.authorId || "");
    const deleteOwnBtn = card.querySelector<HTMLButtonElement>(
        `button[data-action="${deleteOwnAction}"]`,
    );
    const deleteAdminBtn = card.querySelector<HTMLButtonElement>(
        `button[data-action="${deleteAdminAction}"]`,
    );
    const blockBtn = card.querySelector<HTMLButtonElement>(
        'button[data-action="block-user"]',
    );
    const likeBtn = card.querySelector<HTMLButtonElement>(
        'button[data-action="toggle-like"]',
    );

    const isOwner =
        state.isLoggedIn && Boolean(state.userId) && state.userId === authorId;
    const isAdminOnly = state.isLoggedIn && state.isAdmin && !isOwner;

    deleteOwnBtn?.classList.toggle("hidden", !isOwner);
    deleteAdminBtn?.classList.toggle("hidden", !isAdminOnly);

    if (blockBtn) {
        const canBlock =
            state.isLoggedIn && Boolean(authorId) && state.userId !== authorId;
        blockBtn.classList.toggle("hidden", !canBlock);
    }

    if (likeBtn) {
        likeBtn.classList.toggle(
            "opacity-60",
            !state.isLoggedIn || isLikeButtonPending(likeBtn),
        );
    }
}

function updateCardActionVisibility(state: AuthState) {
    const postCards =
        document.querySelectorAll<HTMLElement>("[data-post-card]");
    postCards.forEach((card) => {
        applyCardActionVisibility(
            card,
            state,
            "delete-own-article",
            "delete-admin-article",
        );
    });

    const diaryCards =
        document.querySelectorAll<HTMLElement>("[data-diary-card]");
    diaryCards.forEach((card) => {
        applyCardActionVisibility(
            card,
            state,
            "delete-own-diary",
            "delete-admin-diary",
        );
    });
}

function setLikeButtonState(
    button: HTMLButtonElement,
    liked: boolean,
    likeCount?: number,
) {
    button.dataset.liked = liked ? "true" : "false";
    button.classList.toggle("text-(--primary)", liked);
    button.classList.toggle("text-50", !liked);
    const countEl = button.querySelector<HTMLElement>("[data-like-count]");
    if (countEl && typeof likeCount === "number") {
        const normalizedCount = Math.max(0, likeCount);
        countEl.textContent = String(normalizedCount);
        button.dataset.likeCount = String(normalizedCount);
    } else if (typeof likeCount === "number") {
        button.dataset.likeCount = String(Math.max(0, likeCount));
    }
}

function isLikeButtonPending(button: HTMLButtonElement): boolean {
    return button.dataset.likePending === "1";
}

function setLikeButtonPending(
    button: HTMLButtonElement,
    isPending: boolean,
): void {
    button.dataset.likePending = isPending ? "1" : "0";
    button.disabled = isPending;
    button.classList.toggle("pointer-events-none", isPending);
    button.classList.toggle(
        "opacity-60",
        isPending || !currentAuthState.isLoggedIn,
    );
}

function getLikeButtonCount(button: HTMLButtonElement): number {
    const datasetCount = Number(button.dataset.likeCount || "");
    if (Number.isFinite(datasetCount)) {
        return Math.max(0, datasetCount);
    }
    const countEl = button.querySelector<HTMLElement>("[data-like-count]");
    const textCount = Number(countEl?.textContent || "0");
    if (Number.isFinite(textCount)) {
        return Math.max(0, textCount);
    }
    return 0;
}

const LIKE_SYNC_PAGE_LIMIT = 100;

type LikeRelationField = "article_id" | "diary_id";

type FetchAllLikedIdsOptions = {
    endpoint: string;
    idField: LikeRelationField;
};

function normalizeRelationId(value: unknown): string {
    if (typeof value === "string" || typeof value === "number") {
        return String(value).trim();
    }
    if (value && typeof value === "object" && "id" in value) {
        const relationId = (value as { id?: unknown }).id;
        if (typeof relationId === "string" || typeof relationId === "number") {
            return String(relationId).trim();
        }
    }
    return "";
}

async function fetchAllLikedIds({
    endpoint,
    idField,
}: FetchAllLikedIdsOptions): Promise<Set<string>> {
    const likedIds = new Set<string>();
    let page = 1;
    let total: number | null = null;
    let fetched = 0;
    let hasMore = true;

    while (hasMore) {
        const response = await fetch(
            `${endpoint}?page=${page}&limit=${LIKE_SYNC_PAGE_LIMIT}`,
            {
                credentials: "include",
            },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.ok || !Array.isArray(data.items)) {
            throw new Error(`failed to fetch likes list: ${endpoint}`);
        }
        if (typeof data.total === "number" && Number.isFinite(data.total)) {
            total = Math.max(0, Math.floor(data.total));
        }

        const items = data.items as Array<Record<string, unknown>>;
        fetched += items.length;
        for (const item of items) {
            const id = normalizeRelationId(item[idField]);
            if (id) {
                likedIds.add(id);
            }
        }

        hasMore = !(
            items.length < LIKE_SYNC_PAGE_LIMIT ||
            items.length === 0 ||
            (total !== null && fetched >= total)
        );
        if (hasMore) {
            page += 1;
        }
    }

    return likedIds;
}

async function syncLikeButtons() {
    const likeButtons = document.querySelectorAll<HTMLButtonElement>(
        'button[data-action="toggle-like"]',
    );
    if (!currentAuthState.isLoggedIn) {
        likeButtons.forEach((button) => {
            setLikeButtonPending(button, false);
            setLikeButtonState(button, false);
        });
        return;
    }

    try {
        const hasPostCards =
            document.querySelector("[data-post-card]") !== null;
        const hasDiaryCards =
            document.querySelector("[data-diary-card]") !== null;

        const [likedArticleIds, likedDiaryIds] = await Promise.all([
            hasPostCards
                ? fetchAllLikedIds({
                      endpoint: "/api/v1/me/article-likes",
                      idField: "article_id",
                  })
                : Promise.resolve(new Set<string>()),
            hasDiaryCards
                ? fetchAllLikedIds({
                      endpoint: "/api/v1/me/diary-likes",
                      idField: "diary_id",
                  })
                : Promise.resolve(new Set<string>()),
        ]);

        likeButtons.forEach((button) => {
            if (isLikeButtonPending(button)) {
                return;
            }
            const postCard = button.closest<HTMLElement>("[data-post-card]");
            if (postCard) {
                const articleId = String(
                    postCard.dataset.articleId || "",
                ).trim();
                setLikeButtonState(button, likedArticleIds.has(articleId));
                return;
            }
            const diaryCard = button.closest<HTMLElement>("[data-diary-card]");
            if (diaryCard) {
                const diaryId = String(diaryCard.dataset.diaryId || "").trim();
                setLikeButtonState(button, likedDiaryIds.has(diaryId));
            }
        });
    } catch (error) {
        console.error("[PostPage] failed to sync likes:", error);
    }
}

function removeCardByArticleId(articleId: string) {
    const card = document.querySelector<HTMLElement>(
        `[data-post-card][data-article-id="${CSS.escape(articleId)}"]`,
    );
    if (!card) {
        return;
    }
    const row = card.closest<HTMLElement>(".post-list-item");
    row?.remove();
}

function removeCardByDiaryId(diaryId: string) {
    const card = document.querySelector<HTMLElement>(
        `[data-diary-card][data-diary-id="${CSS.escape(diaryId)}"]`,
    );
    if (!card) {
        return;
    }
    const row = card.closest<HTMLElement>(".diary-list-item") || card;
    row.remove();
}

function removeCardsByAuthorId(authorId: string) {
    const escaped = CSS.escape(authorId);
    const cards = document.querySelectorAll<HTMLElement>(
        `[data-post-card][data-author-id="${escaped}"], [data-diary-card][data-author-id="${escaped}"]`,
    );
    cards.forEach((card) => {
        const row =
            card.closest<HTMLElement>(".post-list-item") ||
            card.closest<HTMLElement>(".diary-list-item") ||
            card;
        row.remove();
    });
}

function getErrorMessage(
    data: Record<string, unknown> | null,
    fallback: string,
): string {
    const error = data?.error as Record<string, unknown> | undefined;
    return (error?.message as string | undefined) || fallback;
}

async function requestDeleteArticle(articleId: string) {
    const response = await fetch(
        `/api/v1/me/articles/${encodeURIComponent(articleId)}`,
        {
            method: "DELETE",
            credentials: "include",
            headers: { "x-csrf-token": getCsrfToken() },
        },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
        throw new Error(getErrorMessage(data, t(I18nKey.postDeleteFailed)));
    }
}

async function requestDeleteDiary(diaryId: string) {
    const response = await fetch(
        `/api/v1/me/diaries/${encodeURIComponent(diaryId)}`,
        {
            method: "DELETE",
            credentials: "include",
            headers: { "x-csrf-token": getCsrfToken() },
        },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
        throw new Error(getErrorMessage(data, t(I18nKey.postDeleteFailed)));
    }
}

async function requestBlockUser(blockedUserId: string, reason?: string) {
    const response = await fetch("/api/v1/me/blocks", {
        method: "POST",
        credentials: "include",
        headers: {
            "content-type": "application/json",
            "x-csrf-token": getCsrfToken(),
        },
        body: JSON.stringify({
            blocked_user_id: blockedUserId,
            reason: reason || undefined,
        }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
        throw new Error(getErrorMessage(data, t(I18nKey.postActionFailed)));
    }
}

async function requestToggleLike(articleId: string): Promise<{
    liked: boolean;
    like_count: number;
}> {
    const response = await fetch("/api/v1/me/article-likes", {
        method: "POST",
        credentials: "include",
        headers: {
            "content-type": "application/json",
            "x-csrf-token": getCsrfToken(),
        },
        body: JSON.stringify({
            article_id: articleId,
        }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
        throw new Error(getErrorMessage(data, t(I18nKey.postActionFailed)));
    }
    return {
        liked: Boolean(data.liked),
        like_count: Number(data.like_count || 0),
    };
}

async function requestToggleDiaryLike(diaryId: string): Promise<{
    liked: boolean;
    like_count: number;
}> {
    const response = await fetch("/api/v1/me/diary-likes", {
        method: "POST",
        credentials: "include",
        headers: {
            "content-type": "application/json",
            "x-csrf-token": getCsrfToken(),
        },
        body: JSON.stringify({
            diary_id: diaryId,
        }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
        throw new Error(getErrorMessage(data, t(I18nKey.postActionFailed)));
    }
    return {
        liked: Boolean(data.liked),
        like_count: Number(data.like_count || 0),
    };
}

function resolveCardContext(actionEl: HTMLElement): {
    cardType: "post" | "diary";
    card: HTMLElement;
    itemId: string;
    authorId: string;
} | null {
    const postCard = actionEl.closest<HTMLElement>("[data-post-card]");
    if (postCard) {
        return {
            cardType: "post",
            card: postCard,
            itemId: String(postCard.dataset.articleId || ""),
            authorId: String(postCard.dataset.authorId || ""),
        };
    }
    const diaryCard = actionEl.closest<HTMLElement>("[data-diary-card]");
    if (diaryCard) {
        return {
            cardType: "diary",
            card: diaryCard,
            itemId: String(diaryCard.dataset.diaryId || ""),
            authorId: String(diaryCard.dataset.authorId || ""),
        };
    }
    return null;
}

function setupPostCardActions() {
    if (runtimeWindow._postCardActionsAttached) {
        return;
    }

    document.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null;
        if (!target) {
            return;
        }
        const summary = target.closest<HTMLElement>(
            ".post-card-menu > summary",
        );
        if (summary && !currentAuthState.isLoggedIn) {
            event.preventDefault();
            showAuthRequiredDialog();
        }
    });

    document.addEventListener("click", async (event) => {
        const target = event.target as HTMLElement | null;
        if (!target) {
            return;
        }
        const actionEl = target.closest<HTMLElement>("[data-action]");
        if (!actionEl) {
            return;
        }

        const ctx = resolveCardContext(actionEl);
        if (!ctx || !ctx.itemId) {
            return;
        }

        const { cardType, itemId, authorId } = ctx;
        const action = String(actionEl.dataset.action || "");

        if (!currentAuthState.isLoggedIn) {
            showAuthRequiredDialog();
            return;
        }

        const details = actionEl.closest("details");
        details?.removeAttribute("open");

        try {
            if (
                action === "delete-own-article" ||
                action === "delete-admin-article"
            ) {
                const canDelete =
                    currentAuthState.isAdmin ||
                    currentAuthState.userId === authorId;
                if (!canDelete) {
                    await showNoticeDialog({
                        ariaLabel: t(I18nKey.dialogNoticeTitle),
                        message: t(I18nKey.postNoPermissionDeleteArticle),
                    });
                    return;
                }
                const confirmText =
                    action === "delete-admin-article"
                        ? t(I18nKey.postDeleteConfirmAdminArticle)
                        : t(I18nKey.postDeleteConfirmOwnArticle);
                const confirmed = await showConfirmDialog({
                    ariaLabel: t(I18nKey.dialogConfirmTitle),
                    message: confirmText,
                    confirmText: t(I18nKey.commonDelete),
                    cancelText: t(I18nKey.commonCancel),
                    confirmVariant: "danger",
                });
                if (!confirmed) {
                    return;
                }
                try {
                    await requestDeleteArticle(itemId);
                    removeCardByArticleId(itemId);
                } catch (error) {
                    const message =
                        error instanceof Error
                            ? error.message
                            : t(I18nKey.postDeleteFailed);
                    await showNoticeDialog({
                        ariaLabel: t(I18nKey.dialogNoticeTitle),
                        message,
                    });
                }
                return;
            }

            if (
                action === "delete-own-diary" ||
                action === "delete-admin-diary"
            ) {
                const canDelete =
                    currentAuthState.isAdmin ||
                    currentAuthState.userId === authorId;
                if (!canDelete) {
                    await showNoticeDialog({
                        ariaLabel: t(I18nKey.dialogNoticeTitle),
                        message: t(I18nKey.postNoPermissionDeleteDiary),
                    });
                    return;
                }
                const confirmText =
                    action === "delete-admin-diary"
                        ? t(I18nKey.postDeleteConfirmAdminDiary)
                        : t(I18nKey.postDeleteConfirmOwnDiary);
                const confirmed = await showConfirmDialog({
                    ariaLabel: t(I18nKey.dialogConfirmTitle),
                    message: confirmText,
                    confirmText: t(I18nKey.commonDelete),
                    cancelText: t(I18nKey.commonCancel),
                    confirmVariant: "danger",
                });
                if (!confirmed) {
                    return;
                }
                try {
                    await requestDeleteDiary(itemId);
                    removeCardByDiaryId(itemId);
                } catch (error) {
                    const message =
                        error instanceof Error
                            ? error.message
                            : t(I18nKey.postDeleteFailed);
                    await showNoticeDialog({
                        ariaLabel: t(I18nKey.dialogNoticeTitle),
                        message,
                    });
                }
                return;
            }

            if (action === "toggle-like") {
                const button = actionEl as HTMLButtonElement;
                if (isLikeButtonPending(button)) {
                    return;
                }
                const previousLiked = button.dataset.liked === "true";
                const previousLikeCount = getLikeButtonCount(button);
                const optimisticLiked = !previousLiked;
                const optimisticLikeCount = Math.max(
                    0,
                    previousLikeCount + (optimisticLiked ? 1 : -1),
                );

                setLikeButtonPending(button, true);
                setLikeButtonState(
                    button,
                    optimisticLiked,
                    optimisticLikeCount,
                );
                try {
                    if (cardType === "diary") {
                        const result = await requestToggleDiaryLike(itemId);
                        setLikeButtonState(
                            button,
                            result.liked,
                            result.like_count,
                        );
                    } else {
                        const result = await requestToggleLike(itemId);
                        setLikeButtonState(
                            button,
                            result.liked,
                            result.like_count,
                        );
                    }
                } catch (error) {
                    setLikeButtonState(
                        button,
                        previousLiked,
                        previousLikeCount,
                    );
                    throw error;
                } finally {
                    setLikeButtonPending(button, false);
                }
                return;
            }

            if (action === "block-user") {
                if (!authorId || currentAuthState.userId === authorId) {
                    await showNoticeDialog({
                        ariaLabel: t(I18nKey.dialogNoticeTitle),
                        message: t(I18nKey.postCannotBlockUser),
                    });
                    return;
                }
                const formValues = await showFormDialog({
                    ariaLabel: t(I18nKey.postBlockUserTitle),
                    message: t(I18nKey.postBlockUserMessage),
                    confirmText: t(I18nKey.commonConfirm),
                    cancelText: t(I18nKey.commonCancel),
                    confirmVariant: "danger",
                    fields: [
                        {
                            name: "reason",
                            label: t(I18nKey.postBlockReasonLabel),
                            type: "textarea",
                            placeholder: t(I18nKey.postBlockReasonPlaceholder),
                            rows: 3,
                        },
                    ],
                });
                if (!formValues) {
                    return;
                }
                const reason = String(formValues.reason || "").trim();
                await requestBlockUser(authorId, reason);
                removeCardsByAuthorId(authorId);
                await showNoticeDialog({
                    ariaLabel: t(I18nKey.dialogNoticeTitle),
                    message: t(I18nKey.postBlockSuccess),
                });
                return;
            }

        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : t(I18nKey.postActionFailed);
            await showNoticeDialog({
                ariaLabel: t(I18nKey.dialogNoticeTitle),
                message,
            });
        }
    });

    document.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null;
        if (!target) {
            return;
        }
        document
            .querySelectorAll<HTMLDetailsElement>(".post-card-menu[open]")
            .forEach((menu) => {
                if (!menu.contains(target)) {
                    menu.removeAttribute("open");
                }
            });
    });

    subscribeAuthState((state) => {
        updateCurrentAuthState(state);
        updateCardActionVisibility(currentAuthState);
        void applyBlockedUsersFilter();
        void syncLikeButtons();
    });

    runtimeWindow._postCardActionsAttached = true;
}

export function initPostInteractions(): void {
    if (runtimeWindow._postInteractionsInitialized) {
        return;
    }
    runtimeWindow._postInteractionsInitialized = true;

    setupCalendarFilterListeners();
    setupPostCardActions();
    updateCurrentAuthState(getAuthState());
    updateCardActionVisibility(currentAuthState);
    void (async () => {
        await applyBlockedUsersFilter();
        await syncLikeButtons();
    })();
}
