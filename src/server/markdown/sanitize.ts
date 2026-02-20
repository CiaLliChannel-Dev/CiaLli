import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = sanitizeHtml.defaults.allowedTags.concat([
    "img",
    "figure",
    "figcaption",
    "iframe",
    "section",
    "details",
    "summary",
    "del",
    "spoiler",
    "kbd",
    "sup",
    "sub",
]);

const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions["allowedAttributes"] = {
    ...sanitizeHtml.defaults.allowedAttributes,
    "*": [
        "class",
        "id",
        "style",
        "title",
        "aria-label",
        "aria-hidden",
        "data-*",
    ],
    th: ["align"],
    td: ["align"],
    a: [
        ...(sanitizeHtml.defaults.allowedAttributes?.a || []),
        "target",
        "rel",
        "repo",
        "data-*",
    ],
    img: [
        "src",
        "srcset",
        "alt",
        "title",
        "width",
        "height",
        "loading",
        "decoding",
        "style",
    ],
    iframe: [
        "src",
        "title",
        "width",
        "height",
        "frameborder",
        "allow",
        "allowfullscreen",
        "scrolling",
    ],
};

const ALLOWED_SCHEMES_BY_TAG: sanitizeHtml.IOptions["allowedSchemesByTag"] = {
    img: ["http", "https", "data", "blob"],
    iframe: ["http", "https"],
};

export function sanitizeMarkdownHtml(html: string): string {
    return sanitizeHtml(String(html || ""), {
        allowedTags: ALLOWED_TAGS,
        allowedAttributes: ALLOWED_ATTRIBUTES,
        allowedSchemes: ["http", "https", "mailto", "tel", "data"],
        allowedSchemesByTag: ALLOWED_SCHEMES_BY_TAG,
        allowProtocolRelative: true,
        transformTags: {
            a: (tagName, attribs) => {
                const output = { ...attribs };
                if (output.target === "_blank") {
                    const rel = String(output.rel || "").trim();
                    output.rel = rel
                        ? `${rel} noopener noreferrer`.trim()
                        : "noopener noreferrer";
                }
                return { tagName, attribs: output };
            },
        },
        nonTextTags: ["script", "style", "textarea", "option"],
    });
}
