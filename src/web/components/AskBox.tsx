import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Meta, QuestionResponse } from '../../server/api';
import { askQuestion } from '../api';
import { askModel } from '../models/askModel';
import type { AskShow } from '../models/askModel';
import type { RequestState } from '../requestState';
import { answerHref } from '../urlState';
import type { UrlState } from '../urlState';

export const ASK_MAX_CHARS = 300; // the server's limit (QUESTION_MAX_CHARS)
const INPUT_ID = 'ask-input';

/** Draws what askModel decided. No state, no requests. */
export function AskBoxView({
  show,
  value,
  onChange,
  onSubmit,
  onCancel,
}: {
  show: AskShow;
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  onCancel(): void;
}) {
  if (show.box === 'hidden') return <p className="small muted ask-note">{show.note}</p>;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form className="ask" onSubmit={submit}>
      <label htmlFor={INPUT_ID}>Ask a question</label>
      <div className="row">
        <input id={INPUT_ID} type="text" maxLength={ASK_MAX_CHARS} value={value} onChange={(event) => onChange(event.target.value)} />
        {/* While a question is out the button cancels it, so a hung request always has a way out. */}
        {show.busy ? (
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <button type="submit" className="button">
            Ask
          </button>
        )}
      </div>
      {/* Always rendered, so a screen reader hears each change of its text. */}
      <div role="status" className="ask-result">
        {show.busy && <p>Reading your question...</p>}
        {show.message !== null && <p>{show.message}</p>}
        {show.examples !== null && (
          <ul>
            {show.examples.map((example) => (
              <li key={example}>{example}</li>
            ))}
          </ul>
        )}
      </div>
    </form>
  );
}

/**
 * One request at a time; Cancel or leaving the page aborts it. On a valid filter it navigates to the answer page;
 * on failure the typed text stays.
 */
export function AskBox({ meta, state, onNavigate }: { meta: Pick<Meta, 'aiStatus'>; state: UrlState; onNavigate(href: string): void }) {
  const [value, setValue] = useState('');
  const [request, setRequest] = useState<RequestState<QuestionResponse> | null>(null);
  const busy = request?.status === 'loading';
  const latestState = useRef(state); // navigate from the page as it is when the reply arrives
  latestState.current = state;
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []); // unmount

  const submit = () => {
    if (busy || value.trim() === '') return;
    const abort = new AbortController();
    controller.current = abort;
    setRequest({ status: 'loading', key: value });
    askQuestion(value, abort.signal).then((reply) => {
      if (abort.signal.aborted) return;
      if (reply.ok) {
        setRequest(null);
        onNavigate(answerHref(latestState.current, reply.query));
      } else {
        setRequest({ status: 'ready', key: value, data: reply });
      }
    });
  };

  const cancel = () => {
    controller.current?.abort();
    setRequest(null);
  };

  return <AskBoxView show={askModel(meta, request)} value={value} onChange={setValue} onSubmit={submit} onCancel={cancel} />;
}
