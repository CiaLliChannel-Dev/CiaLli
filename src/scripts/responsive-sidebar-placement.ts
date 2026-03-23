function relocateResponsiveSidebar(): void {
    const sidebarNode = document.querySelector<HTMLElement>(
        "[data-responsive-sidebar-node]",
    );
    const desktopAnchor = document.querySelector<HTMLElement>(
        "[data-responsive-sidebar-desktop-anchor]",
    );
    const mobileAnchor = document.querySelector<HTMLElement>(
        "[data-responsive-sidebar-mobile-anchor]",
    );

    if (
        !(sidebarNode instanceof HTMLElement) ||
        !(desktopAnchor instanceof HTMLElement)
    ) {
        return;
    }

    const shouldUseMobileAnchor =
        window.matchMedia("(max-width: 1279px)").matches &&
        mobileAnchor instanceof HTMLElement;
    const target = shouldUseMobileAnchor ? mobileAnchor : desktopAnchor;

    if (sidebarNode.parentElement !== target) {
        target.appendChild(sidebarNode);
    }
}

function bootstrapResponsiveSidebarPlacement(): void {
    if (
        document.documentElement.dataset.responsiveSidebarPlacementBound === "1"
    ) {
        relocateResponsiveSidebar();
        return;
    }

    document.documentElement.dataset.responsiveSidebarPlacementBound = "1";
    const scheduleRelocation = (): void => {
        window.requestAnimationFrame(() => {
            relocateResponsiveSidebar();
        });
    };

    window.addEventListener("resize", scheduleRelocation, { passive: true });
    document.addEventListener("astro:after-swap", scheduleRelocation);

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", scheduleRelocation, {
            once: true,
        });
        return;
    }

    scheduleRelocation();
}

if (typeof window !== "undefined") {
    bootstrapResponsiveSidebarPlacement();
}
