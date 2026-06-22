import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import * as Screen from './App';
import './styles.css';

// Mount whatever the screen module exports — `export default` OR `export function App` — so the
// generated component always renders regardless of which export style the model picked.
const mod = Screen as { default?: ComponentType; App?: ComponentType };
const App = mod.default ?? mod.App;

const root = document.getElementById('root');
if (root && App)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
