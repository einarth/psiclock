import { createRoot } from 'react-dom/client';
import './base.css';
import './themes';
import { Home } from './pages/Home';
import { Director } from './pages/Director';
import { Display } from './pages/Display';
import { Players } from './pages/Players';
import { Floor } from './pages/Floor';
import { Desk } from './pages/Desk';
import { Payouts } from './pages/Payouts';
import { Account, Login } from './pages/Login';
import { Users } from './pages/Users';
import { Layouts } from './pages/Layouts';
import { RequireRole } from './session';

function route() {
  const [, page, id] = location.pathname.split('/');
  // The screens are open to everyone; every other page needs a login with a high enough role.
  if (page === 'display' && id) return <Display id={Number(id)} />;
  if (page === 'payouts' && id) return <Payouts id={Number(id)} />;
  if (page === 'login') return <Login />;
  if (page === 'director' && id) return <RequireRole role="director"><Director id={Number(id)} /></RequireRole>;
  if (page === 'floor' && id) return <RequireRole role="floor"><Floor id={Number(id)} /></RequireRole>;
  if (page === 'desk' && id) return <RequireRole role="desk"><Desk id={Number(id)} /></RequireRole>;
  if (page === 'players') return <RequireRole role="desk"><Players /></RequireRole>;
  if (page === 'layouts') return <RequireRole role="director"><Layouts /></RequireRole>;
  if (page === 'users') return <RequireRole role="admin"><Users /></RequireRole>;
  if (page === 'account') return <RequireRole role="floor"><Account /></RequireRole>;
  return <Home />;
}

createRoot(document.getElementById('root')!).render(route());
