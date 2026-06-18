import { useState } from 'react';
import type { Gate, Question } from '../api';

function QuestionRow({
  q,
  onAnswer,
}: {
  q: Question;
  onAnswer: (id: string, text: string) => void;
}) {
  const [text, setText] = useState('');
  return (
    <div className="card-raised p-2">
      <div className="text-sm">{q.question}</div>
      <div className="mt-2 flex gap-2">
        <input
          className="field flex-1"
          placeholder="answer…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim()) onAnswer(q.id, text);
          }}
        />
        <button className="btn" onClick={() => onAnswer(q.id, text)}>
          Send
        </button>
      </div>
    </div>
  );
}

/** The human inbox: open gates (approve/reject) + agent questions (answer). The only writes the UI makes. */
export function Inbox({
  gates,
  questions,
  onDecideGate,
  onAnswerQuestion,
}: {
  gates: Gate[];
  questions: Question[];
  onDecideGate: (id: string, decision: 'approve' | 'reject') => void;
  onAnswerQuestion: (id: string, answer: string) => void;
}) {
  if (gates.length === 0 && questions.length === 0) {
    return <p className="muted text-sm">Nothing waiting — the inbox is clear.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {gates.map((g) => (
        <div key={g.id} className="card-raised flex items-center justify-between gap-2 p-2">
          <span className="text-sm">
            <b className="font-medium" style={{ color: 'var(--gate)' }}>
              {g.type}
            </b>{' '}
            · <span className="mono">{g.scopeId}</span>
          </span>
          <span className="flex shrink-0 gap-2">
            <button className="btn btn-ok" onClick={() => onDecideGate(g.id, 'approve')}>
              Approve
            </button>
            <button className="btn btn-no" onClick={() => onDecideGate(g.id, 'reject')}>
              Reject
            </button>
          </span>
        </div>
      ))}
      {questions.map((q) => (
        <QuestionRow key={q.id} q={q} onAnswer={onAnswerQuestion} />
      ))}
    </div>
  );
}
