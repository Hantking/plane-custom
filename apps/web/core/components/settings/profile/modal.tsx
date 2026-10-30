/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback } from "react";
import { X } from "lucide-react";
import { observer } from "mobx-react";
import { PROFILE_SETTINGS, PROFILE_SETTINGS_TABS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
// plane imports
import { IconButton } from "@plane/propel/icon-button";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
// hooks
import { useCommandPalette } from "@/hooks/store/use-command-palette";
// local imports
import { ProfileSettingsContent } from "./content";
import { ProfileSettingsSidebarRoot } from "./sidebar";

export const ProfileSettingsModal = observer(function ProfileSettingsModal() {
  // store hooks
  const { profileSettingsModal, toggleProfileSettingsModal } = useCommandPalette();
  // derived values
  const activeTab = profileSettingsModal.activeTab ?? "general";
  const { t } = useTranslation();

  const handleClose = useCallback(() => {
    toggleProfileSettingsModal({
      isOpen: false,
    });
    setTimeout(() => {
      toggleProfileSettingsModal({
        activeTab: null,
      });
    }, 300);
  }, [toggleProfileSettingsModal]);

  return (
    <ModalCore
      isOpen={profileSettingsModal.isOpen}
      handleClose={handleClose}
      position={EModalPosition.CENTER}
      width={EModalWidth.VIXL}
      className="h-[calc(100dvh-24px)] md:h-175"
    >
      <div className="@container relative size-full">
        <div className="flex size-full min-h-0 flex-col md:flex-row">
          <div className="shrink-0 border-b border-subtle p-4 pr-16 md:hidden">
            <label className="sr-only" htmlFor="mobile-profile-settings">
              {t("settings")}
            </label>
            <select
              id="mobile-profile-settings"
              value={activeTab}
              className="min-h-11 w-full rounded-lg border border-subtle bg-surface-1 px-3 text-primary"
              onChange={(event) => {
                const tab = PROFILE_SETTINGS_TABS.find((value) => value === event.target.value);
                if (tab) toggleProfileSettingsModal({ activeTab: tab });
              }}
            >
              {PROFILE_SETTINGS_TABS.map((tab) => (
                <option key={tab} value={tab}>
                  {t(PROFILE_SETTINGS[tab].i18n_label)}
                </option>
              ))}
            </select>
          </div>
          <ProfileSettingsSidebarRoot
            activeTab={activeTab}
            className="hidden w-[250px] rounded-l-xl md:block"
            updateActiveTab={(tab) => toggleProfileSettingsModal({ activeTab: tab })}
          />
          <div className="min-h-0 min-w-0 flex-1" data-mobile-profile-content>
            <ProfileSettingsContent activeTab={activeTab} className="h-full min-w-0 rounded-r-xl" />
          </div>
        </div>
        <div className="absolute top-3.5 right-3.5">
          <IconButton size="base" variant="tertiary" icon={X} onClick={handleClose} />
        </div>
      </div>
    </ModalCore>
  );
});
