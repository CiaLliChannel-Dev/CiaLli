import type { LayoutController } from "./layout-controller";
import {
    applySidebarProfilePatch,
    extractSidebarProfilePatch,
    syncSidebarAvatarLoadingState,
    type SidebarProfilePatch,
} from "./sidebar-profile-sync";
import {
    activateEnterSkeleton,
    deactivateEnterSkeleton,
    forceResetEnterSkeleton,
} from "./enter-skeleton";
import { scrollToHashBelowTocBaseline } from "@/utils/hash-scroll";
import { getTocBaselineOffset } from "@/utils/toc-offset";

type SwupVisit = {
    containers: string[];
    to: {
        document?: Document;
        url?: unknown;
        path?: unknown;
        pathname?: unknown;
        href?: unknown;
    };
    scroll?: {
        reset?: boolean;
        target?: string | false;
    };
};

const BANNER_TO_SPEC_TRANSITION_CLASS = "layout-banner-to-spec-transition";
const BANNER_TO_SPEC_TRANSITION_PREPARING_CLASS =
    "layout-banner-to-spec-transition-preparing";
const BANNER_TO_SPEC_TRANSITION_ACTIVE_CLASS =
    "layout-banner-to-spec-transition-active";
const BANNER_TO_SPEC_NAVBAR_SYNC_CLASS = "layout-banner-to-spec-navbar-sync";
const BANNER_TO_SPEC_NAVBAR_COMMIT_FREEZE_CLASS =
    "layout-banner-to-spec-navbar-commit-freeze";
const BANNER_TO_SPEC_SHIFT_VAR = "--layout-banner-route-up-shift";
const BANNER_TO_SPEC_BANNER_EXTRA_SHIFT_VAR =
    "--layout-banner-route-banner-extra-shift";
const BANNER_TO_SPEC_TRANSITION_DURATION_VAR =
    "--layout-banner-route-transition-duration";
const ENTER_SKELETON_AWAITING_REPLACE_CLASS = "enter-skeleton-awaiting-replace";
const BANNER_TO_SPEC_TRANSITION_DURATION_MS = 920;
const COLLAPSED_MAIN_PANEL_TOP = "5.5rem";
const SIDEBAR_OVERSHOOT_TOLERANCE_PX = 0.75;

function isCurrentHomeRoute(body: HTMLElement): boolean {
    if (body.dataset.routeHome === "true") {
        return true;
    }
    if (body.dataset.routeHome === "false") {
        return false;
    }
    return body.classList.contains("lg:is-home");
}

function normalizePathname(pathname: string): string {
    const normalized = pathname.replace(/\/+$/, "");
    return normalized === "" ? "/" : normalized;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    return value as Record<string, unknown>;
}

function extractPathnameFromUnknown(value: unknown): string | null {
    if (value instanceof URL) {
        return normalizePathname(value.pathname);
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }

        try {
            const parsed = new URL(trimmed, window.location.origin);
            return normalizePathname(parsed.pathname);
        } catch {
            const fallbackPath = trimmed.split("#")[0]?.split("?")[0] || "";
            if (!fallbackPath) {
                return null;
            }
            return normalizePathname(fallbackPath);
        }
    }

    const record = asRecord(value);
    if (!record) {
        return null;
    }

    return (
        extractPathnameFromUnknown(record.pathname) ??
        extractPathnameFromUnknown(record.path) ??
        extractPathnameFromUnknown(record.url) ??
        extractPathnameFromUnknown(record.href)
    );
}

function extractVisitPathname(visit: SwupVisit): string | null {
    const to = asRecord(visit.to);
    const fromVisitTarget =
        extractPathnameFromUnknown(to?.url) ??
        extractPathnameFromUnknown(to?.pathname) ??
        extractPathnameFromUnknown(to?.path) ??
        extractPathnameFromUnknown(to?.href) ??
        extractPathnameFromUnknown(
            to?.document instanceof Document ? to.document.URL : null,
        );
    if (fromVisitTarget) {
        return fromVisitTarget;
    }

    // Swup history navigation can provide target URL through history.state.
    const historyState = asRecord(history.state);
    return extractPathnameFromUnknown(historyState?.url);
}

function parseCssLengthToPx(lengthValue: string): number | null {
    const trimmed = lengthValue.trim();
    if (!trimmed) {
        return null;
    }

    const probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.pointerEvents = "none";
    probe.style.height = trimmed;
    document.body.appendChild(probe);
    const measuredPx = probe.getBoundingClientRect().height;
    probe.remove();

    if (!Number.isFinite(measuredPx) || measuredPx <= 0) {
        return null;
    }

    return measuredPx;
}

