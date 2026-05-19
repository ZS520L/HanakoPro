import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { hana } from '@hana/plugin-sdk';
import {
  Button,
  CardShell,
  EmptyState,
  HanaThemeProvider,
  List,
  Select,
  SettingRow,
  Switch,
  TextInput,
} from '@hana/plugin-components';
import '@hana/plugin-components/styles.css';

type ThemeMode = 'inherit' | 'hana' | 'custom';

function Panel() {
  const surface = document.getElementById('root')?.dataset.surface || 'page';
  const [themeMode, setThemeMode] = useState<ThemeMode>('inherit');
  const [title, setTitle] = useState('SDK Showcase');
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    hana.ready();
    hana.ui.resize({ height: surface === 'widget' ? 300 : 460 });
  }, [surface]);

  const customTheme = useMemo(() => (
    themeMode === 'custom'
      ? { bg: '#F7F4EF', bgCard: '#FFFDF8', accent: '#537D96' }
      : undefined
  ), [themeMode]);

  async function copyTitle() {
    await hana.clipboard.writeText(title);
    await hana.toast.show({ message: 'Copied title', type: 'success' });
  }

  return (
    <HanaThemeProvider mode={themeMode} theme={customTheme || (themeMode === 'hana' ? 'warm-paper' : undefined)}>
      <CardShell
        title={title}
        description="A compact example using Hana plugin SDK packages."
        actions={<Button variant="ghost" onClick={() => hana.external.open('https://example.com')}>Open</Button>}
        footer={<Button variant="primary" onClick={copyTitle}>Copy title</Button>}
      >
        <SettingRow
          label="Enabled"
          hint="Switch state stays local to this iframe."
          control={<Switch checked={enabled} onChange={setEnabled} label={enabled ? 'On' : 'Off'} />}
        />
        <SettingRow
          label="Theme"
          control={
            <Select
              value={themeMode}
              onChange={(value) => setThemeMode(value as ThemeMode)}
              options={[
                { value: 'inherit', label: 'Follow Hana' },
                { value: 'hana', label: 'Warm paper' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
          }
        />
        <TextInput label="Title" value={title} onChange={(event) => setTitle(event.currentTarget.value)} />
        <List
          items={[
            { id: 'runtime', title: '@hana/plugin-runtime', meta: 'Node' },
            { id: 'sdk', title: '@hana/plugin-sdk', meta: 'iframe' },
            { id: 'components', title: '@hana/plugin-components', meta: 'React' },
          ]}
        />
        {!enabled && <EmptyState title="Paused" description="Turn the switch back on to resume actions." />}
      </CardShell>
    </HanaThemeProvider>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<Panel />);
