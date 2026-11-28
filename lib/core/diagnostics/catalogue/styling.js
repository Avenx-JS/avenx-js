/**
 * Styling diagnostic catalogue entries.
 */
export default {
  AVX_W58: {
    code: 'AVX_W58',
    name: 'UnresolvedDefReference',
    severity: 'warning',
    category: 'styling',
    summary: 'An @def variable reference in a stylesheet could not be resolved and was left as literal text in the emitted CSS.',
    causes: [
      'A typo occurred when referencing an @def variable name (e.g. "@brnad" instead of "@brand").',
      'The @def variable was not declared in the component stylesheet or global scope.',
      'A self-referential or circular @def declaration could not be resolved during compilation.'
    ],
    remedies: [
      'Check the spelling of the @def variable reference in the stylesheet.',
      'Ensure the corresponding @def variable is declared inside a <@global> or local stylesheet block.',
      'Fix any circular or self-referential @def variable declarations.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w58-compiler-unresolved-def-reference'
  }
};
