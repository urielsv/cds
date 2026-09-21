/** Conventional Commits, so the history stays readable and releases scriptable. */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Scopes that map to the areas of this codebase.
    'scope-enum': [
      1,
      'always',
      [
        'shelf', // the browsable grid / "infinite box"
        'disc', // disc detail view
        'upload', // add-a-disc flow
        'scan', // barcode / camera
        'search', // search, filter, sort
        'motion', // animation system and tokens
        'api', // serverless functions
        'data', // domain model, storage, ingest
        'auth', // upload gating
        'ci',
        'deps',
        'spec', // .kiro specs and steering
      ],
    ],
    'subject-case': [2, 'never', ['pascal-case', 'upper-case']],
    'body-max-line-length': [0],
  },
};
