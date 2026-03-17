export type SidebarProfilePatch = {
    uid: string;
    displayName: string;
    bio: string;
    profileLink: string;
    avatarUrl: string;
    socialHtml: string;
};

const PROFILE_UPDATE_TIMEOUT_MS = 420;

function clean(value: string | null | undefined): string {
    return String(value || "").trim();
}

function readProfileRoot(scope: ParentNode | null): HTMLElement | null {
    if (!scope) {
        return null;
    }
    const root = scope.querySelector<HTMLElement>(
        "[data-sidebar-profile-root]",
    );
    return root instanceof HTMLElement ? root : null;
}

function readAllProfileRoots(scope: ParentNode | null): HTMLElement[] {
    if (!scope) {
        return [];
    }
    return Array.from(
        scope.querySelectorAll<HTMLElement>("[data-sidebar-profile-root]"),
    );
}

function setAvatarShellLoading(shell: HTMLElement, isLoading: boolean): void {
    shell.dataset.avatarLoading = isLoading ? "true" : "false";
}

function isImageSettled(img: HTMLImageElement): boolean {
    return (
        img.complete &&
        Number.isFinite(img.naturalWidth) &&
        img.naturalWidth > 0
    );
}

function resolveAvatarImage(
    root: HTMLElement,
): { shell: HTMLElement; img: HTMLImageElement } | null {
    const shell = root.querySelector<HTMLElement>(
        "[data-sidebar-avatar-shell]",
    );
    if (!(shell instanceof HTMLElement)) {
        return null;
    }

    const img = shell.querySelector<HTMLImageElement>(
        "[data-sidebar-profile-avatar] img",
    );
    if (!(img instanceof HTMLImageElement)) {
        setAvatarShellLoading(shell, false);
        return null;
    }

    return { shell, img };
}

function observeAvatarImageLoad(
    shell: HTMLElement,
    img: HTMLImageElement,
): void {
    const observedSrc = clean(img.currentSrc || img.getAttribute("src"));
    const cachedObservedSrc = clean(shell.dataset.avatarObservedSrc);
    const listenerAttached = shell.dataset.avatarListenerAttached === "true";

    if (observedSrc && observedSrc === cachedObservedSrc && listenerAttached) {
        return;
    }

    shell.dataset.avatarObservedSrc = observedSrc;
    shell.dataset.avatarListenerAttached = "true";
    setAvatarShellLoading(shell, true);

    const settle = (): void => {
        setAvatarShellLoading(shell, false);
        delete shell.dataset.avatarListenerAttached;
    };

    img.addEventListener("load", settle, { once: true });
    img.addEventListener("error", settle, { once: true });
}

export function syncSidebarAvatarLoadingState(scope: ParentNode | null): void {
    const roots = readAllProfileRoots(scope);
    if (roots.length === 0) {
        return;
    }

    roots.forEach((root) => {
        const avatar = resolveAvatarImage(root);
        if (!avatar) {
            return;
        }

        const { shell, img } = avatar;
        const avatarSrc = clean(img.currentSrc || img.getAttribute("src"));
        if (!avatarSrc) {
            setAvatarShellLoading(shell, false);
            return;
        }

        if (isImageSettled(img)) {
            setAvatarShellLoading(shell, false);
            return;
        }

        observeAvatarImageLoad(shell, img);
    });
}

export function extractSidebarProfilePatch(
    scope: ParentNode | null,
): SidebarProfilePatch | null {
    const root = readProfileRoot(scope);
    if (!root) {
        return null;
    }

    const link = root.querySelector<HTMLAnchorElement>(
        "[data-sidebar-profile-link]",
    );
    const name = root.querySelector<HTMLElement>("[data-sidebar-profile-name]");
    const bio = root.querySelector<HTMLElement>("[data-sidebar-profile-bio]");
    const avatar = root.querySelector<HTMLImageElement>(
        "[data-sidebar-profile-avatar] img",
    );
    const social = root.querySelector<HTMLElement>(
        "[data-sidebar-profile-social]",
    );

    const displayName =
        clean(root.dataset.sidebarProfileName) ||
        clean(name?.textContent) ||
        "user";
    const uid = clean(root.dataset.sidebarProfileUid) || "__official__";
    const profileLink =
        clean(root.dataset.sidebarProfileLink) ||
        clean(link?.getAttribute("href")) ||
        "/about";
    const avatarUrl =
        clean(root.dataset.sidebarProfileAvatar) ||
        clean(avatar?.getAttribute("src"));
    const bioText =
        clean(root.dataset.sidebarProfileBio) || clean(bio?.textContent);

    return {
        uid,
        displayName,
        bio: bioText,
        profileLink,
        avatarUrl,
        socialHtml: social?.innerHTML || "",
    };
}

export function applySidebarProfilePatch(patch: SidebarProfilePatch): void {
    const sidebar = document.getElementById("sidebar");
    if (!(sidebar instanceof HTMLElement)) {
        return;
    }

    const roots = readAllProfileRoots(sidebar);
    if (roots.length === 0) {
        return;
    }

    const avatars: HTMLImageElement[] = [];

    roots.forEach((root) => {
        const link = root.querySelector<HTMLAnchorElement>(
            "[data-sidebar-profile-link]",
        );
        const name = root.querySelector<HTMLElement>(
            "[data-sidebar-profile-name]",
        );
        const bio = root.querySelector<HTMLElement>(
            "[data-sidebar-profile-bio]",
        );
        const avatar = root.querySelector<HTMLImageElement>(
            "[data-sidebar-profile-avatar] img",
        );
        const social = root.querySelector<HTMLElement>(
            "[data-sidebar-profile-social]",
        );

        if (link) {
            link.setAttribute("href", patch.profileLink || "/about");
        }
        if (name) {
            name.textContent = patch.displayName || "user";
        }
        if (bio) {
            bio.textContent = patch.bio;
        }
        if (social && social.innerHTML !== patch.socialHtml) {
            social.innerHTML = patch.socialHtml;
        }
        if (avatar) {
            avatars.push(avatar);
        }

        root.dataset.sidebarProfileUid = patch.uid || "__official__";
        root.dataset.sidebarProfileName = patch.displayName || "user";
        root.dataset.sidebarProfileBio = patch.bio;
        root.dataset.sidebarProfileAvatar = patch.avatarUrl;
        root.dataset.sidebarProfileLink = patch.profileLink || "/about";
    });

    sidebar.dataset.sidebarUid = patch.uid || "__official__";
    syncSidebarAvatarLoadingState(sidebar);

    const nextAvatarUrl = clean(patch.avatarUrl);
    const currentAvatarUrl = clean(avatars[0]?.getAttribute("src"));
    if (
        avatars.length === 0 ||
        !nextAvatarUrl ||
        nextAvatarUrl === currentAvatarUrl
    ) {
        syncSidebarAvatarLoadingState(sidebar);
        return;
    }

    let finished = false;
    const finish = (): void => {
        if (finished) {
            return;
        }
        finished = true;
        avatars.forEach((avatar) => {
            avatar.setAttribute("src", nextAvatarUrl);
            avatar.removeAttribute("srcset");
        });
        syncSidebarAvatarLoadingState(sidebar);
    };

    const preloader = new Image();
    preloader.addEventListener("load", finish, { once: true });
    preloader.addEventListener("error", finish, { once: true });
    preloader.src = nextAvatarUrl;
    window.setTimeout(finish, PROFILE_UPDATE_TIMEOUT_MS);
}
