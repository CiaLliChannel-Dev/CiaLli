import { getTocBaselineOffset } from "@/utils/toc-offset";
import {
    extractSidebarProfilePatch,
    type SidebarProfilePatch,
} from "./sidebar-profile-sync";
import type { LayoutController } from "./layout-controller";

const COLLAPSED_MAIN_PANEL_TOP_VALUE = "5.5rem";
const SIDEBAR_OVERSHOOT_TOLERANCE_PX_VALUE = 0.75;

// ===== Exported CSS class / var name constants =====
export const BANNER_TO_SPEC_TRANSITION_CLASS =
    "layout-banner-to-spec-transition";
export const BANNER_TO_SPEC_TRANSITION_PREPARING_CLASS =
    "layout-banner-to-spec-transition-preparing";
export const BANNER_TO_SPEC_TRANSITION_ACTIVE_CLASS =
    "layout-banner-to-spec-transition-active";
export const BANNER_TO_SPEC_NAVBAR_SYNC_CLASS =
    "layout-banner-to-spec-navbar-sync";
export const BANNER_TO_SPEC_NAVBAR_COMMIT_FREEZE_CLASS =
    "layout-banner-to-spec-navbar-commit-freeze";
export const SPEC_TO_BANNER_TRANSITION_CLASS =
    "layout-spec-to-banner-transition";
export const BANNER_TO_SPEC_SHIFT_VAR = "--layout-banner-route-up-shift";
export const BANNER_TO_SPEC_BANNER_EXTRA_SHIFT_VAR =
    "--layout-banner-route-banner-extra-shift";
export const BANNER_TO_SPEC_TRANSITION_DURATION_VAR =
    "--layout-banner-route-transition-duration";
export const BANNER_TO_SPEC_VT_DURATION_VAR =
    "--layout-banner-route-vt-duration";
export const BANNER_TO_SPEC_MAIN_PANEL_VT_NAME = "banner-route-main-panel";
export const BANNER_TO_SPEC_BANNER_VT_NAME = "banner-route-banner";
export const ENTER_SKELETON_AWAITING_REPLACE_CLASS =
    "enter-skeleton-awaiting-replace";
export const BANNER_TO_SPEC_TRANSITION_DURATION_MS = 920;
export const ROOT_RUNTIME_CLASSES_TO_PRESERVE = [
    "dark",
    "is-theme-transitioning",
    "use-view-transition",
    "enter-skeleton-active",
    ENTER_SKELETON_AWAITING_REPLACE_CLASS,
    BANNER_TO_SPEC_TRANSITION_CLASS,
    BANNER_TO_SPEC_TRANSITION_PREPARING_CLASS,
    BANNER_TO_SPEC_TRANSITION_ACTIVE_CLASS,
    BANNER_TO_SPEC_NAVBAR_SYNC_CLASS,
    BANNER_TO_SPEC_NAVBAR_COMMIT_FREEZE_CLASS,
    SPEC_TO_BANNER_TRANSITION_CLASS,
] as const;
export const ROOT_RUNTIME_STYLE_PROPERTIES_TO_PRESERVE = [
    "font-size",
    "--hue",
    "--banner-height-extend",
    BANNER_TO_SPEC_SHIFT_VAR,
    BANNER_TO_SPEC_BANNER_EXTRA_SHIFT_VAR,
    BANNER_TO_SPEC_TRANSITION_DURATION_VAR,
    BANNER_TO_SPEC_VT_DURATION_VAR,
] as const;
export const ROOT_RUNTIME_DATA_ATTRIBUTES_TO_PRESERVE = [
    "data-desktop-unsupported",
    "data-desktop-force-browse",
    "data-enter-skeleton-mode",
    "data-nav-phase",
] as const;

// ===== Navigation target / pathname utils =====

export function isCurrentHomeRoute(body: HTMLElement): boolean {
    if (body.dataset.routeHome === "true") {
        return true;
    }
    if (body.dataset.routeHome === "false") {
        return false;
    }
    return body.classList.contains("lg:is-home");
}

