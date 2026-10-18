import { useEffect, useState } from 'react';

export default function VoteOverlay({ vote, room, user }) {
  const [remaining, setRemaining] = useState(0);
  const [myChoice, setMyChoice] = useState(null);

  useEffect(() => {
    if (vote.phase !== 'open') return undefined;
    const tick = () => setRemaining(Math.max(0, vote.endsAt - Date.now()));
    tick();
    const t = setInterval(tick, 200);
    return () => clearInterval(t);
  }, [vote]);

  function cast(optionId) {
    if (myChoice) return;
    setMyChoice(optionId);
    room.emit('room.variation.vote', { variationId: vote.variationId, optionId });
  }

  const total = vote.totalVotes || Object.values(vote.tally ?? {}).reduce((a, b) => a + b, 0) || 1;
  const secondsLeft = Math.ceil(remaining / 1000);

  return (
    <div className="vote-overlay">
      <div className="vote-card">
        <h3>Group vote — content variation</h3>
        <p className="vote-desc">{vote.text}</p>
        {vote.phase === 'open' && (
          <>
            {vote.options.map((o) => (
              <button key={o.id} className={`vote-option ${myChoice === o.id ? 'chosen' : ''}`} onClick={() => cast(o.id)}>
                <strong>{o.label}</strong>
                {o.text && <div className="vote-option-text">{o.text}</div>}
              </button>
            ))}
            <div className="vote-tally">
              {myChoice ? 'Vote locked in — waiting for the group' : `${vote.options.length} pre-authored options · one vote per viewer`}
              {' '}· closes in {secondsLeft}s
            </div>
          </>
        )}
        {vote.phase === 'closed' && (
          <div className="vote-results">
            {vote.options.map((o) => (
              <div key={o.id} className={`vote-result-row ${o.id === vote.winnerOptionId ? 'winner' : ''}`}>
                <span>{o.label}{o.id === vote.winnerOptionId ? ' ★' : ''}</span>
                <span className="vote-tally">{vote.tally[o.id] ?? 0} / {total}</span>
              </div>
            ))}
            <div className="vote-tally">Counting complete — winner applies at its authored moment for everyone.</div>
          </div>
        )}
        {vote.phase === 'applied' && (
          <div className="vote-applied">
            <div className="applied-line">{vote.applied.text}</div>
            <div className="vote-tally">Applied for all participants (via group vote).</div>
          </div>
        )}
        <button className="btn ghost" onClick={room.clearVote}>
          {vote.phase === 'open' ? 'Dismiss' : 'Close'}
        </button>
      </div>
    </div>
  );
}
