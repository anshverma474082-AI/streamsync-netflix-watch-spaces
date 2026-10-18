import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

const GENRES = ['animation', 'comedy', 'family', 'sci-fi', 'surreal', 'fantasy', 'adventure', 'action'];

export default function Dashboard() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();

  const [recs, setRecs] = useState(null);
  const [interactions, setInteractions] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [locale, setLocale] = useState(user?.preferences?.subtitleLocale ?? 'en');
  const [affinity, setAffinity] = useState(user?.preferences?.genreAffinity ?? []);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [r, i, l] = await Promise.all([api.recommendations(), api.myInteractions(), api.liveRooms()]);
      setRecs(r);
      setInteractions(i.interactions);
      setRooms(l.rooms);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function savePrefs() {
    try {
      const r = await api.savePreferences({ subtitleLocale: locale, genreAffinity: affinity });
      setUser(r.user);
      setNotice('Preferences saved — your next retrained rail will use them.');
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function rate(titleId, rating) {
    try {
      await api.rateTitle(titleId, rating);
      setNotice(`Rated ${rating} ★ — rail refreshed.`);
      const r = await api.recommendations();
      setRecs(r);
      const i = await api.myInteractions();
      setInteractions(i.interactions);
    } catch (e) {
      setError(e.message);
    }
  }

  async function startFromRecommendation(rec) {
    try {
      const ws = await api.createWatchSpace({
        titleId: rec.titleId,
        roomName: `${user.displayName} & friends — ${rec.name}`,
      });
      navigate(`/room/${ws.watchSpaceId}?code=${ws.inviteCode}`);
    } catch (e) {
      setError(e.status === 403 ? 'Only hosts can open Watch Spaces — ask a host to start this title.' : e.message);
    }
  }

  return (
    <div className="home">
      <header className="topbar">
        <h1 className="logo" onClick={() => navigate('/')}>StreamSync</h1>
        <div className="topbar-right">
          <button className="btn ghost" onClick={() => navigate('/')}>Back to catalog</button>
          <span className="user-chip">{user?.displayName} · {user?.role}</span>
        </div>
      </header>

      {error && <div className="banner error" onClick={() => setError(null)}>{error}</div>}
      {notice && <div className="banner" onClick={() => setNotice(null)}>{notice}</div>}

      <section className="rail">
        <h2>Recommended for you</h2>
        <p className="card-sub">
          Hybrid model · content + co-viewer signals
          {recs?.model ? ` · trained ${new Date(recs.model.trainedAt).toLocaleTimeString()} on ${recs.model.interactionCount} interactions from ${recs.model.viewerCount} viewers` : ''}
        </p>
        <div className="rail-row">
          {recs?.recommendations?.length === 0 && (
            <p className="card-sub">You have watched the whole demo catalog — nothing new to surface yet.</p>
          )}
          {(recs?.recommendations ?? []).map((rec) => (
            <div key={rec.titleId} className="card rec" onClick={() => startFromRecommendation(rec)}>
              {rec.posterUrl ? <img src={rec.posterUrl} alt={rec.name} loading="lazy" /> : <div className="poster-fallback">{rec.name}</div>}
              <div className="card-title">{rec.name}</div>
              <div className="card-sub">{Math.round((rec.durationSeconds ?? 0) / 60)} min · {rec.genres?.join(', ')}</div>
              <div className="score-bar"><span style={{ width: `${Math.round(rec.score * 100)}%` }} /></div>
              <div className="rec-reasons">
                {rec.reasons.map((reason) => (
                  <span key={reason} className="reason-chip">{reason}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="dash-section">
        <h2>Active Watch Spaces (quick rejoin)</h2>
        {rooms.length === 0 && <p className="card-sub">No live rooms right now.</p>}
        {rooms.map((r) => (
          <div key={r.watchSpaceId} className="room-row" onClick={() => navigate(`/room/${r.watchSpaceId}`)}>
            <span>{r.roomName}</span>
            <span className="card-sub">{r.title?.name} · {r.status} · {r.participantCount} in room</span>
          </div>
        ))}
      </section>

      <section className="dash-section">
        <h2>Your watch history</h2>
        <p className="card-sub">Recorded from real Watch Space sessions — no per-heartbeat writes.</p>
        {interactions.length === 0 && <p className="card-sub">Watch a room to the end and your time lands here.</p>}
        {interactions.map((row) => (
          <div key={row.id} className="room-row history-row">
            <div>
              <div>{row.title?.name}</div>
              <div className="card-sub">
                {Math.round((row.watchedSeconds ?? 0) / 60)} min watched
                {row.completed ? ' · completed' : ''}
                {row.lastWatchedAt ? ` · ${new Date(row.lastWatchedAt).toLocaleDateString()}` : ''}
              </div>
            </div>
            <div className="stars">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  className={n <= Math.round(row.rating ?? 0) ? 'star on' : 'star'}
                  onClick={() => rate(row.title?._id, n)}
                  aria-label={`Rate ${row.title?.name} ${n} stars`}
                >
                  ★
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="dash-section">
        <h2>Your profile</h2>
        <p>{user.displayName} · {user.email} · role {user.role}</p>
        <label className="pref-label">
          Subtitle locale (drives automatic localized subtitle packs — no vote needed for you)
          <select value={locale} onChange={(e) => setLocale(e.target.value)}>
            <option value="en">English</option>
            <option value="hi">Hindi</option>
          </select>
        </label>
        <div className="pref-label">
          Genre affinity (feeds the content side of your recommender)
          <div className="genre-grid">
            {GENRES.map((g) => (
              <label key={g} className="check">
                <input
                  type="checkbox"
                  checked={affinity.includes(g)}
                  onChange={(e) => setAffinity(e.target.checked ? [...affinity, g] : affinity.filter((x) => x !== g))}
                />
                {g}
              </label>
            ))}
          </div>
        </div>
        <button className="btn" onClick={savePrefs}>Save preferences</button>
      </section>

      {user.role === 'admin' && <AdminPanel onError={setError} onNotice={setNotice} />}
    </div>
  );
}

function AdminPanel({ onError, onNotice }) {
  const [model, setModel] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [titles, setTitles] = useState([]);
  const [titleId, setTitleId] = useState('');
  const [mode, setMode] = useState('merge');
  const [json, setJson] = useState('{\n  "timeline": [\n    { "ts": 45, "type": "trivia", "text": "Your authored event." }\n  ]\n}');
  const [schema, setSchema] = useState(null);
  const [ingestErrors, setIngestErrors] = useState(null);

  useEffect(() => {
    api.titles().then((r) => {
      setTitles(r.titles);
      if (r.titles[0]) setTitleId(r.titles[0]._id);
    }).catch(() => {});
    refreshSessions();
  }, []);

  async function refreshSessions() {
    try {
      const r = await api.analyticsSessions();
      setSessions(r.sessions);
      setModel(r.model);
    } catch (e) {
      onError(e.message);
    }
  }

  async function retrain() {
    try {
      const r = await api.retrainModel();
      setNotice(`Model retrained: precision@${r.evaluation.k} = ${r.evaluation.precision} on ${r.evaluation.evaluated} held-out interactions (${r.interactionCount} rows).`);
      refreshSessions();
    } catch (e) {
      onError(e.message);
    }
  }

  async function showSchema() {
    try {
      setSchema(await api.timelineSchema(titleId));
    } catch (e) {
      onError(e.message);
    }
  }

  async function upload() {
    setIngestErrors(null);
    let payload;
    try {
      payload = JSON.parse(json);
    } catch (e) {
      setIngestErrors([{ path: 'json', message: `Not valid JSON: ${e.message}` }]);
      return;
    }
    try {
      const r = await api.uploadTimeline(titleId, payload.timeline ?? payload, mode);
      setNotice(`Ingested ${r.ingested} events (${r.mode}) — ${r.totalEvents} total on ${titles.find((t) => t._id === titleId)?.name}.`);
    } catch (e) {
      setIngestErrors(e.details ?? [{ path: 'request', message: e.message }]);
    }
  }

  return (
    <section className="dash-section admin">
      <h2>Admin — model, ingest & session analytics</h2>
      <p className="card-sub">
        {model?.trainedAt ? `Model trained ${new Date(model.trainedAt).toLocaleString()} · ${model.interactionCount} interactions · ${model.viewerCount} viewers` : 'Model not trained yet in this process.'}
      </p>
      <button className="btn" onClick={retrain}>Retrain model & evaluate</button>

      <h3>Timeline ingest (pre-authored content only)</h3>
      <div className="ingest-row">
        <select value={titleId} onChange={(e) => setTitleId(e.target.value)}>
          {titles.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
        </select>
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="merge">merge</option>
          <option value="replace">replace</option>
        </select>
        <button className="btn ghost" onClick={showSchema}>Show schema</button>
        <button className="btn primary" onClick={upload}>Upload JSON</button>
      </div>
      <textarea value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} aria-label="Timeline JSON" />
      {schema && <pre className="schema-doc">{JSON.stringify(schema, null, 2)}</pre>}
      {ingestErrors && (
        <ul className="error-list">
          {ingestErrors.map((err) => <li key={err.path}>{err.path}: {err.message}</li>)}
        </ul>
      )}

      <h3>Ended sessions <button className="btn ghost small" onClick={refreshSessions}>Refresh</button></h3>
      <table className="analytics">
        <thead>
          <tr><th>Room</th><th>Watched</th><th>Peak</th><th>Chat</th><th>AI Qs</th><th>Trivia</th><th>Votes</th><th>Variations</th><th>Reconciled</th></tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={String(s.watchSpaceId)}>
              <td>{s.roomName}</td>
              <td>{s.summary?.watchedSeconds ?? 0}s / {s.summary?.durationSeconds ?? 0}s</td>
              <td>{s.summary?.peakParticipants ?? 0}</td>
              <td>{s.summary?.chatVolume ?? 0} / {s.persisted?.chatVolume ?? 0}</td>
              <td>{s.summary?.aiQuestionsAsked ?? 0}</td>
              <td>{s.summary?.triviaSurfaced ?? 0}</td>
              <td>{s.summary?.votesCast ?? 0}</td>
              <td>{s.summary?.variationsApplied ?? 0}</td>
              <td className={s.reconciled?.chatVolume && s.reconciled?.participants ? 'ok' : 'bad'}>
                {s.reconciled?.chatVolume && s.reconciled?.participants ? 'exact' : 'drift'}
              </td>
            </tr>
          ))}
          {sessions.length === 0 && <tr><td colSpan="9">No ended sessions yet.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