export function normalizePathname(pathname: string): string {
    const normalized = pathname.replace(/\/+$/, "");
    return normalized === "" ? "/" : normalized;
}

export function isSameNavigationTarget(from: URL, to: URL): boolean {
    return (
        normalizePathname(from.pathname) === normalizePathname(to.pathname) &&
        from.search === to.search &&
        from.hash === to.hash
    );
}

// ===== Banner shift metrics =====

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

function resolveTargetMainPanelTopPx(newDocument?: Document): number {
    const targetMainPanel = newDocument?.querySelector<HTMLElement>(
        ".main-panel-wrapper",
    );
    const inlineTop = targetMainPanel?.style.top?.trim() || "";
    const parsedInlineTop =
        inlineTop.length > 0 ? parseCssLengthToPx(inlineTop) : null;
    if (parsedInlineTop !== null) {
        return parsedInlineTop;
    }
    const collapsedTopPx = parseCssLengthToPx(COLLAPSED_MAIN_PANEL_TOP_VALUE);
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

export function resolveBannerToSpecShiftMetrics(
    newDocument?: Document,
): BannerToSpecShiftMetrics {
    const targetTop = resolveTargetMainPanelTopPx(newDocument);
    const mainPanelTop = resolveAnchorViewportTop(".main-panel-wrapper");
    const resolvedBannerExtraShift = Math.max(0, Number(targetTop.toFixed(3)));
    if (mainPanelTop === null) {
        return {
            mainPanelShiftPx: 0,
            bannerExtraShiftPx: resolvedBannerExtraShift,
        };
    }

    const rawMainShift = mainPanelTop - targetTop;
    if (rawMainShift <= 0) {
        return {
            mainPanelShiftPx: 0,
            bannerExtraShiftPx: resolvedBannerExtraShift,
        };
    }

    const sidebarCap = ["#sidebar", "#right-sidebar-slot"]
        .map((selector) => resolveAnchorViewportTop(selector))
        .filter((top): top is number => typeof top === "number")
        .map((top) => top - (targetTop - SIDEBAR_OVERSHOOT_TOLERANCE_PX_VALUE))
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

// ===== DOM helpers =====

export function stripOnloadAnimationClasses(scope: HTMLElement): void {
    scope.classList.remove("onload-animation");
    const animatedElements =
        scope.querySelectorAll<HTMLElement>(".onload-animation");
    animatedElements.forEach((element) => {
        element.classList.remove("onload-animation");
        element.style.removeProperty("animation-delay");
    });
}

export function setBannerToSpecViewTransitionNames(scope: ParentNode): void {
    const mainPanel = scope.querySelector<HTMLElement>(".main-panel-wrapper");
    if (mainPanel) {
        mainPanel.style.setProperty(
            "view-transition-name",
            BANNER_TO_SPEC_MAIN_PANEL_VT_NAME,
        );
    }
    const bannerWrapper = scope.querySelector<HTMLElement>("#banner-wrapper");
    if (bannerWrapper) {
        bannerWrapper.style.setProperty(
            "view-transition-name",
            BANNER_TO_SPEC_BANNER_VT_NAME,
        );
    }
}

export function clearBannerToSpecViewTransitionNames(scope: ParentNode): void {
    const mainPanel = scope.querySelector<HTMLElement>(".main-panel-wrapper");
    if (mainPanel) {
        mainPanel.style.removeProperty("view-transition-name");
    }
    const bannerWrapper = scope.querySelector<HTMLElement>("#banner-wrapper");
    if (bannerWrapper) {
        bannerWrapper.style.removeProperty("view-transition-name");
    }
}

export function freezeSpecLayoutStateForHomeDocument(
    targetDocument: Document = document,
): void {
    const body = targetDocument.body;
    if (!(body instanceof HTMLElement)) {
        return;
    }
    body.dataset.layoutMode = "none";
    body.dataset.routeHome = "false";
    body.classList.remove("lg:is-home");
    body.classList.remove("enable-banner");
    body.classList.remove("scroll-collapsed-banner");
    body.classList.add("no-banner-mode");
    body.classList.add("waves-paused");
}

export function applyBannerToSpecShiftVariables(
    newDocument?: Document,
    root: HTMLElement = document.documentElement,
): void {
    const { mainPanelShiftPx, bannerExtraShiftPx } =
        resolveBannerToSpecShiftMetrics(newDocument);
    root.style.setProperty(BANNER_TO_SPEC_SHIFT_VAR, `${mainPanelShiftPx}px`);
    root.style.setProperty(
        BANNER_TO_SPEC_BANNER_EXTRA_SHIFT_VAR,
        `${bannerExtraShiftPx}px`,
    );
}

export function setPageHeightExtendVisible(visible: boolean): void {
    const heightExtend = document.getElementById("page-height-extend");
    if (!heightExtend) {
        return;
    }
    heightExtend.classList.toggle("hidden", !visible);
}

export function setAwaitingReplaceState(isAwaiting: boolean): void {
    document.documentElement.classList.toggle(
        ENTER_SKELETON_AWAITING_REPLACE_CLASS,
        isAwaiting,
    );
}

export function resolveExpectedThemeState(
    defaultTheme: string,
    darkMode: string,
): { isDark: boolean; codeTheme: "github-dark" | "github-light" } {
    const storedTheme = localStorage.getItem("theme") || defaultTheme;
    const isDark = storedTheme === darkMode;
    return { isDark, codeTheme: isDark ? "github-dark" : "github-light" };
}

export function applyThemeStateToRoot(
    root: HTMLElement,
    state: { isDark: boolean; codeTheme: "github-dark" | "github-light" },
): void {
    root.classList.toggle("dark", state.isDark);
    root.setAttribute("data-theme", state.codeTheme);
}

export function syncRootRuntimeStateToIncomingDocument(
    newDocument: Document,
    defaultTheme: string,
    darkMode: string,
): void {
    const currentRoot = document.documentElement;
    const incomingRoot = newDocument.documentElement;
    ROOT_RUNTIME_CLASSES_TO_PRESERVE.forEach((className) => {
        incomingRoot.classList.toggle(
            className,
            currentRoot.classList.contains(className),
        );
    });
    ROOT_RUNTIME_STYLE_PROPERTIES_TO_PRESERVE.forEach((propertyName) => {
        const value = currentRoot.style.getPropertyValue(propertyName);
        if (value.trim().length > 0) {
            incomingRoot.style.setProperty(propertyName, value);
            return;
        }
        incomingRoot.style.removeProperty(propertyName);
    });
    ROOT_RUNTIME_DATA_ATTRIBUTES_TO_PRESERVE.forEach((attributeName) => {
        const value = currentRoot.getAttribute(attributeName);
        if (typeof value === "string") {
            incomingRoot.setAttribute(attributeName, value);
            return;
        }
        incomingRoot.removeAttribute(attributeName);
    });
    applyThemeStateToRoot(
        incomingRoot,
        resolveExpectedThemeState(defaultTheme, darkMode),
    );
}

// ===== Sidebar preservation =====

export type SidebarPreservationResult = {
    shouldPreserveSidebar: boolean;
    patch: SidebarProfilePatch | null;
};

function prepareSidebarForPreservation(
    currentSidebar: HTMLElement,
    newSidebar: HTMLElement,
): void {
    stripOnloadAnimationClasses(currentSidebar);
    currentSidebar.dataset.sidebarPreserved = "";
    const nextScrollable = newSidebar.getAttribute("data-scrollable");
    if (nextScrollable) {
        currentSidebar.setAttribute("data-scrollable", nextScrollable);
    }
}

function isSameUidSidebarLayoutIncompatible(
    currentLayoutKey: string,
    newLayoutKey: string,
    currentUid: string | null,
    newUid: string | null,
): boolean {
    const layoutComparable =
        currentLayoutKey.length > 0 && newLayoutKey.length > 0;
    return (
        Boolean(currentUid) &&
        Boolean(newUid) &&
        currentUid === newUid &&
        layoutComparable &&
        currentLayoutKey !== newLayoutKey
    );
}

export function resolveSidebarPreservation(
    currentSidebar: HTMLElement,
    newSidebar: HTMLElement,
): SidebarPreservationResult {
    const currentUid = currentSidebar.getAttribute("data-sidebar-uid");
    const newUid = newSidebar.getAttribute("data-sidebar-uid");
    const currentLayoutKey =
        currentSidebar.getAttribute("data-sidebar-layout-key") || "";
    const newLayoutKey =
        newSidebar.getAttribute("data-sidebar-layout-key") || "";
    const layoutComparable =
        currentLayoutKey.length > 0 && newLayoutKey.length > 0;
    const sameLayout = layoutComparable && currentLayoutKey === newLayoutKey;
    const nextPatch = extractSidebarProfilePatch(newSidebar);
    const canPatch = sameLayout && nextPatch !== null;
    const bothHaveUid = Boolean(currentUid) && Boolean(newUid);

    if (
        isSameUidSidebarLayoutIncompatible(
            currentLayoutKey,
            newLayoutKey,
            currentUid,
            newUid,
        )
    ) {
        return { shouldPreserveSidebar: false, patch: null };
    }
    if (bothHaveUid && currentUid === newUid) {
        prepareSidebarForPreservation(currentSidebar, newSidebar);
        return {
            shouldPreserveSidebar: true,
            patch: canPatch ? (nextPatch as SidebarProfilePatch) : null,
        };
    }
    if (bothHaveUid && sameLayout && canPatch) {
        prepareSidebarForPreservation(currentSidebar, newSidebar);
        return {
            shouldPreserveSidebar: true,
            patch: nextPatch as SidebarProfilePatch,
        };
    }
    return { shouldPreserveSidebar: false, patch: null };
}

// ===== Transition state =====

export type TransitionIntentDeps = {
    controller: LayoutController;
    defaultTheme: string;
    darkMode: string;
    pathsEqual: (left: string, right: string) => boolean;
    url: (path: string) => string;
};

export type TransitionState = {
    pendingBannerToSpecRoutePath: string | null;
    pendingSidebarProfilePatch: SidebarProfilePatch | null;
    bannerToSpecAnimationStartedAt: number | null;
    delayedPageViewTimerId: number | null;
    didReplaceContentDuringVisit: boolean;
    didForceNavbarScrolledForBannerToSpec: boolean;
    pendingSpecToBannerFreeze: boolean;
    navigationInProgress: boolean;
    navigationToken: number;
    lastFinalizedNavigationToken: number | null;
};

export function clearDelayedPageViewTimer(state: TransitionState): void {
    if (state.delayedPageViewTimerId !== null) {
        window.clearTimeout(state.delayedPageViewTimerId);
        state.delayedPageViewTimerId = null;
    }
}

export function releaseForcedNavbarScrolledState(state: TransitionState): void {
    if (!state.didForceNavbarScrolledForBannerToSpec) {
        return;
    }
    const navbar = document.getElementById("navbar");
    if (navbar instanceof HTMLElement) {
        navbar.classList.remove("scrolled");
    }
    state.didForceNavbarScrolledForBannerToSpec = false;
}

export function getBannerToSpecRemainingMs(state: TransitionState): number {
    if (
        !state.pendingBannerToSpecRoutePath ||
        state.bannerToSpecAnimationStartedAt === null
    ) {
        return 0;
    }
    const elapsedMs = performance.now() - state.bannerToSpecAnimationStartedAt;
    return Math.max(0, BANNER_TO_SPEC_TRANSITION_DURATION_MS - elapsedMs);
}

export function clearBannerToSpecTransitionVisualState(
    state: TransitionState,
    options?: { preserveNavbarCommitFreeze?: boolean },
): void {
    clearDelayedPageViewTimer(state);
    state.bannerToSpecAnimationStartedAt = null;
    releaseForcedNavbarScrolledState(state);
    const root = document.documentElement;
    root.classList.remove(BANNER_TO_SPEC_TRANSITION_CLASS);
    root.classList.remove(BANNER_TO_SPEC_TRANSITION_PREPARING_CLASS);
    root.classList.remove(BANNER_TO_SPEC_TRANSITION_ACTIVE_CLASS);
    root.classList.remove(BANNER_TO_SPEC_NAVBAR_SYNC_CLASS);
    root.classList.remove(SPEC_TO_BANNER_TRANSITION_CLASS);
    if (!options?.preserveNavbarCommitFreeze) {
        root.classList.remove(BANNER_TO_SPEC_NAVBAR_COMMIT_FREEZE_CLASS);
    }
    root.style.removeProperty(BANNER_TO_SPEC_SHIFT_VAR);
    root.style.removeProperty(BANNER_TO_SPEC_BANNER_EXTRA_SHIFT_VAR);
    root.style.removeProperty(BANNER_TO_SPEC_TRANSITION_DURATION_VAR);
    root.style.removeProperty(BANNER_TO_SPEC_VT_DURATION_VAR);
    setPageHeightExtendVisible(false);
    clearBannerToSpecViewTransitionNames(document);
}

export function startBannerToSpecMoveTransition(state: TransitionState): void {
    if (
        !state.pendingBannerToSpecRoutePath ||
        state.bannerToSpecAnimationStartedAt !== null
    ) {
        return;
    }
    const root = document.documentElement;
    const navbar = document.getElementById("navbar");
    if (
        navbar instanceof HTMLElement &&
        !navbar.classList.contains("scrolled")
    ) {
        navbar.classList.add("scrolled");
        state.didForceNavbarScrolledForBannerToSpec = true;
    }
    root.classList.remove(BANNER_TO_SPEC_TRANSITION_PREPARING_CLASS);
    root.classList.add(BANNER_TO_SPEC_TRANSITION_ACTIVE_CLASS);
    root.classList.add(BANNER_TO_SPEC_NAVBAR_SYNC_CLASS);
    state.bannerToSpecAnimationStartedAt = performance.now();
}

export function dispatchRouteChangeWithNavbarCommitFreeze(
    state: TransitionState,
    deps: TransitionIntentDeps,
): boolean {
    const routeScrollTop = state.pendingSpecToBannerFreeze
        ? 0
        : document.documentElement.scrollTop;
    const commitRouteChange = (): void => {
        // spec -> home 期间先冻结为 spec 布局，切换提交时需按顶部状态计算，
        // 避免 navbar 在一帧内出现 scrolled -> unscrolled 的闪烁跳变
        deps.controller.dispatch({
            type: "ROUTE_CHANGED",
            path: window.location.pathname,
            scrollTop: routeScrollTop,
            viewportWidth: window.innerWidth,
            reason: "route-change",
        });
    };
    if (
        !state.pendingBannerToSpecRoutePath ||
        state.bannerToSpecAnimationStartedAt === null
    ) {
        commitRouteChange();
        return false;
    }
    const root = document.documentElement;
    const currentNavigationToken = state.navigationToken;
    root.classList.add(BANNER_TO_SPEC_NAVBAR_COMMIT_FREEZE_CLASS);
    commitRouteChange();
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (state.navigationToken !== currentNavigationToken) {
                return;
            }
            root.classList.remove(BANNER_TO_SPEC_NAVBAR_COMMIT_FREEZE_CLASS);
        });
    });
    return true;
}

export function applyVtDurationFromElapsed(
    state: TransitionState,
    newDocument: Document,
): void {
    if (
        !state.pendingBannerToSpecRoutePath ||
        state.bannerToSpecAnimationStartedAt === null
    ) {
        return;
    }
    const elapsed = performance.now() - state.bannerToSpecAnimationStartedAt;
    const remaining = Math.max(
        50,
        BANNER_TO_SPEC_TRANSITION_DURATION_MS - elapsed,
    );
    const durationValue = `${Math.ceil(remaining)}ms`;
    document.documentElement.style.setProperty(
        BANNER_TO_SPEC_VT_DURATION_VAR,
        durationValue,
    );
    newDocument.documentElement.style.setProperty(
        BANNER_TO_SPEC_VT_DURATION_VAR,
        durationValue,
    );
}
