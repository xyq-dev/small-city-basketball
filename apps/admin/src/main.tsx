import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import RuntimeApp from './RuntimeApp';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('缺少应用挂载节点');

createRoot(container).render(
  <StrictMode>
    <RuntimeApp />
  </StrictMode>,
);
