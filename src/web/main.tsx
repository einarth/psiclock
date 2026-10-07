import { createRoot } from 'react-dom/client';
import './base.css';
import './themes/classic.css';
import './themes/midnight.css';
import { Home } from './pages/Home';
import { Director } from './pages/Director';
import { Display } from './pages/Display';
import { Players } from './pages/Players';

function route() {
  const [, page, id] = location.pathname.split('/');
  if (page === 'director' && id) return <Director id={Number(id)} />;
  if (page === 'display' && id) return <Display id={Number(id)} />;
  if (page === 'players') return <Players />;
  return <Home />;
}

createRoot(document.getElementById('root')!).render(route());
