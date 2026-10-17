import { useEffect, useRef, useState } from 'react';

export default function ChatPanel({ room, user }) {
  const [text, setText] = useState('');
  const listRef = useRef(null);
  const typingSent = useRef(0);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [room.messages, room.typing]);

  function send(e) {
    e.preventDefault();
    if (!text.trim()) return;
    room.emit('room.chat.send', { body: text });
    setText('');
  }

  function onType() {
    const now = Date.now();
    if (now - typingSent.current > 1200) {
      typingSent.current = now;
      room.emit('room.chat.typing', { typing: true });
    }
  }

  const typingNames = Object.entries(room.typing)
    .filter(([id, on]) => on && id !== user.id)
    .map(([id]) => room.participants.find((p) => p.userId === id)?.displayName)
    .filter(Boolean);

  return (
    <div className="chat-panel">
      <div className="chat-list" ref={listRef}>
        {room.answers.map((a, i) => (
          <div key={`a${i}`} className="msg ai">
            <div className="msg-author">AI Co-Pilot</div>
            <div className="msg-body">{a.answer}</div>
            {a.sourceEvents?.length > 0 && (
              <div className="msg-sources">grounded in {a.sourceEvents.length} timeline entries</div>
            )}
          </div>
        ))}
        {room.messages.map((m) =>
          m.msgType === 'system' ? (
            <div key={m._id} className="msg system">{m.body}</div>
          ) : (
            <div key={m._id} className={`msg ${m.userId === user.id ? 'own' : ''}`}>
              <div className="msg-author">{m.userId === user.id ? 'You' : room.participants.find((p) => p.userId === m.userId)?.displayName ?? 'Guest'}</div>
              <div className="msg-body">{m.body}</div>
              <div className="msg-reactions">
                {(m.reactions ?? []).map((r, i) => (
                  <span key={i} className="reaction">{r.emoji}</span>
                ))}
                {['👍', '❤️', '😂'].map((e) => (
                  <button key={e} className="react-btn" onClick={() => room.emit('room.chat.react', { messageId: m._id, emoji: e })}>{e}</button>
                ))}
              </div>
            </div>
          )
        )}
        {typingNames.length > 0 && <div className="typing">{typingNames.join(', ')} typing…</div>}
      </div>
      <form className="chat-input" onSubmit={send}>
        <input value={text} onChange={(e) => { setText(e.target.value); onType(); }} placeholder="Message the room…" maxLength={2000} />
        <button className="btn" type="submit">Send</button>
      </form>
    </div>
  );
}
