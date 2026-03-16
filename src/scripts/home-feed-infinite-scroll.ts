import { setupPageInit } from "@/utils/page-init";

type HomeFeedRuntimeWindow = Window &
    typeof globalThis & {
        __homeScrollCleanup?: () => void;
    };

const BATCH_SIZE = 5;
const HOME_FEED_FRAGMENT_PATH = "/_fragments/home-feed-items";
const runtimeWindow = window as HomeFeedRuntimeWindow;

function parseBooleanFlag(value: string | null | undefined): boolean {
    return (
        String(value || "")
            .trim()
            .toLowerCase() === "true"
    );
}

function parseNonNegativeInt(value: string | null | undefined): number | null {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return null;
    }
    return Math.floor(parsed);
}

async function loadFragment(
    offset: number,
    limit: number,
): Promise<{
    html: string;
    hasMore: boolean;
    nextOffset: number;
}> {
    const response = await fetch(
        `${HOME_FEED_FRAGMENT_PATH}?offset=${offset}&limit=${limit}`,
        {
            credentials: "include",
            headers: {
                Accept: "text/html",
            },
        },
    );

    const html = await response.text().catch(() => "");
    if (!response.ok) {
        throw new Error(
            `home feed fragment request failed: ${response.status}`,
        );
    }

    return {
        html,
        hasMore: parseBooleanFlag(response.headers.get("X-Home-Feed-Has-More")),
        nextOffset:
            parseNonNegativeInt(
                response.headers.get("X-Home-Feed-Next-Offset"),
            ) ?? offset,
    };
}

function initHomeInfiniteScroll(): void {
    runtimeWindow.__homeScrollCleanup?.();

    const postList = document.getElementById("post-list-container");
    const sentinel = document.getElementById("infinite-scroll-sentinel");
    const loadingEl = document.getElementById("scroll-loading");

    if (
        !(postList instanceof HTMLElement) ||
        !(sentinel instanceof HTMLElement)
    ) {
        return;
    }

    const initialLoadedCount =
        postList.querySelectorAll(".post-list-item").length;
    let loadedCount =
        parseNonNegativeInt(sentinel.dataset.nextOffset) ?? initialLoadedCount;
    let hasMore = parseBooleanFlag(sentinel.dataset.hasMore);
    let isLoading = false;

    if (!hasMore || initialLoadedCount === 0) {
        sentinel.classList.add("hidden");
        return;
    }

    const loadNextBatch = async (): Promise<void> => {
        if (!hasMore || isLoading) {
            return;
        }

        isLoading = true;
        loadingEl?.classList.remove("hidden");

        try {
            const result = await loadFragment(loadedCount, BATCH_SIZE);
            const html = result.html.trim();

            if (!html) {
                hasMore = false;
                sentinel.classList.add("hidden");
                observer.disconnect();
                return;
            }

            const fragment = document
                .createRange()
                .createContextualFragment(html);

            // 新批次只负责插入服务端片段，卡片 DOM 结构始终与首屏保持完全一致。
            postList.appendChild(fragment);

            loadedCount = result.nextOffset;
            hasMore = result.hasMore;
            sentinel.dataset.nextOffset = String(loadedCount);
            sentinel.dataset.hasMore = hasMore ? "true" : "false";

            if (!hasMore) {
                sentinel.classList.add("hidden");
                observer.disconnect();
            }
        } catch (error) {
            console.error("[home] load next feed batch failed:", error);
        } finally {
            isLoading = false;
            loadingEl?.classList.add("hidden");
        }
    };

    const observer = new IntersectionObserver(
        (entries) => {
            if (!entries[0]?.isIntersecting || !hasMore) {
                return;
            }
            void loadNextBatch();
        },
        { rootMargin: "200px" },
    );

    observer.observe(sentinel);

    runtimeWindow.__homeScrollCleanup = () => {
        observer.disconnect();
        runtimeWindow.__homeScrollCleanup = undefined;
    };
}

export function setupHomeFeedInfiniteScroll(): void {
    setupPageInit({
        key: "home-feed-infinite-scroll",
        init: initHomeInfiniteScroll,
        cleanup: () => {
            runtimeWindow.__homeScrollCleanup?.();
        },
        stages: ["page-load", "after-swap"],
    });
}
