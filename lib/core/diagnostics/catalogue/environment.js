/**
 * Environment diagnostic catalogue entries.
 */
export default {
  AVX_W60: {
    code: 'AVX_W60',
    name: 'UndefinedPublicEnv',
    severity: 'warning',
    category: 'environment',
    summary: 'A process.env.AVX_PUBLIC_* reference has no value, so the build inlined undefined in its place.',
    causes: [
      'The variable name is misspelled (e.g. "AVX_PUBLIC_API_URLL" instead of "AVX_PUBLIC_API_URL").',
      'The variable is missing from .env, or from the CI environment the build ran in.'
    ],
    remedies: [
      'Run `avenx env` to list every AVX_PUBLIC_* value the build can see, and correct the reference.',
      'Add the variable to .env or to the build environment.',
      'Silence with "warnings": { "AVX_W60": "off" } if undefined is intended.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w60-compiler-undefined-public-env'
  },
  AVX_W80: {
    code: 'AVX_W80',
    name: 'NonPublicEnvReference',
    severity: 'warning',
    category: 'environment',
    summary: 'A process.env reference without the AVX_PUBLIC_ prefix is not inlined and will throw in the browser.',
    causes: [
      'A compiled file (entry, component, page, bridge, or guard) references process.env.NAME without the AVX_PUBLIC_ prefix.',
      'A server-side or Node-only module was imported into client code without guarding process access.'
    ],
    remedies: [
      'Rename the variable to AVX_PUBLIC_<NAME> if the value is safe to expose in the browser.',
      'Read non-public environment variables at build time (for example in avenx.config.js or a build script) instead of inside client code.',
      'If the code runs in both Node and the browser, guard the access with `typeof process !== "undefined"`.',
      'Silence with "warnings": { "AVX_W80": "off" } if the reference is intentional.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w80-compiler-non-public-env'
  }
};