function resolveTargetMainPanelTopPx(visit: SwupVisit): number {
    const targetMainPanel = visit.to.document?.querySelector<HTMLElement>(
        ".main-panel-wrapper",
    );
    const inlineTop = targetMainPanel?.style.top?.trim() || "";
    const parsedInlineTop =
        inlineTop.length > 0 ? parseCssLengthToPx(inlineTop) : null;
    if (parsedInlineTop !== null) {
        return parsedInlineTop;
    }

    const collapsedTopPx = parseCssLengthToPx(COLLAPSED_MAIN_PANEL_TOP);
    if (collapsedTopPx !== null) {
        return collapsedTopPx;
    }

    return getTocBaselineOffset();
}

function resolveAnchorViewportTop(selector: string): number | null {
    const element = document.querySelector<HTMLElement>(selector);
    if (!(element instanceof HTMLElement)) {
        return null;
    }

    const rect = element.getBoundingClientRect();
    if (rect.height <= 0 || rect.width <= 0) {
        return null;
    }

    return rect.top;
}

type BannerToSpecShiftMetrics = {
    mainPanelShiftPx: number;
    bannerExtraShiftPx: number;
};

function resolveBannerToSpecShiftMetrics(
    visit: SwupVisit,
): BannerToSpecShiftMetrics {
    const targetTop = resolveTargetMainPanelTopPx(visit);
    const mainPanelTop = resolveAnchorViewportTop(".main-panel-wrapper");
    const resolvedBannerExtraShift = Math.max(0, Number(targetTop.toFixed(3)));
    if (mainPanelTop === null) {
        return {
            mainPanelShiftPx: 0,
            bannerExtraShiftPx: resolvedBannerExtraShift,
        };
    }

    // Keep the main panel as the primary anchor so transition end aligns
    // exactly with the target layout top and avoids a tail "catch-up" snap.
    const rawMainShift = mainPanelTop - targetTop;
    if (rawMainShift <= 0) {
        return {
            mainPanelShiftPx: 0,
            bannerExtraShiftPx: resolvedBannerExtraShift,
        };
    }

    // Apply a safety cap only when a sidebar would move above navbar baseline.
    // This prevents overshoot while avoiding conservative under-shift.
    const sidebarCap = ["#sidebar", "#right-sidebar-slot"]
        .map((selector) => resolveAnchorViewportTop(selector))
        .filter((top): top is number => typeof top === "number")
        .map((top) => top - (targetTop - SIDEBAR_OVERSHOOT_TOLERANCE_PX))
        .reduce<number>(
            (minCap, candidate) => Math.min(minCap, candidate),
            Number.POSITIVE_INFINITY,
        );

    const resolvedShift = Number.isFinite(sidebarCap)
        ? Math.min(rawMainShift, sidebarCap)
        : rawMainShift;

    return {
        mainPanelShiftPx: Math.max(0, Number(resolvedShift.toFixed(3))),
        bannerExtraShiftPx: resolvedBannerExtraShift,
    };
}

function applyBannerToSpecShiftVariables(
    visit: SwupVisit,
    root: HTMLElement = document.documentElement,
): void {
    const { mainPanelShiftPx, bannerExtraShiftPx } =
        resolveBannerToSpecShiftMetrics(visit);
    root.style.setProperty(BANNER_TO_SPEC_SHIFT_VAR, `${mainPanelShiftPx}px`);
    root.style.setProperty(
        BANNER_TO_SPEC_BANNER_EXTRA_SHIFT_VAR,
        `${bannerExtraShiftPx}px`,
    );
}

function isSidebarProfilePatchEqual(
    left: SidebarProfilePatch,
    right: SidebarProfilePatch,
): boolean {
    if (left.socialMode !== right.socialMode) {
        return false;
    }
    if (left.socialLinks.length !== right.socialLinks.length) {
        return false;
    }
    const linksEqual = left.socialLinks.every((link, index) => {
        const target = right.socialLinks[index];
        return (
            link.platform === target?.platform &&
            link.url === target?.url &&
            link.label === target?.label
        );
    });

    return (
        left.uid === right.uid &&
        left.displayName === right.displayName &&
        left.bio === right.bio &&
        left.profileLink === right.profileLink &&
        left.avatarUrl === right.avatarUrl &&
        linksEqual
    );
}

