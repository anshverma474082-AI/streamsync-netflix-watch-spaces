import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function Home() {
  const [titles, setTitles] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [creating, setCreating] = useState(null);
  const [settings, setSettings] = useState({ maxParticipants: 25, aiVerbosity: 'normal', votingEnabled: true });
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState(null);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    api.titles().then((r) => setTitles(r.titles)).catch((e) => setError(e.message));
    api.liveRooms().then((r) => setRooms(r.rooms)).catch(() => {});
  }, []);

  async function createSpace() {
    try {
      const ws = await api.createWatchSpace({ titleId: creating._id, roomName: `${user.displayName} & friends — ${creating.name}`, ...settings });
      navigate(`/room/${ws.watchSpaceId}?code=${ws.inviteCode}`);
    } catch (e) {
      setError(e.message);
    }
  }

  async function joinByCode(e) {
    e.preventDefault();
    try {
      const r = await api.byInvite(joinCode.trim());
      navigate(`/room/${r.watchSpaceId}?code=${joinCode.trim().toUpperCase()}`);
    } catch (err) {
      setError(err.message);
    }
  }

  const byGenre = titles.reduce((acc, t) => {
    (t.genres ?? []).forEach((g) => (acc[g] ??= []).push(t));
    return acc;
  }, {});

  return (
    <div className="home">
      <header className="topbar">
        <h1 className="logo" onClick={() => navigate('/')}>StreamSync</h1>
        <div className="topbar-right">
          <form className="join-form" onSubmit={joinByCode}>
            <input placeholder="Invite code (NX-…)" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} />
            <button className="btn ghost" type="submit">Join</button>
          </form>
          <span className="user-chip">{user?.displayName} · {user?.role}</span>
          <button className="btn ghost" onClick={() => navigate('/dashboard')}>Dashboard</button>
          <button className="btn ghost" onClick={() => { logout(); navigate('/login'); }}>Sign out</button>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      {rooms.length > 0 && (
        <section className="rail">
          <h2>Live Watch Spaces</h2>
          <div className="rail-row">
            {rooms.map((r) => (
              <div key={r.watchSpaceId} className="card live" onClick={() => navigate(`/room/${r.watchSpaceId}`)}>
                <div className="live-tag">{r.status}</div>
                <div className="card-title">{r.roomName}</div>
                <div className="card-sub">{r.title?.name} · {r.participantCount} joined</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {Object.entries(byGenre).map(([genre, list]) => (
        <section key={genre} className="rail">
          <h2>{genre[0].toUpperCase() + genre.slice(1)}</h2>
          <div className="rail-row">
            {list.map((t) => (
              <div key={t._id} className="card" onClick={() => setCreating(t)}>
                {t.posterUrl ? <img src={t.posterUrl} alt={t.name} loading="lazy" /> : <div className="poster-fallback">{t.name}</div>}
                <div className="card-title">{t.name}</div>
                <div className="card-sub">{Math.round(t.durationSeconds / 60)} min · {t.genres.join(', ')}</div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {creating && (
        <div className="modal-backdrop" onClick={() => setCreating(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Start a Watch Space — {creating.name}</h2>
            <label>
              Max participants
              <input type="number" min="2" max="50" value={settings.maxParticipants} onChange={(e) => setSettings({ ...settings, maxParticipants: Number(e.target.value) })} />
            </label>
            <label>
              AI Co-Pilot verbosity
              <select value={settings.aiVerbosity} onChange={(e) => setSettings({ ...settings, aiVerbosity: e.target.value })}>
                <option value="minimal">minimal</option>
                <option value="normal">normal</option>
                <option value="chatty">chatty</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.votingEnabled} onChange={(e) => setSettings({ ...settings, votingEnabled: e.target.checked })} />
              Enable group variation voting
            </label>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setCreating(null)}>Cancel</button>
              <button className="btn primary" onClick={createSpace}>Create & open room</button>
            </div>
            <p className="modal-note">Requires a host-role account. Viewers can join any room with its invite link/code.</p>
          </div>
        </div>
      )}
    </div>
  );
}
