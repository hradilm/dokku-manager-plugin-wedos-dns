import WedosDnsTab from './WedosDnsTab.jsx';
import WedosDnsSetupStep from './WedosDnsSetupStep.jsx';

export default {
  id: 'wedos-dns',
  label: 'WEDOS DNS',
  settingsSections: [
    {
      id: 'wedos-dns-config',
      tab: 'dns',
      tabLabel: 'DNS',
      tabOrder: 40,
      label: 'WEDOS DNS',
      component: WedosDnsTab,
      order: 10,
    },
  ],
  setupWizardSteps: [
    {
      id: 'wedos-dns-setup',
      slot: 'dns',
      title: 'DNS Settings',
      description: 'Configure WEDOS DNS for public app access (optional)',
      component: WedosDnsSetupStep,
      order: 10,
    },
  ],
};
