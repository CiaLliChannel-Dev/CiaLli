import {
    applyLayoutState,
    type LayoutDomAdapterDeps,
} from "./layout-dom-adapter";
import {
    areLayoutStatesEqual,
    createInitialLayoutState,
    reduceLayoutState,
    type LayoutIntent,
    type LayoutState,
} from "./layout-state";

export type LayoutControllerDeps = {
    bannerEnabled: boolean;
    defaultWallpaperMode: "banner" | "none";
    navbarTransparentMode: "semi" | "full" | "semifull";
    bannerHeight: number;
    bannerHeightHome: number;
    bannerHeightExtend: number;
    updateBannerCarouselState: () => void;
};

export type LayoutController = {
    dispatch: (intent: LayoutIntent) => LayoutState;
    getState: () => LayoutState;
    destroy: () => void;
};

function createDomDeps(deps: LayoutControllerDeps): LayoutDomAdapterDeps {
    return {
        bannerHeight: deps.bannerHeight,
        bannerHeightHome: deps.bannerHeightHome,
        bannerHeightExtend: deps.bannerHeightExtend,
        updateBannerCarouselState: deps.updateBannerCarouselState,
    };
}

function getInitialScrollTop(): number {
    return document.documentElement.scrollTop;
}

export function initLayoutController(
    deps: LayoutControllerDeps,
): LayoutController {
    let state = createInitialLayoutState({
        path: window.location.pathname,
        bannerEnabled: deps.bannerEnabled,
        defaultWallpaperMode: deps.defaultWallpaperMode,
        navbarTransparentMode: deps.navbarTransparentMode,
        scrollTop: getInitialScrollTop(),
        viewportWidth: window.innerWidth,
    });

    const domDeps = createDomDeps(deps);
    applyLayoutState(null, state, domDeps);

    const reducerConfig = {
        defaultWallpaperMode: deps.defaultWallpaperMode,
        desktopCollapseMinWidth: 1280,
    };

    const dispatch = (intent: LayoutIntent): LayoutState => {
        const next = reduceLayoutState(state, intent, reducerConfig);
        if (!areLayoutStatesEqual(state, next)) {
            const prev = state;
            state = next;
            applyLayoutState(prev, state, domDeps);
        }
        return state;
    };

    const handleLogoClick = (event: Event): void => {
        const eventTarget = event.target;
        if (!(eventTarget instanceof Element)) {
            return;
        }
        const logo = eventTarget.closest<HTMLAnchorElement>("#navbar-logo");
        if (!logo) {
            return;
        }
        if (!(state.isHome && state.mode === "collapsed")) {
            return;
        }
        event.preventDefault();
        dispatch({ type: "LOGO_CLICK" });
    };

    document.addEventListener("click", handleLogoClick);

    return {
        dispatch,
        getState: () => state,
        destroy: () => {
            document.removeEventListener("click", handleLogoClick);
        },
    };
}
