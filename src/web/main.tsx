import { createRoot } from 'react-dom/client';
import './base.css';
import './themes/classic.css';
import './themes/midnight.css';
import { Home } from './pages/Home';
import { Director } from './pages/Director';
import { Display } from './pages/Display';
import { Players } from './pages/Players';
import { Floor } from './pages/Floor';
import { Desk } from './pages/Desk';
import { Payouts } from './pages/Payouts';

function route() {
  const [, page, id] = location.pathname.split('/');
  if (page === 'director' && id) return <Director id={Number(id)} />;
  if (page === 'display' && id) return <Display id={Number(id)} />;
  if (page === 'floor' && id) return <Floor id={Number(id)} />;
  if (page === 'desk' && id) return <Desk id={Number(id)} />;
  if (page === 'payouts' && id) return <Payouts id={Number(id)} />;
  if (page === 'players') return <Players />;
  return <Home />;
}

createRoot(document.getElementById('root')!).render(route());
