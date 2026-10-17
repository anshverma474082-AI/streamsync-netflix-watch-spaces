import { useEffect, useRef, useState } from 'react';
import { fmtTime } from '../sync/format.js';

export default function Player({ videoRef, syncRef, room, isHost, meta, user }) {
  const [drift, setDrift] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [position, setPosition] = useState(0);
  const draggingRef = useRef(false);
  const trivia = room.trivia;

  useEffect(() => {
    if (syncRef.current) syncRef.current.onDrift = (d) => setDrift(d);
  }, [syncRef.current]);

  // Keep the scrubber glued to the actual playhead unless the host is dragging.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const on = () => {
      if (!draggingRef.current) setPosition(v.currentTime);
      setPlaying(!v.paused);
    };
    v.addEventListener('timeupdate', on);
    v.addEventListener('play', on);
    v.addEventListener('pause', on);
    return () => {
      v.removeEventListener('timeupdate', on);
      v.removeEventListener('play', on);
      v.removeEventListener('pause', on);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      const v = videoRef.current;
      if (!v || isHost || !syncRef.current) return;
      setNeedsGesture(syncRef.current.snapshot.state === 'playing' && v.paused);
    }, 400);
    return () => clearInterval(t);
  }, [isHost, syncRef.current]);

  useEffect(() => {
    if (!trivia) return;
    const t = setTimeout(() => room.setTrivia(null), 8000);
    return () => clearTimeout(t);
  }, [trivia]);

  function send(state, positionSeconds) {
    syncRef.current?.hostAction(state, positionSeconds);
  }

  function onPlay() {
    setPlaying(true);
    if (isHost) send('playing', videoRef.current.currentTime);
  }

  function onPause() {
    if (!isHost) return;
    setPlaying(false);
    send('paused', videoRef.current.currentTime);
  }

  function onInputSeek(e) {
    if (!isHost) return;
    draggingRef.current = true;
    const pos = Number(e.target.value);
    setPosition(pos);
    videoRef.current.currentTime = pos;
  }

  function commitSeek() {
    if (!isHost) return;
    draggingRef.current = false;
    const pos = videoRef.current.currentTime;
    videoRef.current.play().catch(() => {});
    send('playing', pos);
  }

  const driftMs = Math.round(Math.abs(drift) * 1000);
  const status = isHost ? 'HOST — your controls drive the room' : `synced · drift ${driftMs} ms`;

  return (
    <div className="player">
      <div className="video-wrap">
        <video
          ref={videoRef}
          src={meta.videoAssetUrl}
          preload="auto"
          onPlay={onPlay}
          onPause={onPause}
          onClick={() => {
            if (isHost) {
              videoRef.current.paused ? videoRef.current.play() : videoRef.current.pause();
            } else if (videoRef.current.paused) {
              videoRef.current.play().catch(() => {});
            }
          }}
          playsInline
        />
        {trivia && (
          <div className={`trivia-card ${trivia.type}`}>
            <span className="trivia-tag">{trivia.type === 'trivia' ? 'AI trivia' : trivia.type}</span>
            {trivia.text}
          </div>
        )}
        {!isHost && needsGesture && (
          <button
            className="join-playback"
            onClick={(e) => {
              e.stopPropagation();
              videoRef.current.play().catch(() => {});
            }}
          >
            ▶ Join live playback
          </button>
        )}
      </div>
      <div className="controls">
        {isHost ? (
          <>
            <button className="btn" onClick={() => (videoRef.current.paused ? videoRef.current.play() : videoRef.current.pause())}>
              {playing ? 'Pause' : 'Play'}
            </button>
            <span className="time-readout">
              {fmtTime(position)} / {fmtTime(meta.durationSeconds)}
            </span>
            <input
              type="range"
              min="0"
              max={meta.durationSeconds}
              step="1"
              value={Math.round(position)}
              onChange={onInputSeek}
              onPointerUp={commitSeek}
              onKeyUp={commitSeek}
            />
          </>
        ) : (
          <span className="mirror-note">Playback mirrors the host</span>
        )}
        <span className={`sync-status ${driftMs < 250 ? 'ok' : 'warn'}`}>{status}</span>
      </div>
    </div>
  );
}
