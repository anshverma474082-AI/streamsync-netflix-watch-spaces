import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtTime } from '../sync/format.js';

export default function Player({ videoRef, syncRef, room, isHost, meta, user, timeline }) {
  const [drift, setDrift] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [position, setPosition] = useState(0);
  const draggingRef = useRef(false);
  const trivia = room.trivia;

  useEffect(() => {
    if (syncRef.current) syncRef.current.onDrift = (d) => setDrift(d);
  }, [syncRef.current]);

  // The playhead follows the authoritative clock (or the host's element while
  // dragging), not sporadic `timeupdate` events — a mirrored viewer is often
  // paused or seek-held by the sync controller, which fires almost none.
  useEffect(() => {
    const t = setInterval(() => {
      const v = videoRef.current;
      if (!v) return;
      if (!draggingRef.current) setPosition(getPosition());
      setPlaying(!v.paused);
    }, 250);
    return () => clearInterval(t);
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

  function getPosition() {
    const sync = syncRef.current;
    return sync ? sync.currentPosition() : videoRef.current?.currentTime ?? 0;
  }

  function onPlay() {
    setPlaying(true);
    setPosition(getPosition());
    if (isHost) send('playing', videoRef.current.currentTime);
  }

  function onPause() {
    setPosition(getPosition());
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

  const variationPoints = useMemo(() => (timeline ?? []).filter((e) => e.type === 'variationPoint'), [timeline]);

  // Non-destructive content layer: a group-voted variant applies to everyone;
  // otherwise a viewer whose locale preference matches an authored subtitle
  // pack sees the localized line. Neither ever interrupts playback.
  const caption = useMemo(() => {
    for (const p of variationPoints) {
      const applied = room.appliedVariations[p.variationId];
      if (applied && position >= applied.ts && position <= applied.ts + 15) {
        return { text: applied.text, tag: 'group-voted variant' };
      }
    }
    const localePoint = variationPoints
      .filter((p) => p.subtitleLocale && position >= p.ts && position <= p.ts + 15)
      .sort((a, b) => a.ts - b.ts)
      .at(-1);
    if (localePoint && user?.preferences?.subtitleLocale === localePoint.subtitleLocale) {
      const opt = localePoint.options?.[0];
      if (opt) return { text: opt.text, tag: `${localePoint.subtitleLocale} subtitle pack — auto for your locale` };
    }
    return null;
  }, [variationPoints, position, room.appliedVariations, user]);

  const openableVotes = useMemo(
    () =>
      variationPoints.filter(
        (p) => !room.appliedVariations[p.variationId] && !room.vote && p.ts >= position - 30 && p.ts <= position + 60
      ),
    [variationPoints, position, room.appliedVariations, room.vote]
  );

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
        {caption && (
          <div className="subtitle-bar">
            <span className="subtitle-tag">{caption.tag}</span>
            {caption.text}
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
            {openableVotes.map((p) => (
              <button
                key={p.variationId}
                className="btn accent sm"
                title={p.text}
                onClick={() => room.emit('room.variation.openVote', { variationId: p.variationId })}
              >
                Trigger vote @ {fmtTime(p.ts)}
              </button>
            ))}
          </>
        ) : (
          <span className="mirror-note">Playback mirrors the host</span>
        )}
        <span className={`sync-status ${driftMs < 250 ? 'ok' : 'warn'}`}>{status}</span>
      </div>
    </div>
  );
}
