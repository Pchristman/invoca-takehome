import type { DateRange } from '../../core/ranges';
import type { AnswerResponse } from '../../server/api';
import { answerModel } from '../models/answerModel';
import type { RequestState } from '../requestState';
import { useApi } from '../useApi';
import { answerParams, clearHref, withDevOf } from '../urlState';
import type { UrlState } from '../urlState';
import { Caveats } from './Caveats';
import { Link } from './Link';
import { RequestFrame } from './RequestFrame';

/** Draws a request for /api/answer: loading, the server's message, or the answer. */
export function AnswerPage({
  request,
  state,
  span,
  resetHref,
  onRetry,
}: {
  request: RequestState<AnswerResponse> | null;
  state: UrlState;
  span: DateRange;
  resetHref: string;
  onRetry(): void;
}) {
  return (
    <RequestFrame state={request} loadingLabel="Loading the answer..." resetHref={resetHref} onRetry={onRetry}>
      {(data) => {
        const show = answerModel(data, span);
        return (
          <section className="answer" aria-label="Answer">
            <p className="small muted">{show.interpretation}</p>
            <p className="answer-sentence">{show.sentence}</p>
            <Caveats items={show.caveats} />
            <ul className="row small answer-totals">
              {show.totals.map((total) => (
                <li key={total.label}>{`${total.label}: ${total.value}`}</li>
              ))}
            </ul>
            {show.showTable && (
            <div className="table-wrap">
              <table>
                <caption className="visually-hidden">Calls that match the question</caption>
                <thead>
                  <tr>
                    {show.columns.map((column) => (
                      <th key={column} scope="col">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {show.rows.map((row) => (
                    <tr key={row.key}>
                      {row.cells.map((cell, index) =>
                        index === 0 ? (
                          <th key={index} scope="row">
                            {cell}
                          </th>
                        ) : (
                          <td key={index} className="num">
                            {cell}
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
            <p className="row">
              <Link href={withDevOf(show.link.href, state)}>{show.link.label}</Link>
              <Link href={clearHref(state)}>Clear question</Link>
            </p>
          </section>
        );
      }}
    </RequestFrame>
  );
}

/** The answer page: its own request, code only. */
export function AnswerView({ state, span, resetHref }: { state: UrlState; span: DateRange; resetHref: string }) {
  const answer = useApi<AnswerResponse>('/api/answer', answerParams(state));
  return <AnswerPage request={answer.state} state={state} span={span} resetHref={resetHref} onRetry={answer.retry} />;
}
