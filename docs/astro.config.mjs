// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
	site: 'https://docs.avenx-js.com',
	base: '/',
	redirects: {
		'/': '/getting-started/intro',
	},
	integrations: [
		starlight({
			title: 'Avenx-JS',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/avenx-js/avenx-js' }
			],
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Introduction', slug: 'getting-started/intro' },
						{ label: 'Installation', slug: 'getting-started/install' },
						{ label: 'Quick Start Tutorial', slug: 'getting-started/quickstart' },
						{ label: 'Routing & Navigation Tutorial', slug: 'getting-started/routing-tutorial' },
						{ label: 'Project Structure', slug: 'getting-started/structure' },
						{ label: 'Configuration', slug: 'getting-started/configuration' },
						{ label: 'TypeScript & JSDoc', slug: 'getting-started/typescript' },
					],
				},

				{
					label: 'Core Concepts',
					items: [
						{ label: 'Template Expressions & Data Binding', slug: 'core-concepts/template-expressions' },
						{ label: 'Component Structure', slug: 'core-concepts/components' },
						{ label: 'Component Lifecycle Hooks', slug: 'core-concepts/lifecycle-hooks' },
						{ label: 'Reactive State', slug: 'core-concepts/reactivity' },
						{ label: 'Computed Properties', slug: 'core-concepts/computed' },
						{ label: 'Actions & Event Handling', slug: 'core-concepts/events' },
						{ label: 'Templates & Slots', slug: 'core-concepts/templates' },
						{ label: 'Transition Animations', slug: 'core-concepts/transitions' },
						{ label: 'Scoped & Global CSS', slug: 'core-concepts/styling' },
						{ label: 'State Management', slug: 'core-concepts/state-management' },
						{ label: 'Bridges (Shared State)', slug: 'core-concepts/bridges' },
						{ label: 'Provide & Inject', slug: 'core-concepts/provide-inject' },
						{ label: 'Plugins & Global Mixins', slug: 'core-concepts/plugins-and-mixins' },
						{ label: 'Custom Directives', slug: 'core-concepts/directives' },
						{ label: 'Form Validation & $validation', slug: 'core-concepts/form-validation' },
						{ label: 'Resources & Async Data', slug: 'core-concepts/resources' },
						{ label: 'Pages & Routing', slug: 'core-concepts/routing' },
						{ label: 'Deferred Loading', slug: 'core-concepts/defer' },
						{ label: 'Compiler Contracts', slug: 'core-concepts/compiler-contracts' },
						{ label: 'Reactive Deadlock Boundaries', slug: 'core-concepts/deadlock' },
					],
				},


				{
					label: 'CLI Reference',
					items: [
						{ label: 'CLI Commands', slug: 'cli-reference/commands' },
						{ label: 'Custom Templates', slug: 'cli-reference/custom-templates' },
						{ label: 'Vite Plugin (@avenx/vite)', slug: 'cli-reference/vite-plugin' },
					],
				},
				{
					label: 'Migration Guides',
					items: [
						{ label: 'Overview & Architectural Comparison', slug: 'migration/overview' },
						{ label: 'React Migration Guide', slug: 'migration/react' },
						{ label: 'Vue Migration Guide', slug: 'migration/vue' },
						{ label: 'Next.js Migration Guide', slug: 'migration/nextjs' },
						{ label: 'Angular Migration Guide', slug: 'migration/angular' },
						{ label: 'Svelte Migration Guide', slug: 'migration/svelte' },
					],
				},
				{
					label: 'Guides',
					items: [
						{ label: 'VirtualList Performance Guide', slug: 'guides/virtual-list' },
						{ label: 'ESLint Template Validation', slug: 'guides/eslint' },
					],
				},
				{
					label: 'API Reference',
					items: [
						{ label: 'AvenxApp API', slug: 'api-reference/app' },
						{ label: 'AvenxComponent API', slug: 'api-reference/component' },
						{ label: 'AvenxPage API', slug: 'api-reference/page' },
						{ label: 'AvenxRouter & Guard API', slug: 'api-reference/router-guard' },
						{ label: 'VirtualList API', slug: 'api-reference/virtuallist' },
						{ label: 'Utility Functions', slug: 'api-reference/utils' },
						{ label: 'Testing API', slug: 'api-reference/testing' },
					],
				},
				{
					label: 'Troubleshooting',
					items: [
						{ label: 'Error Codes', slug: 'troubleshooting/errors' },
					],
				},
				{
					label: 'Best Practices',
					items: [
						{ label: 'Best Practices', slug: 'best-practices/guide' },
					],
				},
			],
		}),
	],
});
