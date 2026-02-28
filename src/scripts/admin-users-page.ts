import I18nKey from "@/i18n/i18nKey";
import { t, tFmt } from "@/scripts/i18n-runtime";
import { showConfirmDialog } from "@/scripts/dialogs";
import { showOverlayDialog } from "@/scripts/overlay-dialog";
import { runWithTask } from "@/scripts/progress-overlay-manager";
import { getApiErrorMessage, requestApi as api } from "@/scripts/http-client";

const getUsersTableBody = (): HTMLTableSectionElement | null =>
    document.getElementById(
        "admin-users-table",
    ) as HTMLTableSectionElement | null;
const getRegisterEnabledInput = (): HTMLInputElement | null =>
    document.getElementById(
        "admin-register-enabled",
    ) as HTMLInputElement | null;
const getRegisterMessage = (): HTMLElement | null =>
    document.getElementById("admin-register-msg");
const getRegistrationTableBody = (): HTMLTableSectionElement | null =>
    document.getElementById(
        "admin-registration-table",
    ) as HTMLTableSectionElement | null;
const getRegistrationMessage = (): HTMLElement | null =>
    document.getElementById("admin-registration-msg");
const getRegistrationStatusSelect = (): HTMLSelectElement | null =>
    document.getElementById(
        "admin-registration-status",
    ) as HTMLSelectElement | null;

const setRegistrationMessage = (message: string) => {
    const registrationMessage = getRegistrationMessage();
    if (!registrationMessage) {
        return;
    }
    registrationMessage.textContent = String(message || "");
};

const setRegisterMessage = (message: string) => {
    const registerMessage = getRegisterMessage();
    if (!registerMessage) {
        return;
    }
    registerMessage.textContent = String(message || "");
};

type UnknownRecord = Record<string, unknown>;

const resolveErrorMessage = (data: UnknownRecord | null, fallback: string) => {
    const error = data?.error as UnknownRecord | undefined;
    const code = String(error?.code || "");
    if (code === "REGISTER_DISABLED") {
        return t(I18nKey.adminUsersRegisterDisabled);
    }
    if (code === "EMAIL_EXISTS") {
        return t(I18nKey.adminUsersEmailExists);
    }
    if (code === "USERNAME_EXISTS") {
        return t(I18nKey.adminUsersUsernameExists);
    }
    if (code === "REGISTRATION_REQUEST_EXISTS") {
        return t(I18nKey.adminUsersRegistrationExists);
    }
    if (code === "REGISTRATION_STATUS_CONFLICT") {
        return t(I18nKey.adminUsersRegistrationStatusConflict);
    }
    return getApiErrorMessage(data, fallback || t(I18nKey.commonRequestFailed));
};

let registrationRequestMap = new Map<string, UnknownRecord>();

const renderUsersRows = (rows: UnknownRecord[]) => {
    const usersTableBody = getUsersTableBody();
    if (!usersTableBody) return;
    if (!Array.isArray(rows) || rows.length === 0) {
        usersTableBody.innerHTML = `<tr><td colspan="4" class="py-4 text-60">${t(I18nKey.adminUsersNoUserData)}</td></tr>`;
        return;
    }
    usersTableBody.innerHTML = rows
        .map((entry) => {
            const userRecord =
                typeof entry.user === "object" && entry.user
                    ? (entry.user as UnknownRecord)
                    : {};
            const profileRecord =
                typeof entry.profile === "object" && entry.profile
                    ? (entry.profile as UnknownRecord)
                    : {};
            const permissionsRecord =
                typeof entry.permissions === "object" && entry.permissions
                    ? (entry.permissions as UnknownRecord)
                    : {};

            const userId = String(userRecord.id || "");
            const userEmail = String(userRecord.email || "");
            const username = String(profileRecord.username || "");
            const appRole = String(permissionsRecord.app_role || "member");
            return `
					<tr class="border-b border-(--line-divider) text-75">
						<td class="py-2 pr-2">${userEmail}</td>
						<td class="py-2 pr-2">${username}</td>
						<td class="py-2 pr-2">
							<select data-user-id="${userId}" data-field="app_role" class="rounded border border-(--line-divider) px-2 py-1 bg-black/5 dark:bg-white/5 text-75">
								<option value="member" ${appRole === "member" ? "selected" : ""}>member</option>
								<option value="admin" ${appRole === "admin" ? "selected" : ""}>admin</option>
							</select>
						</td>
						<td class="py-2 pr-2">
							<div class="flex items-center gap-2">
								<button class="text-xs text-(--primary) hover:underline" data-action="save" data-user-id="${userId}">${t(I18nKey.commonSave)}</button>
								<button class="text-xs text-red-500 hover:underline" data-action="delete" data-user-id="${userId}" data-username="${username}">${t(I18nKey.adminUsersDeleteAccount)}</button>
							</div>
						</td>
					</tr>
				`;
        })
        .join("");
};

