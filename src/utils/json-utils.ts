import type { JsonObject, JsonValue } from "@/types/json";

export function isJsonObject(value: JsonValue): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getJsonString(
    object: JsonObject,
    key: string,
): string | undefined {
    const value = object[key];
    return typeof value === "string" ? value : undefined;
}

export function getJsonNumber(
    object: JsonObject,
    key: string,
): number | undefined {
    const value = object[key];
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return undefined;
}
