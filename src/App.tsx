/**
 * Application shell.
 *
 * Intentionally minimal: the shelf, disc detail view and upload flow are
 * delivered by the tasks in `.kiro/specs/cd-collection/tasks.md`. This exists so
 * the build, lint and test pipeline runs against real code from commit one.
 */
export function App() {
  return (
    <main className="app-shell">
      <h1 className="app-shell__title">discoteca</h1>
      <p className="app-shell__subtitle">A collection of compact discs, waiting to be shelved.</p>
    </main>
  );
}