const renderRegistrationRows = (rows: UnknownRecord[]) => {
    const registrationTableBody = getRegistrationTableBody();
    if (!registrationTableBody) {
        return;
    }
    if (!Array.isArray(rows) || rows.length === 0) {
        registrationTableBody.innerHTML = `<tr><td colspan="2" class="py-4 text-60">${t(I18nKey.adminUsersNoRegistrationData)}</td></tr>`;
        registrationRequestMap = new Map<string, UnknownRecord>();
        return;
    }
    registrationRequestMap = new Map<string, UnknownRecord>();
    registrationTableBody.innerHTML = rows
        .map((item) => {
            const id = String(item.id || "").trim();
            if (id) {
                registrationRequestMap.set(id, item);
            }
            const avatarFile = String(item.avatar_file || "").trim();
            const avatarHtml = avatarFile
                ? `<img src="/api/v1/public/assets/${encodeURIComponent(avatarFile)}?width=72&height=72&fit=cover" class="w-10 h-10 rounded-full object-cover border border-(--line-divider)" alt="avatar" loading="lazy" />`
                : `<span class="inline-flex w-10 h-10 rounded-full items-center justify-center text-xs text-50 border border-(--line-divider)">${t(I18nKey.adminUsersNone)}</span>`;
            const username =
                String(item.username || "").trim() ||
                t(I18nKey.adminUsersUnnamedUser);
            const rowAttrs = id
                ? `data-registration-action="detail" data-registration-id="${id}"`
                : "";
            return `
					<tr class="border-b border-(--line-divider) text-75 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors" ${rowAttrs}>
						<td class="py-2 pr-2">${avatarHtml}</td>
						<td class="py-2 pr-2">
							<div class="flex items-center justify-between gap-3">
								<span>${username}</span>
								<span class="text-xs text-(--primary)">${t(I18nKey.adminUsersViewDetail)}</span>
							</div>
						</td>
					</tr>
				`;
        })
        .join("");
};

const loadUsers = async () => {
    const { response, data } = await api("/api/v1/admin/users?limit=200");
    if (!response.ok || !data?.ok) {
        renderUsersRows([]);
        return;
    }
    renderUsersRows((data.items as UnknownRecord[]) || []);
};

const loadRegisterSwitch = async () => {
    const registerEnabledInput = getRegisterEnabledInput();
    const { response, data } = await api("/api/v1/admin/settings/site");
    if (!response.ok || !data?.ok) {
        setRegisterMessage(
            resolveErrorMessage(data, t(I18nKey.adminUsersLoadSwitchFailed)),
        );
        return;
    }
    const settings = data?.settings as UnknownRecord | undefined;
    const auth = settings?.auth as UnknownRecord | undefined;
    const enabled = Boolean(auth?.register_enabled);
    if (registerEnabledInput) {
        registerEnabledInput.checked = enabled;
    }
    setRegisterMessage("");
};

const loadRegistrationRequests = async () => {
    const registrationStatusSelect = getRegistrationStatusSelect();
    const status =
        String(registrationStatusSelect?.value || "").trim() || "pending";
    const params =
        status && status !== "all"
            ? `?status=${encodeURIComponent(status)}&limit=200`
            : "?limit=200";
    const { response, data } = await api(
        `/api/v1/admin/registration-requests${params}`,
    );
    if (!response.ok || !data?.ok) {
        renderRegistrationRows([]);
        setRegistrationMessage(
            resolveErrorMessage(
                data,
                t(I18nKey.adminUsersLoadRegistrationsFailed),
            ),
        );
        return;
    }
    setRegistrationMessage("");
    renderRegistrationRows((data.items as UnknownRecord[]) || []);
};

