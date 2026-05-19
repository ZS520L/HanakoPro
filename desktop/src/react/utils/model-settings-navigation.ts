import { useSettingsStore } from '../settings/store';
import { openSettingsModal } from '../stores/settings-modal-actions';

export function openProviderModelSettings(providerId?: string | null): void {
  if (providerId) {
    useSettingsStore.setState({ selectedProviderId: providerId });
  }
  openSettingsModal('providers');
}
