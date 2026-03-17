import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import { LinkPreset, type NavBarLink } from "@/types/config";

export const LinkPresets: { [key in LinkPreset]: NavBarLink } = {
    [LinkPreset.Home]: {
        name: i18n(I18nKey.home),
        url: "/",
        icon: "material-symbols:home",
    },
    [LinkPreset.About]: {
        name: i18n(I18nKey.about),
        url: "/about",
        icon: "material-symbols:person",
    },
    [LinkPreset.Archive]: {
        name: i18n(I18nKey.archive),
        url: "/posts",
        icon: "material-symbols:archive",
    },
    [LinkPreset.Friends]: {
        name: i18n(I18nKey.friends),
        url: "/friends",
        icon: "material-symbols:group",
    },
    [LinkPreset.Anime]: {
        name: i18n(I18nKey.anime),
        url: "/me/#bangumi",
        icon: "material-symbols:movie",
    },
    [LinkPreset.Diary]: {
        name: i18n(I18nKey.diary),
        url: "/me/#diary",
        icon: "material-symbols:book",
    },
    [LinkPreset.Albums]: {
        name: i18n(I18nKey.albums),
        url: "/me/#albums",
        icon: "material-symbols:photo-library",
    },
};