const showRegistrationDetailDialog = async (
    requestId: string,
): Promise<void> => {
    const item = registrationRequestMap.get(requestId);
    if (!item) {
        setRegistrationMessage(t(I18nKey.adminUsersRegistrationNotFound));
        return;
    }

    const status = String(item.request_status || "").trim();
    const canReview = status === "pending";
    const username =
        String(item.username || "").trim() || t(I18nKey.adminUsersUnnamedUser);
    const displayName = String(item.display_name || "").trim();
    const reviewedBy = String(item.reviewed_by || "").trim();
    const reviewedAt = String(item.reviewed_at || "").trim();
    const rejectReason = String(item.reject_reason || "").trim();
    const reason = String(item.registration_reason || "").trim();
    const content = [
        {
            label: t(I18nKey.meSettingsUsernameLabel),
            value: username,
            tone: "primary" as const,
        },
        {
            label: t(I18nKey.authEmailLabel),
            value: String(item.email || "").trim() || t(I18nKey.adminUsersNone),
        },
        {
            label: t(I18nKey.meSettingsDisplayNameLabel),
            value: displayName || t(I18nKey.adminUsersNone),
        },
        {
            label: t(I18nKey.adminUsersRegistrationStatus),
            value: status || "unknown",
        },
        {
            label: t(I18nKey.adminUsersRejectReason),
            value: rejectReason || t(I18nKey.adminUsersNone),
        },
        {
            label: t(I18nKey.adminUsersReviewedBy),
            value: reviewedBy || t(I18nKey.adminUsersNone),
        },
        {
            label: t(I18nKey.adminUsersReviewedAt),
            value: reviewedAt || t(I18nKey.adminUsersNone),
        },
        {
            label: t(I18nKey.adminUsersSubmittedAt),
            value:
                String(item.date_created || "").trim() ||
                t(I18nKey.adminUsersNone),
        },
        {
            label: t(I18nKey.adminUsersRegistrationReason),
            value: reason || t(I18nKey.adminUsersNone),
            fullWidth: true,
        },
    ];

    const result = await showOverlayDialog({
        ariaLabel: t(I18nKey.adminUsersRegistrationDetail),
        message: t(I18nKey.adminUsersRegistrationDetail),
        dismissKey: "close",
        content,
        contentColumns: 2,
        fields: canReview
            ? [
                  {
                      name: "reason",
                      label: t(I18nKey.adminUsersRejectReasonOptional),
                      kind: "textarea",
                      required: false,
                      placeholder: t(I18nKey.adminUsersRejectReasonPlaceholder),
                      rows: 3,
                  },
              ]
            : [],
        actions: canReview
            ? [
                  {
                      key: "approve",
                      label: t(I18nKey.adminUsersApprove),
                      variant: "primary",
                  },
                  {
                      key: "reject",
                      label: t(I18nKey.adminUsersReject),
                      variant: "danger",
                  },
                  {
                      key: "close",
                      label: t(I18nKey.commonClose),
                      variant: "secondary",
                  },
              ]
            : [
                  {
                      key: "close",
                      label: t(I18nKey.commonClose),
                      variant: "secondary",
                  },
              ],
    });

    if (!canReview || result.actionKey === "close") {
        return;
    }

    const action = result.actionKey === "approve" ? "approve" : "reject";
    const payload: {
        action: "approve" | "reject";
        reason?: string;
    } = {
        action,
    };
    if (action !== "approve") {
        payload.reason = String(result.values.reason || "").trim();
    }

    setRegistrationMessage(t(I18nKey.commonProcessing));
    await runWithTask(
        {
            title: t(I18nKey.adminUsersProcessingRegistrationTitle),
            mode: "indeterminate",
            text: t(I18nKey.commonProcessing),
        },
        async ({ update }) => {
            const { response, data } = await api(
                `/api/v1/admin/registration-requests/${encodeURIComponent(requestId)}`,
                {
                    method: "PATCH",
                    body: JSON.stringify(payload),
                },
            );
            if (!response.ok || !data?.ok) {
                setRegistrationMessage(
                    resolveErrorMessage(data, t(I18nKey.commonActionFailed)),
                );
                return;
            }
            update({ text: t(I18nKey.commonActionSucceededReloading) });
            setRegistrationMessage(t(I18nKey.commonActionSucceeded));
            await loadRegistrationRequests();
            if (action === "approve") {
                await loadUsers();
            }
        },
    );
};

let pageEventsController: AbortController | null = null;

