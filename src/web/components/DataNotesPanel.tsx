import type { NotesSection } from '../models/dataNotesModel';

/** The dev-mode data notes. Prints the sections it is given; decides nothing. */
export function DataNotesPanel({ sections, onClose }: { sections: NotesSection[]; onClose(): void }) {
  return (
    <aside className="notes-panel" role="complementary" aria-label="Data notes">
      <div className="row">
        <h2>Data notes</h2>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>
      {sections.map((section) => (
        <section key={section.title}>
          <h3>{section.title}</h3>
          {section.items.length > 0 && (
            <dl className="notes-items">
              {section.items.map((item) => (
                <div key={item.label} className="notes-item">
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {section.list && section.list.length > 0 && (
            <ul>
              {section.list.map((entry, index) => (
                <li key={`${index}-${entry}`}>{entry}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </aside>
  );
}
