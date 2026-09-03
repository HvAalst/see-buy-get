/**
 * Vite's `?raw` import, declared here because this project deliberately ships no `@types/node`.
 *
 * The browser code must never see Node globals (tsconfig has no "node" in `types`, and that is a
 * boundary worth keeping), but one test needs to read the OpenAPI contract off disk to check that the
 * outbox's allowlist still matches real endpoints. `?raw` is the bundler's own answer to that: a string,
 * no filesystem API, nothing that could leak into an app bundle.
 */
declare module '*?raw' {
  const content: string;
  export default content;
}
