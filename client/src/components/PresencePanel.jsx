export default function PresencePanel({ room, isHost, currentUserId }) {
  return (
    <div className="presence-panel">
      {room.participants.map((p) => (
        <div key={p.userId} className="presence-row">
          <span className={`dot ${p.online ? 'on' : 'off'}`} />
          <span className="name">{p.displayName}{p.userId === currentUserId ? ' (you)' : ''}</span>
          {p.userId === room.meta.hostUserId && <span className="badge">HOST</span>}
          {p.muted && <span className="badge warn">muted</span>}
          {isHost && p.userId !== currentUserId && (
            <span className="mod-actions">
              <button onClick={() => room.emit('room.moderation', { action: p.muted ? 'unmute' : 'mute', targetUserId: p.userId })}>{p.muted ? 'unmute' : 'mute'}</button>
              <button onClick={() => room.emit('room.moderation', { action: 'remove', targetUserId: p.userId })}>remove</button>
              <button onClick={() => room.emit('room.moderation', { action: 'transferHost', targetUserId: p.userId })}>make host</button>
            </span>
          )}
        </div>
      ))}
      {isHost && (
        <div className="mod-actions">
          <button onClick={() => room.emit('room.moderation', { action: room.meta.settings.isLocked ? 'unlock' : 'lock' })}>
            {room.meta.settings.isLocked ? 'Unlock room' : 'Lock room'}
          </button>
        </div>
      )}
    </div>
  );
}