const bindEvents = () => {
    pageEventsController?.abort();
    pageEventsController = new AbortController();
    const { signal } = pageEventsController;

    document
        .getElementById("admin-users-refresh")
        ?.addEventListener("click", () => void loadUsers(), { signal });

    document
        .getElementById("admin-registration-refresh")
        ?.addEventListener("click", () => void loadRegistrationRequests(), {
            signal,
        });

    const registrationStatusSelect = getRegistrationStatusSelect();
    registrationStatusSelect?.addEventListener(
        "change",
        () => {
            void loadRegistrationRequests();
        },
        { signal },
    );

    const registerEnabledInput = getRegisterEnabledInput();
    registerEnabledInput?.addEventListener(
        "change",
        async () => {
            const currentRegisterEnabledInput = getRegisterEnabledInput();
            if (!currentRegisterEnabledInput) {
                return;
            }
            const previousChecked = !currentRegisterEnabledInput.checked;
            currentRegisterEnabledInput.disabled = true;
            setRegisterMessage(t(I18nKey.commonSaving));
            try {
                await runWithTask(
                    {
                        title: t(I18nKey.adminUsersSavingRegisterSwitchTitle),
                        mode: "indeterminate",
                        text: t(I18nKey.commonSaving),
                    },
                    async ({ update }) => {
                        const { response, data } = await api(
                            "/api/v1/admin/settings/site",
                            {
                                method: "PATCH",
                                body: JSON.stringify({
                                    auth: {
                                        register_enabled: Boolean(
                                            currentRegisterEnabledInput.checked,
                                        ),
                                    },
                                }),
                            },
                        );
                        if (!response.ok || !data?.ok) {
                            currentRegisterEnabledInput.checked =
                                previousChecked;
                            setRegisterMessage(
                                resolveErrorMessage(
                                    data,
                                    t(I18nKey.commonSaveFailed),
                                ),
                            );
                            return;
                        }
                        update({ text: t(I18nKey.commonSaveCompleted) });
                        setRegisterMessage(t(I18nKey.commonSaveSuccess));
                    },
                );
            } catch (error) {
                console.error(
                    "[admin-users] save register switch failed:",
                    error,
                );
                currentRegisterEnabledInput.checked = previousChecked;
                setRegisterMessage(t(I18nKey.commonSaveFailedRetry));
            } finally {
                currentRegisterEnabledInput.disabled = false;
            }
        },
        { signal },
    );

    const usersTableBody = getUsersTableBody();
    usersTableBody?.addEventListener(
        "click",
        async (event) => {
            const target =
                event.target instanceof HTMLElement ? event.target : null;
            if (!target) return;
            const action = target.getAttribute("data-action");
            const userId = target.getAttribute("data-user-id");
            if (!action || !userId) return;

            if (action === "save") {
                const row = target.closest("tr");
                if (!row) return;
                const appRole = (
                    row.querySelector(
                        `select[data-user-id="${userId}"][data-field="app_role"]`,
                    ) as HTMLSelectElement | null
                )?.value;
                await runWithTask(
                    {
                        title: t(I18nKey.adminUsersSavingRoleTitle),
                        mode: "indeterminate",
                        text: t(I18nKey.commonSaving),
                    },
                    async () => {
                        const { response, data } = await api(
                            `/api/v1/admin/users/${userId}`,
                            {
                                method: "PATCH",
                                body: JSON.stringify({
                                    app_role: appRole,
                                }),
                            },
                        );
                        if (!response.ok || !data?.ok) {
                            window.alert(
                                resolveErrorMessage(
                                    data,
                                    t(I18nKey.commonSaveFailed),
                                ),
                            );
                            return;
                        }
                        await loadUsers();
                    },
                );
                return;
            }

            if (action === "delete") {
                const username = String(
                    target.getAttribute("data-username") || "",
                ).trim();
                const expectedText = tFmt(
                    I18nKey.adminUsersDeleteExpectedText,
                    {
                        name: username || userId,
                    },
                );
                const confirmDelete = await showConfirmDialog({
                    message: t(I18nKey.adminUsersDeleteConfirmMessage),
                    confirmText: t(I18nKey.adminUsersDeleteConfirmButton),
                    confirmVariant: "danger",
                    manualConfirm: {
                        expectedText,
                        placeholder: expectedText,
                        mismatchMessage: t(I18nKey.dialogManualConfirmMismatch),
                    },
                });
                if (!confirmDelete) {
                    return;
                }

                const { response, data } = await api(
                    `/api/v1/admin/users/${userId}`,
                    {
                        method: "DELETE",
                    },
                );
                if (!response.ok || !data?.ok) {
                    window.alert(
                        resolveErrorMessage(
                            data,
                            t(I18nKey.commonDeleteFailed),
                        ),
                    );
                    return;
                }
                window.alert(t(I18nKey.adminUsersDeleted));
                await loadUsers();
            }
        },
        { signal },
    );

    const registrationTableBody = getRegistrationTableBody();
    registrationTableBody?.addEventListener(
        "click",
        async (event) => {
            const target =
                event.target instanceof HTMLElement ? event.target : null;
            if (!target) {
                return;
            }
            const actionTarget = target.closest<HTMLElement>(
                "[data-registration-action]",
            );
            if (!actionTarget) {
                return;
            }
            const action = String(
                actionTarget.getAttribute("data-registration-action") || "",
            );
            const requestId = String(
                actionTarget.getAttribute("data-registration-id") || "",
            ).trim();
            if (action !== "detail" || !requestId) {
                return;
            }
            await showRegistrationDetailDialog(requestId);
        },
        { signal },
    );
};

export const initAdminUsersPage = (): void => {
    if (!getUsersTableBody() || !getRegistrationTableBody()) {
        pageEventsController?.abort();
        return;
    }
    bindEvents();
    void Promise.all([
        loadUsers(),
        loadRegistrationRequests(),
        loadRegisterSwitch(),
    ]);
};
