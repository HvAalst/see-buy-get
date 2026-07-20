export const examplePlugin = {
  id: 'shipment-tracker',
  name: 'Shipment Tracker',
  icon: '📍',
  description: 'Adds visibility workflows for pickups, customs, transit, and delivery.',
  render() {
    return `
      <div class="card" style="padding:18px; background:#F4F8F5; border-radius:12px; border:1px solid var(--border-soft);">
        <h3 style="margin:0 0 10px; font-size:1rem; color: var(--navy);">Shipment Tracker</h3>
        <p style="margin:0 0 14px; color: var(--muted);">Preview a plugin that can attach tracking, status updates, and role hand-offs to any logistics path.</p>
        <div style="display:grid; gap:12px;">
          <div style="display:flex; justify-content:space-between; gap:12px;">
            <span>Current stage</span>
            <strong>In transit</strong>
          </div>
          <div style="display:flex; justify-content:space-between; gap:12px;">
            <span>Next checkpoint</span>
            <strong>Customs approval</strong>
          </div>
        </div>
      </div>
    `;
  },
};
