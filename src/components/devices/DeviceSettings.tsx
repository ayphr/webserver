import { IconCheck, IconTrash } from '@tabler/icons-react';
import type { DeviceSummary, Location } from '@common';
import { Button, Input } from '../common';
import { ConfirmDialog } from '../common';
import './DevicesPanel.css';

type Props = {
  device: DeviceSummary;
  locations: Location[];
  settingsName: string;
  onSettingsNameChange: (v: string) => void;
  settingsLocationId: string;
  onSettingsLocationIdChange: (v: string) => void;
  isSavingSettings: boolean;
  saveSuccess: boolean;
  onSave: () => void;
  isUnlinkOpen: boolean;
  onUnlinkOpenChange: (v: boolean) => void;
  isUnlinking: boolean;
  onUnlink: () => void;
};

export function DeviceSettings({
  device,
  locations,
  settingsName,
  onSettingsNameChange,
  settingsLocationId,
  onSettingsLocationIdChange,
  isSavingSettings,
  saveSuccess,
  onSave,
  isUnlinkOpen,
  onUnlinkOpenChange,
  isUnlinking,
  onUnlink,
}: Props) {
  return (
    <div className="devices__settings">
      <div className="devices__settings-section">
        <h4 className="devices__settings-title">Device Details</h4>
        <p className="devices__settings-desc">
          Rename your device or reassign it to a different location.
        </p>

        <label className="devices__field">
          <span className="devices__field-label">Device Name</span>
          <Input
            value={settingsName}
            onChange={(e) => onSettingsNameChange(e.target.value)}
            placeholder={`Device ${device.serial}`}
          />
        </label>

        {locations.length > 0 && (
          <label className="devices__field">
            <span className="devices__field-label">Assigned Location</span>
            <select
              className="devices__select"
              value={settingsLocationId}
              onChange={(e) => onSettingsLocationIdChange(e.target.value)}
            >
              <option value="">No location (Default)</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name} {loc.isDefault ? '(Default)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="devices__settings-save-row">
          <Button variant="primary" onClick={() => void onSave()} isLoading={isSavingSettings}>
            Save Changes
          </Button>
          {saveSuccess && (
            <span className="devices__save-success">
              <IconCheck size={16} strokeWidth={2} />
              Saved successfully
            </span>
          )}
        </div>
      </div>

      <div className="devices__danger-zone">
        <h4 className="devices__danger-title">Danger Zone</h4>
        <p className="devices__danger-desc">
          Unlinking removes this device from your account. The device will stop sending
          telemetry to your dashboard until it is re-linked with a new pairing code.
        </p>

        <Button variant="danger" onClick={() => onUnlinkOpenChange(true)}>
          <IconTrash size={16} strokeWidth={1.75} />
          Unlink device
        </Button>
      </div>

      <ConfirmDialog
        isOpen={isUnlinkOpen}
        title="Unlink Device"
        confirmText={isUnlinking ? 'Unlinking...' : 'Unlink Device'}
        cancelText="Cancel"
        isDangerous
        confirmDisabled={isUnlinking}
        onConfirm={() => void onUnlink()}
        onCancel={() => onUnlinkOpenChange(false)}
      >
        <p>
          Are you sure you want to unlink &quot;{device.name?.trim() || `Device ${device.serial}`}&quot; (serial #{device.serial})?
          All telemetry data recorded for this device will be cleared from your account.
        </p>
      </ConfirmDialog>
    </div>
  );
}

export default DeviceSettings;