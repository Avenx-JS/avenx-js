# Specialized AI Agents System

Welcome to the **Avenx-JS Specialized AI Agents System**! 

This directory contains a structured, modular set of specialized agent instructions designed for contributors, maintainers, and AI coding assistants (like Antigravity) working on the Avenx-JS codebase. By dividing responsibilities, we ensure consistent standards, prevent regression bugs, and speed up software development.

## Directory Overview

The `.agents/` folder contains specific instructions for the specialized agents in our ecosystem:

* `runtime_agent.md` — Configures the Core Runtime & Renderer Agent.
* `compiler_agent.md` — Configures the Compiler & Parser Agent.
* `cli_agent.md` — Configures the CLI & Tooling Agent.
* `testing_agent.md` — Configures the Testing & Performance Agent.
* `docs_agent.md` — Configures the Documentation & DevRel Agent.

---

## When to Use Each Agent

Depending on your current branch, task, or targeted file path, choose the corresponding agent:

| Agent Name | Target Files / Scope | Example Tasks |
| :--- | :--- | :--- |
| **Core Runtime & Renderer** | `lib/core/runtime/`, `lib/core/renderer/`, `lib/core/reactive/`, `lib/core/events/` | Optimizing DOM diffs, adding runtime lifecycle hooks, refining reactivity handlers, implementing route guards. |
| **Compiler & Parser** | `lib/compiler/`, `lib/compiler.js` | Adding new component tag parsing support, upgrading css scope hashes, expression parsing. |
| **CLI & Tooling** | `bin/avenx.js`, `vite-plugin-avenx/` | Scaffolding templates, modifying Vite plugin build triggers, HMR handler adjustments. |
| **Testing & Performance** | `test/`, `benches/`, CI workflows (`.github/workflows`) | Creating unit/integration tests, performance profiling, tracking bundle size regressions. |
| **Documentation & DevRel** | `docs/`, examples/ | Creating API tutorials, modifying markdown pages, refining frontmatter Astro configurations. |

---

## How Contributors Can Add New Agents

To scale our developer ecosystem, contributors can add new specialized agents when a distinct new domain emerges (e.g., Security, Bundler, or State Syncing). Follow these steps:

1. **Create the agent file**: Create a new file under the `.agents/` folder using the syntax `[agent_name]_agent.md` (e.g. `security_agent.md`).
2. **Follow the Template**: Each agent definition file must strictly implement the standard sections:
   - **Mission**: A concise description of the agent's purpose.
   - **Responsibilities**: A bullet list describing what the agent owns.
   - **Out of Scope**: Clear bounds of what the agent does not own.
   - **Rules**: Project-scoped behavioral constraints.
   - **Checklist**: Actionable checklist of checks to run before finishing tasks.
   - **Best Practices**: Performance, clean code, or domain-specific guidelines.
   - **Success Criteria**: Clear definition of done for the agent tasks.
3. **Register the Agent**: Update this `README.md` to reference the new agent in the overview and the classification table.
4. **Submit for review**: Push your changes and open a pull request so other maintainers can review the guidelines.
