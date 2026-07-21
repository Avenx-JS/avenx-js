import { promptQuestion } from './utils.js';

/**
 * Runs the interactive project wizard prompts if interactive mode is enabled.
 * @param {string[]} [args] - CLI arguments.
 * @returns {Promise<{stylePreprocessor: string, layoutTemplate: string, isInteractive: boolean}>}
 */
export async function runWizard(args = []) {
  const isInteractive =
    (process.stdin.isTTY && process.stdout.isTTY && !args.includes('-y') && !args.includes('--yes')) ||
    args.includes('--interactive') ||
    args.includes('-i') ||
    process.env.AVENX_FORCE_INTERACTIVE === 'true';

  let stylePreprocessor = 'none';
  let layoutTemplate = 'blank';

  if (isInteractive) {
    console.log('\n\x1b[36m--- Avenx-JS Project Wizard ---\x1b[0m\n');

    const preprocessorInput = await promptQuestion(
      'Select style preprocessor:\n' +
        '  1. None (Vanilla CSS)\n' +
        '  2. Sass (SCSS)\n' +
        '  3. Less\n' +
        '  4. PostCSS\n' +
        'Choose an option (1-4, default: 1): ',
      '1',
      (val) => (['1', '2', '3', '4'].includes(val) ? true : 'Please enter a number between 1 and 4'),
    );

    const mapping = {
      1: 'none',
      2: 'sass',
      3: 'less',
      4: 'postcss',
    };
    stylePreprocessor = mapping[preprocessorInput];

    const layoutInput = await promptQuestion(
      'Select layout template:\n' +
        '  1. Blank (Minimal setup)\n' +
        '  2. Routing (Basic navigation with Navbar, Home and About pages)\n' +
        'Choose an option (1-2, default: 1): ',
      '1',
      (val) => (['1', '2'].includes(val) ? true : 'Please enter 1 or 2'),
    );
    layoutTemplate = layoutInput === '2' ? 'routing' : 'blank';
  }

  return { stylePreprocessor, layoutTemplate, isInteractive };
}
