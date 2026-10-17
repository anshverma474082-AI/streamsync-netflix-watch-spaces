import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function Dashboard() {
  const { user, setUser } = useAuth();
  const [rooms, setRooms] = useState([]);
  const [locale, setLocale] = useState(user?.preferences?.subtitleLocale ?? 'en');
  const navigate = useNavigate();

  useEffect(() => {
    api.liveRooms().then((r) => setRooms(r.rooms)).catch(() => {});
  }, []);

  async function savePrefs() {
    const r = await api.savePreferences({ subtitleLocale: locale });
    setUser(r.user);
  }

  return (
    <div className="home">
      <header className="topbar">
        <h1 className="logo" onClick={() => navigate('/')}>StreamSync</h1>
        <div className="topbar-right">
          <button className="btn ghost" onClick={() => navigate('/')}>Back to catalog</button>
        </div>
      </header>
      <section className="dash-section">
        <h2>Your profile</h2>
        <p>{user.displayName} · {user.email} · role {user.role}</p>
        <label>
          Subtitle locale preference (drives AI localization swaps)
          <select value={locale} onChange={(e) => setLocale(e.target.value)}>
            <option value="en">English</option>
            <option value="hi">Hindi</option>
          </select>
        </label>
        <button className="btn" onClick={savePrefs}>Save</button>
      </section>
      <section className="dash-section">
        <h2>Active Watch Spaces (quick rejoin)</h2>
        {rooms.length === 0 && <p>No live rooms right now.</p>}
        {rooms.map((r) => (
          <div key={r.watchSpaceId} className="room-row" onClick={() => navigate(`/room/${r.watchSpaceId}`)}>
            <span>{r.roomName}</span>
            <span className="card-sub">{r.title?.name} · {r.status}</span>
          </div>
        ))}
      </section>
      <section className="dash-section">
        <h2>Recommended for you</h2>
        <p className="card-sub">Personalized rail arrives with the recommendation engine — see Dashboard analytics.</p>
      </section>
    </div>
  );
}
