import { useEffect, useRef, useState } from 'react';

export default function ChatPanel({ room, user }) {
  const [text, setText] = useState('');
  const [ask, setAsk] = useState('');
  const [pending, setPending] = useState(null);
  const listRef = useRef(null);
  const typingSent = useRef(0);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [room.messages, room.answers, room.typing]);

  // Clear the "thinking" state once our question's answer arrives.
  useEffect(() => {
    if (!pending) return;
    if (room.answers.some((a) => a.questionId === pending)) setPending(null);
  }, [room.answers, pending]);

  function send(e) {
    e.preventDefault();
    if (!text.trim()) return;
    room.emit('room.chat.send', { body: text });
    setText('');
  }

  function askCopilot(e) {
    e.preventDefault();
    const q = ask.trim();
    if (!q) return;
    const questionId = `q-${Date.now().toString(36)}`;
    setPending(questionId);
    setAsk('');
    room.emit('room.ai.ask', { questionId, question: q });
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
          <div key={`a${i}`} className={`msg ai ${a.grounded ? '' : 'ungrounded'}`}>
            <div className="msg-author">
              AI Co-Pilot
              <span className={`ai-badge ${a.grounded ? 'grounded' : 'refused'}`}>{a.grounded ? 'grounded' : 'no match'}</span>
            </div>
            <div className="ai-question">“{a.question}” · {room.participants.find((p) => p.userId === a.askedBy)?.displayName ?? 'a viewer'} @ {fmtClock(a.positionSeconds)}</div>
            <div className="msg-body">{a.answer}</div>
            {a.sourceEvents?.length > 0 && (
              <div className="msg-sources">
                <span className="sources-label">cited</span>
                {a.sourceEvents.map((s, j) => (
                  <span key={j} className="source-chip" title={s.text}>
                    {fmtClock(s.ts)} · {s.type}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {pending && <div className="ai-thinking">Co-Pilot is searching the timeline…</div>}
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
      <form className="copilot-input" onSubmit={askCopilot}>
        <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Ask the co-pilot — e.g. “who is Frank?”" maxLength={400} />
        <button className="btn accent" type="submit">Ask AI</button>
      </form>
    </div>
  );
}

function fmtClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds ?? 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
