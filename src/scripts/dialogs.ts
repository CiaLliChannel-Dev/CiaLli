import { buildLoginUrl } from "@utils/login-url";
import I18nKey from "@i18n/i18nKey";

import {
    showOverlayDialog,
    type OverlayDialogField,
    type OverlayDialogActionVariant,
} from "@/scripts/overlay-dialog";
import { tFmt, t } from "@/scripts/i18n-runtime";

type ConfirmDialogOptions = {
    ariaLabel?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    confirmVariant?: OverlayDialogActionVariant;
    manualConfirm?: {
        expectedText: string;
        label?: string;
        placeholder?: string;
        mismatchMessage?: string;
    };
};

type NoticeDialogOptions = {
    ariaLabel?: string;
    message: string;
    buttonText?: string;
};

type FormDialogFieldType = "text" | "textarea" | "select";

type FormDialogFieldOption = {
    label: string;
    value: string;
};

type FormDialogField = {
    name: string;
    label: string;
    type: FormDialogFieldType;
    required?: boolean;
    placeholder?: string;
    value?: string;
    rows?: number;
    options?: FormDialogFieldOption[];
};

type FormDialogOptions = {
    ariaLabel?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    confirmVariant?: OverlayDialogActionVariant;
    fields: FormDialogField[];
};

function toOverlayField(field: FormDialogField): OverlayDialogField {
    return {
        name: field.name,
        label: field.label,
        kind:
            field.type === "textarea"
                ? "textarea"
                : field.type === "select"
                  ? "select"
                  : "input",
        required: field.required,
        placeholder: field.placeholder,
        value: field.value,
        rows: field.rows,
        options: field.options,
    };
}

export function showAuthRequiredDialog(message?: string): void {
    void showOverlayDialog({
        ariaLabel: t(I18nKey.dialogAuthRequiredTitle),
        message: message || t(I18nKey.dialogAuthRequiredMessage),
        dismissKey: "cancel",
        actions: [
            {
                key: "login",
                label: t(I18nKey.dialogGoLogin),
                variant: "primary",
                kind: "link",
                href: buildLoginUrl(),
            },
            {
                key: "cancel",
                label: t(I18nKey.commonCancel),
                variant: "secondary",
            },
        ],
    });
}

export async function showConfirmDialog(
    options: ConfirmDialogOptions,
): Promise<boolean> {
    const manualConfirm = options.manualConfirm;
    if (!manualConfirm) {
        const result = await showOverlayDialog({
            ariaLabel: options.ariaLabel || t(I18nKey.dialogConfirmTitle),
            message: options.message,
            dismissKey: "cancel",
            actions: [
                {
                    key: "confirm",
                    label: options.confirmText || t(I18nKey.commonConfirm),
                    variant: options.confirmVariant || "primary",
                },
                {
                    key: "cancel",
                    label: options.cancelText || t(I18nKey.commonCancel),
                    variant: "secondary",
                },
            ],
        });
        return result.actionKey === "confirm";
    }

    const expectedText = String(manualConfirm.expectedText || "").trim();
    if (!expectedText) {
        throw new Error("[dialogs] manualConfirm.expectedText cannot be empty");
    }

    const result = await showOverlayDialog({
        ariaLabel: options.ariaLabel || t(I18nKey.dialogConfirmTitle),
        message: options.message,
        dismissKey: "cancel",
        fields: [
            {
                name: "manual_confirm_text",
                label:
                    manualConfirm.label || t(I18nKey.dialogManualConfirmLabel),
                labelHighlightText: manualConfirm.label
                    ? undefined
                    : expectedText,
                labelSuffix: manualConfirm.label
                    ? undefined
                    : t(I18nKey.dialogManualConfirmSuffix),
                kind: "input",
                required: true,
                placeholder: manualConfirm.placeholder || expectedText,
            },
        ],
        actionGuard: (actionKey, values) => {
            if (actionKey !== "confirm") {
                return null;
            }
            const inputText = String(values.manual_confirm_text || "").trim();
            if (inputText === expectedText) {
                return null;
            }
            return {
                message:
                    manualConfirm.mismatchMessage ||
                    tFmt(
                        I18nKey.dialogManualConfirmMismatch,
                        { text: expectedText },
                        `Input does not match. Please type "${expectedText}"`,
                    ),
                invalidFieldNames: ["manual_confirm_text"],
            };
        },
        actions: [
            {
                key: "confirm",
                label: options.confirmText || t(I18nKey.commonConfirm),
                variant: options.confirmVariant || "primary",
            },
            {
                key: "cancel",
                label: options.cancelText || t(I18nKey.commonCancel),
                variant: "secondary",
            },
        ],
    });
    return result.actionKey === "confirm";
}

export async function showNoticeDialog(
    options: NoticeDialogOptions,
): Promise<void> {
    await showOverlayDialog({
        ariaLabel: options.ariaLabel || t(I18nKey.dialogNoticeTitle),
        message: options.message,
        dismissKey: "ok",
        actions: [
            {
                key: "ok",
                label: options.buttonText || t(I18nKey.dialogAcknowledge),
                variant: "secondary",
            },
        ],
    });
}

export async function showFormDialog(
    options: FormDialogOptions,
): Promise<Record<string, string> | null> {
    const result = await showOverlayDialog({
        ariaLabel: options.ariaLabel || t(I18nKey.dialogFormTitle),
        message: options.message,
        dismissKey: "cancel",
        fields: options.fields.map(toOverlayField),
        actions: [
            {
                key: "confirm",
                label: options.confirmText || t(I18nKey.commonConfirm),
                variant: options.confirmVariant || "primary",
            },
            {
                key: "cancel",
                label: options.cancelText || t(I18nKey.commonCancel),
                variant: "secondary",
            },
        ],
    });

    if (result.actionKey !== "confirm") {
        return null;
    }
    return result.values;
}

declare global {
    interface Window {
        showAuthRequiredDialog: typeof showAuthRequiredDialog;
        showConfirmDialog: typeof showConfirmDialog;
        showNoticeDialog: typeof showNoticeDialog;
    }
}

if (typeof window !== "undefined") {
    window.showAuthRequiredDialog = showAuthRequiredDialog;
    window.showConfirmDialog = showConfirmDialog;
    window.showNoticeDialog = showNoticeDialog;
}