function stripOnloadAnimationClasses(scope: HTMLElement): void {
    scope.classList.remove("onload-animation");
    const animatedElements =
        scope.querySelectorAll<HTMLElement>(".onload-animation");
    animatedElements.forEach((element) => {
        element.classList.remove("onload-animation");
        element.style.removeProperty("animation-delay");
    });
}

type SwupIntentSourceDependencies = {
    controller: LayoutController;
    initFancybox: () => Promise<void>;
    cleanupFancybox: () => void;
    checkKatex: () => void;
    initKatexScrollbars: () => void;
    defaultTheme: string;
    darkMode: string;
    pathsEqual: (left: string, right: string) => boolean;
    url: (path: string) => string;
};

export function setupSwupIntentSource(
    deps: SwupIntentSourceDependencies,
): void {
    const runtimeWindow = window as Window &
        typeof globalThis & {
            swup?: {
                hooks?: {
                    on: (
                        event: string,
                        callback: (...args: never[]) => void,
                    ) => void;
                    before: (
                        event: string,
                        callback: (visit: SwupVisit) => void,
                    ) => void;
                };
            };
            floatingTOCInit?: () => void;
        };

    const swup = runtimeWindow.swup;
    if (!swup?.hooks) {
        return;
    }

    let pendingBannerToSpecRoutePath: string | null = null;
    let pendingSidebarProfilePatch: SidebarProfilePatch | null = null;
    let bannerToSpecAnimationStartedAt: number | null = null;
    let delayedPageViewTimerId: number | null = null;
    let didReplaceContentDuringVisit = false;
    let shouldDelayBannerToSpecMoveUntilReplace = false;
    let didForceNavbarScrolledForBannerToSpec = false;
    let pendingBannerToSpecVisit: SwupVisit | null = null;

    const setPageHeightExtendVisible = (visible: boolean): void => {
        const heightExtend = document.getElementById("page-height-extend");
        if (!heightExtend) {
            return;
        }
        // 仅在 banner->spec 过渡窗口期暂时拉高文档高度，避免内容替换时滚动位置被浏览器强制校正。
        heightExtend.classList.toggle("hidden", !visible);
    };

    const clearDelayedPageViewTimer = (): void => {
        if (delayedPageViewTimerId !== null) {
            window.clearTimeout(delayedPageViewTimerId);
            delayedPageViewTimerId = null;
        }
    };

    const forceNavbarScrolledForBannerToSpecTransition = (): void => {
        const navbar = document.getElementById("navbar");
        if (!(navbar instanceof HTMLElement)) {
            return;
        }
        if (!navbar.classList.contains("scrolled")) {
            navbar.classList.add("scrolled");
            didForceNavbarScrolledForBannerToSpec = true;
        }
    };

    const releaseForcedNavbarScrolledState = (): void => {
        if (!didForceNavbarScrolledForBannerToSpec) {
            return;
        }
        const navbar = document.getElementById("navbar");
        if (navbar instanceof HTMLElement) {
            navbar.classList.remove("scrolled");
        }
        didForceNavbarScrolledForBannerToSpec = false;
    };

    const setAwaitingReplaceState = (isAwaiting: boolean): void => {
        const root = document.documentElement;
        root.classList.toggle(
            ENTER_SKELETON_AWAITING_REPLACE_CLASS,
            isAwaiting,
        );
    };

    const getBannerToSpecRemainingMs = (): number => {
        if (
            !pendingBannerToSpecRoutePath ||
            bannerToSpecAnimationStartedAt === null
        ) {
            return 0;
        }
        const elapsedMs = performance.now() - bannerToSpecAnimationStartedAt;
        return Math.max(0, BANNER_TO_SPEC_TRANSITION_DURATION_MS - elapsedMs);
    };

    const clearBannerToSpecTransitionVisualState = (options?: {
        preserveNavbarCommitFreeze?: boolean;
    }): void => {
        clearDelayedPageViewTimer();
        bannerToSpecAnimationStartedAt = null;
        shouldDelayBannerToSpecMoveUntilReplace = false;
        releaseForcedNavbarScrolledState();
        const root = document.documentElement;
        root.classList.remove(BANNER_TO_SPEC_TRANSITION_CLASS);
        root.classList.remove(BANNER_TO_SPEC_TRANSITION_PREPARING_CLASS);
        root.classList.remove(BANNER_TO_SPEC_TRANSITION_ACTIVE_CLASS);
        root.classList.remove(BANNER_TO_SPEC_NAVBAR_SYNC_CLASS);
        if (!options?.preserveNavbarCommitFreeze) {
            root.classList.remove(BANNER_TO_SPEC_NAVBAR_COMMIT_FREEZE_CLASS);
        }
        root.style.removeProperty(BANNER_TO_SPEC_SHIFT_VAR);
        root.style.removeProperty(BANNER_TO_SPEC_BANNER_EXTRA_SHIFT_VAR);
        root.style.removeProperty(BANNER_TO_SPEC_TRANSITION_DURATION_VAR);
        setPageHeightExtendVisible(false);
    };

    const startBannerToSpecMoveTransition = (): void => {
        if (
            !pendingBannerToSpecRoutePath ||
            bannerToSpecAnimationStartedAt !== null
        ) {
            return;
        }
        const root = document.documentElement;
        if (pendingBannerToSpecVisit) {
            applyBannerToSpecShiftVariables(pendingBannerToSpecVisit, root);
        }
        forceNavbarScrolledForBannerToSpecTransition();
        root.classList.remove(BANNER_TO_SPEC_TRANSITION_PREPARING_CLASS);
        root.classList.add(BANNER_TO_SPEC_TRANSITION_ACTIVE_CLASS);
        root.classList.add(BANNER_TO_SPEC_NAVBAR_SYNC_CLASS);
        bannerToSpecAnimationStartedAt = performance.now();
    };

    const dispatchRouteChangeWithNavbarCommitFreeze = (): boolean => {
        const commitRouteChange = (): void => {
            deps.controller.dispatch({
                type: "ROUTE_CHANGED",
                path: window.location.pathname,
                scrollTop: document.documentElement.scrollTop,
                viewportWidth: window.innerWidth,
                reason: "route-change",
            });
        };

        if (
            !pendingBannerToSpecRoutePath ||
            bannerToSpecAnimationStartedAt === null
        ) {
            commitRouteChange();
            return false;
        }

        const root = document.documentElement;
        root.classList.add(BANNER_TO_SPEC_NAVBAR_COMMIT_FREEZE_CLASS);
        commitRouteChange();
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                root.classList.remove(
                    BANNER_TO_SPEC_NAVBAR_COMMIT_FREEZE_CLASS,
                );
            });
        });
        return true;
    };

    // Ensure spacer is always reset when tab visibility/lifecycle changes.
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") {
            setPageHeightExtendVisible(false);
        }
    });
    window.addEventListener("pageshow", () => {
        setPageHeightExtendVisible(false);
    });

    swup.hooks.before("content:replace", (visit: SwupVisit) => {
        pendingSidebarProfilePatch = null;

        // Sidebar UID 比较：相同 sidebar 跳过替换；不同账号但布局相同仅同步 profile 数据
        const currentSidebar = document.querySelector<HTMLElement>("#sidebar");
        const newSidebar = visit.to.document?.querySelector("#sidebar");
        if (currentSidebar && newSidebar) {
            const currentUid = currentSidebar.getAttribute("data-sidebar-uid");
            const newUid = newSidebar.getAttribute("data-sidebar-uid");
            const currentLayoutKey =
                currentSidebar.getAttribute("data-sidebar-layout-key") || "";
            const newLayoutKey =
                newSidebar.getAttribute("data-sidebar-layout-key") || "";
            const layoutComparable =
                currentLayoutKey.length > 0 && newLayoutKey.length > 0;
            const sameLayout =
                layoutComparable && currentLayoutKey === newLayoutKey;
            const currentPatch = extractSidebarProfilePatch(currentSidebar);
            const nextPatch = extractSidebarProfilePatch(newSidebar);
            const canPatch =
                sameLayout && currentPatch !== null && nextPatch !== null;

            const preserveSidebar = (): void => {
                visit.containers = visit.containers.filter(
                    (c) => c !== "#sidebar",
                );
                stripOnloadAnimationClasses(currentSidebar);
                currentSidebar.dataset.sidebarPreserved = "";
                const nextScrollable =
                    newSidebar.getAttribute("data-scrollable");
                if (nextScrollable) {
                    currentSidebar.setAttribute(
                        "data-scrollable",
                        nextScrollable,
                    );
                }
            };

            if (currentUid && newUid && currentUid === newUid) {
                if (layoutComparable && !sameLayout) {
                    // Same account but different widget layout -> let Swup replace full sidebar.
                } else {
                    preserveSidebar();
                    if (
                        canPatch &&
                        !isSidebarProfilePatchEqual(
                            currentPatch as SidebarProfilePatch,
                            nextPatch as SidebarProfilePatch,
                        )
                    ) {
                        pendingSidebarProfilePatch =
                            nextPatch as SidebarProfilePatch;
                    }
                }
            } else if (currentUid && newUid && sameLayout) {
                if (canPatch) {
                    preserveSidebar();
                    pendingSidebarProfilePatch =
                        nextPatch as SidebarProfilePatch;
                }
            }
        }

        // 同步 #main-grid 类名
        // #main-grid 不是 Swup 容器，但其 CSS 类会随侧边栏布局变化。
        // 在内容替换前同步，避免布局错乱。
        const newMainGrid = visit.to.document?.querySelector("#main-grid");
        const currentMainGrid = document.getElementById("main-grid");
        if (newMainGrid instanceof HTMLElement && currentMainGrid) {
            currentMainGrid.className = newMainGrid.className;
        }
    });

    swup.hooks.on("link:click", () => {
        document.documentElement.style.setProperty("--content-delay", "0ms");
    });

    swup.hooks.on("content:replace", () => {
        didReplaceContentDuringVisit = true;
        setAwaitingReplaceState(false);
        activateEnterSkeleton();
        void deps.initFancybox();
        deps.checkKatex();
        deps.initKatexScrollbars();
        if (pendingSidebarProfilePatch) {
            applySidebarProfilePatch(pendingSidebarProfilePatch);
            pendingSidebarProfilePatch = null;
        }
        syncSidebarAvatarLoadingState(document);

        const tocElement = document.querySelector("table-of-contents") as
            | (HTMLElement & { init?: () => void })
            | null;
        const hasAnyTOCRuntime =
            typeof tocElement?.init === "function" ||
            typeof runtimeWindow.floatingTOCInit === "function";

        if (hasAnyTOCRuntime) {
            window.setTimeout(() => {
                tocElement?.init?.();
                runtimeWindow.floatingTOCInit?.();
            }, 100);
        }

        if (pendingBannerToSpecRoutePath) {
            shouldDelayBannerToSpecMoveUntilReplace = false;
            startBannerToSpecMoveTransition();
        }
    });

    swup.hooks.on("visit:start", (visit: SwupVisit) => {
        didReplaceContentDuringVisit = false;
        forceResetEnterSkeleton();
        setAwaitingReplaceState(true);
        deps.cleanupFancybox();
        pendingBannerToSpecRoutePath = null;
        pendingSidebarProfilePatch = null;
        pendingBannerToSpecVisit = null;
        bannerToSpecAnimationStartedAt = null;
        shouldDelayBannerToSpecMoveUntilReplace = false;
        clearBannerToSpecTransitionVisualState();

        const targetPathname = extractVisitPathname(visit);
        const isTargetHome =
            targetPathname !== null &&
            deps.pathsEqual(targetPathname, deps.url("/"));
        const body = document.body;
        const currentPathname = normalizePathname(window.location.pathname);
        const currentIsHome =
            deps.pathsEqual(currentPathname, deps.url("/")) ||
            isCurrentHomeRoute(body);
        const hasBannerWrapper = document.getElementById("banner-wrapper");
        const shouldUseBannerToSpecTransition =
            currentIsHome &&
            hasBannerWrapper !== null &&
            targetPathname !== null &&
            !isTargetHome;

        if (shouldUseBannerToSpecTransition) {
            pendingBannerToSpecRoutePath = targetPathname;
            pendingBannerToSpecVisit = visit;
            const root = document.documentElement;
            applyBannerToSpecShiftVariables(visit, root);
            root.style.setProperty(
                BANNER_TO_SPEC_TRANSITION_DURATION_VAR,
                `${BANNER_TO_SPEC_TRANSITION_DURATION_MS}ms`,
            );
            root.classList.add(BANNER_TO_SPEC_TRANSITION_CLASS);
            root.classList.add(BANNER_TO_SPEC_TRANSITION_PREPARING_CLASS);
            shouldDelayBannerToSpecMoveUntilReplace = true;
            setPageHeightExtendVisible(true);
        } else {
            setPageHeightExtendVisible(false);
        }

        const toc = document.getElementById("toc-wrapper");
        if (toc) {
            toc.classList.add("toc-not-ready");
        }
    });

    swup.hooks.before("content:scroll", (visit: SwupVisit) => {
        if (!pendingBannerToSpecRoutePath || !visit.scroll) {
            return;
        }
        visit.scroll.reset = false;
        visit.scroll.target = false;
    });

    swup.hooks.on("animation:out:start", () => {
        if (!pendingBannerToSpecRoutePath) {
            return;
        }
        if (shouldDelayBannerToSpecMoveUntilReplace) {
            return;
        }
        startBannerToSpecMoveTransition();
    });

    swup.hooks.on("page:view", () => {
        const finalizePageView = (): void => {
            setAwaitingReplaceState(false);
            deactivateEnterSkeleton();
            const hash = window.location.hash?.slice(1);

            const didUseNavbarCommitFreeze =
                dispatchRouteChangeWithNavbarCommitFreeze();

            clearBannerToSpecTransitionVisualState({
                preserveNavbarCommitFreeze: didUseNavbarCommitFreeze,
            });
            pendingBannerToSpecRoutePath = null;
            pendingSidebarProfilePatch = null;
            pendingBannerToSpecVisit = null;

            const isHomePage = deps.pathsEqual(
                window.location.pathname,
                deps.url("/"),
            );

            const bannerTextOverlay = document.querySelector(
                ".banner-text-overlay",
            );
            if (bannerTextOverlay) {
                if (isHomePage) {
                    bannerTextOverlay.classList.remove("hidden");
                } else {
                    bannerTextOverlay.classList.add("hidden");
                }
            }

            setPageHeightExtendVisible(false);

            if (hash) {
                requestAnimationFrame(() => {
                    scrollToHashBelowTocBaseline(hash, {
                        behavior: "instant",
                    });
                });
            } else {
                window.scrollTo({
                    top: 0,
                    behavior: "instant" as ScrollBehavior,
                });
            }

            const storedTheme =
                localStorage.getItem("theme") || deps.defaultTheme;
            const isDark = storedTheme === deps.darkMode;
            const expectedTheme = isDark ? "github-dark" : "github-light";
            const currentTheme =
                document.documentElement.getAttribute("data-theme");
            const hasDarkClass =
                document.documentElement.classList.contains("dark");

            if (currentTheme !== expectedTheme || hasDarkClass !== isDark) {
                requestAnimationFrame(() => {
                    if (currentTheme !== expectedTheme) {
                        document.documentElement.setAttribute(
                            "data-theme",
                            expectedTheme,
                        );
                    }
                    if (hasDarkClass !== isDark) {
                        if (isDark) {
                            document.documentElement.classList.add("dark");
                        } else {
                            document.documentElement.classList.remove("dark");
                        }
                    }
                });
            }

            window.setTimeout(() => {
                if (document.getElementById("tcomment")) {
                    document.dispatchEvent(
                        new CustomEvent("cialli:page:loaded", {
                            detail: {
                                path: window.location.pathname,
                                timestamp: Date.now(),
                            },
                        }),
                    );
                }
            }, 300);
        };

        const remainingMs = getBannerToSpecRemainingMs();
        if (remainingMs > 0) {
            clearDelayedPageViewTimer();
            delayedPageViewTimerId = window.setTimeout(() => {
                delayedPageViewTimerId = null;
                finalizePageView();
            }, Math.ceil(remainingMs));
            return;
        }

        finalizePageView();
    });

    swup.hooks.on("visit:end", () => {
        setAwaitingReplaceState(false);
        const shouldForceCleanupForAbortedVisit = !didReplaceContentDuringVisit;
        if (shouldForceCleanupForAbortedVisit) {
            forceResetEnterSkeleton();
        }
        const remainingMs = getBannerToSpecRemainingMs();
        const hasPendingBannerToSpecTransition =
            pendingBannerToSpecRoutePath !== null;
        if (
            shouldForceCleanupForAbortedVisit ||
            (!hasPendingBannerToSpecTransition && remainingMs <= 0)
        ) {
            pendingBannerToSpecRoutePath = null;
            pendingSidebarProfilePatch = null;
            pendingBannerToSpecVisit = null;
            clearBannerToSpecTransitionVisualState();
        }

        const sidebar = document.getElementById("sidebar");
        if (sidebar) {
            delete sidebar.dataset.sidebarPreserved;
        }

        const cleanupDelayMs =
            remainingMs > 0 ? Math.ceil(remainingMs) + 200 : 200;
        window.setTimeout(() => {
            setPageHeightExtendVisible(false);
            const toc = document.getElementById("toc-wrapper");
            if (toc) {
                toc.classList.remove("toc-not-ready");
            }
        }, cleanupDelayMs);
    });
}
