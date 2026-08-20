export class AudioInputSelector {
  constructor(select, storageKey) {
    this.select = select;
    this.storageKey = storageKey;
    this.select.addEventListener('change', () => this.persistSelection());
  }

  get selectedDeviceId() {
    return this.select.value;
  }

  async refresh() {
    const previousValue = this.select.value || localStorage.getItem(this.storageKey) || '';
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((device) => device.kind === 'audioinput');

    this.select.replaceChildren(new Option('Выберите микрофон', ''));
    inputs.forEach((device, index) => {
      this.select.add(new Option(device.label || `Микрофон ${index + 1}`, device.deviceId));
    });
    this.select.value = [...this.select.options].some((option) => option.value === previousValue)
      ? previousValue
      : '';
  }

  async requestPermissionAndRefresh() {
    const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    permissionStream.getTracks().forEach((track) => track.stop());
    await this.refresh();
  }

  persistSelection() {
    if (this.select.value) localStorage.setItem(this.storageKey, this.select.value);
    else localStorage.removeItem(this.storageKey);
  }
}
