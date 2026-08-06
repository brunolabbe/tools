import { SCENARIOS, scenarioUrl } from "../api/scenarios.ts";

interface ScenarioHintsProps {
  onPick: (url: string) => void;
}

/**
 * Only rendered against the mock transport. Every branch of the UI — each error
 * code, indeterminate progress, a dropped event stream — is reachable from one
 * of these URLs, so "demonstrable" does not mean "read the source to find out
 * how".
 */
export function ScenarioHints({ onPick }: ScenarioHintsProps): React.JSX.Element {
  return (
    <section className="card card--quiet" aria-labelledby="scenarios-heading">
      <div className="card__head">
        <h2 id="scenarios-heading" className="card__title">
          Demo scenarios
        </h2>
        <span className="pill pill--warn">mock API</span>
      </div>
      <p className="muted">
        The API is mocked. Any address gets the happy path; these produce specific outcomes. Three
        more states come from interaction rather than a URL: type nonsense for{" "}
        <code>INVALID_URL</code>, press Cancel for <code>JOB_CANCELED</code>, and reload the page
        mid-download for <code>JOB_NOT_FOUND</code> (the mock server forgets everything on reload).
      </p>
      <ul className="scenarios">
        <li>
          <button type="button" className="scenario" onClick={() => onPick(scenarioUrl(""))}>
            <span className="scenario__title">Happy path</span>
            <span className="scenario__desc">
              Five variants, determinate progress, finished file with a retention countdown.
            </span>
          </button>
        </li>
        {SCENARIOS.map((scenario) => (
          <li key={scenario.keyword}>
            <button
              type="button"
              className="scenario"
              onClick={() => onPick(scenarioUrl(scenario.keyword))}
            >
              <span className="scenario__title">{scenario.title}</span>
              <span className="scenario__desc">{scenario.description}</span>
              <code className="scenario__url">/watch/{scenario.keyword}</code>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
