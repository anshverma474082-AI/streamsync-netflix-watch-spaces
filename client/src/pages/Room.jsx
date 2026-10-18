import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useRoom } from '../hooks/useRoom.js';
import { SyncController } from '../sync/syncController.js';
import { api } from '../api.js';
import Player from '../components/Player.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import PresencePanel from '../components/PresencePanel.jsx';
import VoteOverlay from '../components/VoteOverlay.jsx';

export default function Room() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const syncRef = useRef(null);
  const [invite, setInvite] = useState(params.get('code') ?? '');
  const [copied, setCopied] = useState(false);
  const [timeline, setTimeline] = useState(null);

  const room = useRoom(id, invite || undefined);
  const isHost = room.meta && user && room.meta.hostUserId === user.id;

  const [rtt, setRtt] = useState(null);
  useEffect(() => {
    const t = setInterval(() => setRtt(syncRef.current?.lastRtt ?? null), 2000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!room.meta?.titleId) return;
    api.timeline(room.meta.titleId, 0, room.meta.durationSeconds)
      .then((res) => setTimeline(res.events ?? []))
      .catch(() => setTimeline([]));
  }, [room.meta?.titleId]);

  useEffect(() => {
    if (!videoRef.current || !room.socketRef.current || !room.meta || !room.initialClock) return;
    const sync = new SyncController({
      video: videoRef.current,
      socket: room.socketRef.current,
      watchSpaceId: id,
    });
    sync.isHost = Boolean(isHost);
    syncRef.current = sync;
    room.on('room.playback.update', (payload) => sync.setSnapshot(payload));
    room.on('room.sync.pong', (payload) => sync.onPong(payload));
    sync.setSnapshot(room.initialClock);
    return () => sync.destroy();
  }, [room.meta?.watchSpaceId, room.socketRef.current?.connected, room.initialClock]);

  if (room.error && !room.meta) {
    return (
      <div className="room-error">
        <h2>Cannot join this Watch Space</h2>
        <p>{room.error}</p>
        <button className="btn" onClick={() => navigate('/')}>Back to home</button>
      </div>
    );
  }

  if (!room.meta) return <div className="room-loading">Connecting to Watch Space…</div>;

  const meta = room.meta;
  const ended = meta.status === 'ended';

  async function copyInvite() {
    const url = `${window.location.origin}/room/${id}?code=${meta.inviteCode ?? ''}`;
    await navigator.clipboard.writeText(room.meta.inviteCode ? url : `${window.location.origin}/room/${id}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="room-layout">
      <header className="room-header">
        <div>
          <h1>{meta.roomName || meta.titleName}</h1>
          <span className="room-sub">{meta.titleName}</span>
          {meta.status === 'host_disconnected' && <span className="badge warn">Host disconnected — playback paused</span>}
        </div>
        <div className="room-actions">
          <span className="invite-chip" onClick={copyInvite}>{meta.inviteCode ? `INVITE ${meta.inviteCode} · copy link` : 'Invite-only · ask host for the link'}</span>
          {isHost && !ended && (
            <button className="btn danger" onClick={() => room.emit('room.end', {})}>End session</button>
          )}
          <button className="btn ghost" onClick={() => navigate('/')}>Leave</button>
        </div>
      </header>

      {ended ? (
        <div className="room-ended">
          <h2>Session ended — here is what your group did together</h2>
          <div className="summary-grid">
            {[
              ['Room runtime', `${Math.round((meta.summary?.durationSeconds ?? 0) / 60)} min`],
              ['Synchronized watching', `${Math.round((meta.summary?.watchedSeconds ?? 0) / 60)} min of shared playhead`],
              ['Peak participants', meta.summary?.peakParticipants ?? 0],
              ['Chat messages', meta.summary?.chatVolume ?? 0],
              ['AI Co-Pilot questions', meta.summary?.aiQuestionsAsked ?? 0],
              ['Trivia surfaced', meta.summary?.triviaSurfaced ?? 0],
              ['Variation votes cast', meta.summary?.votesCast ?? 0],
              ['Variations applied', meta.summary?.variationsApplied ?? 0],
            ].map(([label, value]) => (
              <div key={label} className="summary-cell">
                <div className="summary-value">{value}</div>
                <div className="summary-label">{label}</div>
              </div>
            ))}
          </div>
          {(meta.summary?.participants?.length ?? 0) > 0 && (
            <div className="summary-participants">
              {meta.summary.participants.map((p) => (
                <span key={p.userId} className="reason-chip">
                  {p.displayName}: {Math.round((p.watchedSeconds ?? 0) / 60)} min · saved to your history
                </span>
              ))}
            </div>
          )}
          <button className="btn" onClick={() => navigate('/')}>Back to home</button>
        </div>
      ) : (
        <div className="room-body">
          <section className="room-main">
            <Player videoRef={videoRef} syncRef={syncRef} room={room} isHost={isHost} meta={meta} user={user} timeline={timeline} />
          </section>
          <aside className="room-side">
            <nav className="side-tabs">
              <span className="tab active">Chat & Co-Pilot</span>
              <span className="tab count">{room.participants.filter((p) => p.online).length} online</span>
            </nav>
            <PresencePanel room={room} isHost={isHost} currentUserId={user.id} yourRtt={rtt} />
            <ChatPanel room={room} user={user} />
          </aside>
        </div>
      )}
      {room.vote && <VoteOverlay vote={room.vote} room={room} user={user} />}
    </div>
  );
}
