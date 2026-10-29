# Maintainer Guidelines

## Purpose

This document defines the principles and expectations that guide maintainers of Avenx.js when working with contributors, managing issues, reviewing pull requests, and maintaining the framework.

Maintainers play a key role in building not only the framework itself but also the community around it. Their responsibility goes beyond reviewing code: they help contributors get started, create a welcoming environment, and ensure that contributions can have a meaningful impact on the project.

These guidelines are intended to support maintainers in their work while leaving room for individual judgment and flexibility.

## 1. Core Principles

Avenx.js is built with the help of its contributors. Every contribution represents someone's time, effort, and willingness to improve the framework.

As maintainers, we aim to:

- **Welcome contributions.** Treat every contributor with respect, regardless of their experience, background, or contribution size.
- **Show appreciation.** Acknowledge the time and effort people invest in Avenx.js, even when a contribution cannot be accepted.
- **Make contributing accessible.** Provide enough context and guidance for contributors to understand an issue and get started without unnecessary obstacles.
- **Communicate transparently.** Explain decisions, provide constructive feedback, and keep contributors informed when progress takes longer than expected.
- **Encourage ownership.** Give contributors the opportunity to take responsibility for their work and grow alongside the project.
- **Maintain quality.** Balance a welcoming contribution process with the technical standards, architecture, stability, and long-term direction of Avenx.js.

A contribution does not have to be accepted to be appreciated. When declining a contribution, explain the reasoning respectfully and, where possible, suggest a way forward.

## 2. Creating Issues

Issues should provide enough information for a contributor to understand the problem, evaluate the scope, and begin working with minimal guesswork.

Before creating an issue, check whether a similar issue already exists and whether the proposed work aligns with the current direction of Avenx.js.

### 2.1 General Expectations

Every issue should clearly communicate:

- **Context:** What part of Avenx.js is affected, and why does this matter?
- **Objective:** What should be achieved or resolved?
- **Scope:** What is included in the task, and what is outside its scope?
- **Expected outcome:** What should the result look like?
- **Additional references:** Link relevant code, documentation, issues, pull requests, or architectural decisions where useful.

Issues should be detailed enough to guide contributors without unnecessarily restricting their implementation choices.

Avoid vague descriptions such as "improve the router" or "refactor the compiler" without explaining the intended improvement.

### 2.2 Feature Requests

For features that extend existing functionality:

- Describe how the relevant functionality currently works.
- Explain the surrounding architecture and identify the components that may be affected.
- Describe the proposed behavior and how it should integrate with existing functionality.
- Explain the problem the feature solves and why it would benefit Avenx.js.
- Identify relevant compatibility, performance, or architectural considerations where applicable.

For entirely new features, provide a clear vision of the intended functionality, its purpose, and how it fits into the framework.

When the implementation is open to interpretation, describe the desired outcome rather than prescribing every implementation detail. Contributors should have room to propose better solutions.

### 2.3 Tasks and Improvements

Break larger tasks into manageable, understandable steps.

Where appropriate, include:

- A clear description of the work to be completed.
- Relevant files, modules, or subsystems to investigate.
- Dependencies on other tasks or architectural decisions.
- Acceptance criteria that define when the task is complete.
- Relevant testing, documentation, or compatibility requirements.

Avoid combining unrelated tasks into a single issue when they could reasonably be handled independently.

### 2.4 Bug Reports and Bug Fixes

Bug-related issues should make the problem reproducible and the expected behavior unambiguous.

Include, where applicable:

- Steps to reproduce the problem.
- The actual behavior and the expected behavior.
- A minimal code example or reproduction project.
- Relevant environment details, versions, and configuration.
- Error messages, logs, or stack traces.
- The suspected subsystem or relevant implementation details, if known.
- The tests that should be added or updated to prevent regressions.

When the root cause is unknown, do not present speculation as fact. Clearly distinguish confirmed observations from potential explanations.

For bugs that affect existing tests, identify the relevant test coverage where possible. New regression tests should generally accompany bug fixes.

## 3. Reviewing Pull Requests

Pull request reviews are an opportunity to maintain code quality while helping contributors understand the framework and improve their skills.

Reviews should be constructive, technically justified, and focused on the contribution rather than the person submitting it.

### 3.1 Taking Responsibility for Reviews

When a maintainer starts reviewing a pull request, they should assign it to themselves and request a review from themselves where supported by the repository's workflow.

This makes ownership visible and helps prevent multiple maintainers from unknowingly duplicating work or leaving a pull request unattended.

Once a maintainer takes ownership of a review, they should aim to review it promptly. If the review will take longer than expected, communicate this to the contributor rather than leaving them waiting without an update.

If a maintainer cannot continue reviewing a pull request, they should release ownership or coordinate with another maintainer.

### 3.2 Review Standards

When reviewing a pull request, consider:

- Correctness and whether the proposed changes solve the intended problem.
- Compatibility with the existing architecture and public APIs.
- Code readability, maintainability, and consistency with project conventions.
- Appropriate tests and regression coverage.
- Documentation and examples where relevant.
- Potential security, performance, accessibility, or compatibility implications, where applicable.

Feedback should explain the reason behind a requested change whenever possible. Prefer actionable suggestions over vague comments or personal preferences.

Distinguish between blocking issues, recommended improvements, and optional suggestions. Do not unnecessarily delay a contribution over purely stylistic preferences that do not affect the project's standards.

### 3.3 Small Fixes During Review

Maintainers may fix small, straightforward issues themselves when doing so is more efficient than requesting another round of changes.

Examples include:

- Minor typos or documentation mistakes.
- Simple linting or formatting errors.
- Trivial corrections that do not change the intended behavior.
- Small oversights that can be fixed safely and immediately.

When appropriate, a maintainer may merge a pull request and apply a small follow-up fix directly to `main`, provided the change is low-risk and consistent with the project's contribution and branch policies.

This flexibility should not be used to bypass meaningful review, required tests, CI checks, or safeguards for changes that could affect behavior, public APIs, or stability.

Substantial changes should remain reviewable and follow the normal contribution workflow.

### 3.4 Communicating Review Decisions

When requesting changes, explain what needs to change and why.

When approving a pull request, acknowledge the contributor's work where appropriate.

When declining a pull request, provide a clear explanation based on technical requirements, project direction, scope, or other relevant considerations. Whenever practical, suggest alternatives that could make the contribution viable.

A rejection should never be unnecessarily dismissive of the contributor's effort.

## 4. Supporting Contributors

Maintainers should help contributors navigate the framework and its development workflow without expecting everyone to have prior knowledge of the codebase.

Where appropriate:

- Answer questions about issue scope, architecture, and expected behavior.
- Point contributors to relevant documentation, code, or examples.
- Clarify requirements when an issue turns out to be ambiguous.
- Provide constructive feedback that helps contributors understand their mistakes.
- Recognize meaningful contributions, including documentation, tests, bug reports, and smaller improvements.

Contributors should not be expected to understand the entire framework before making their first contribution. Maintainers should help them identify the relevant parts of the codebase and understand the decisions that matter for their task.

## 5. Maintaining Project Quality

Avenx.js welcomes contributions, but maintainers remain responsible for protecting the framework's long-term quality and direction.

Maintainers should use their judgment to ensure that changes are consistent with the project's architecture, design principles, and release standards.

When a proposed change introduces unnecessary complexity, duplicates existing functionality, creates compatibility problems, or conflicts with the project's direction, explain the concern and work with the contributor to explore alternatives.

Not every improvement needs to be implemented immediately. Some contributions may need further discussion, additional preparation, or alignment with future architectural work.

Technical decisions should be based on the needs of Avenx.js and its users, not on personal preferences or the status of individual contributors.

## 6. Flexibility and Judgment

These guidelines establish shared expectations, not rigid rules that must be followed mechanically in every situation.

Maintainers have the freedom to adapt their approach to the circumstances, provided they act responsibly, communicate clearly, and preserve the principles outlined above.

Use common sense. A trivial documentation correction does not require the same process as a compiler change or a breaking API modification.

The goal is not to introduce bureaucracy. The goal is to make collaboration easier, reviews more effective, and contributions more enjoyable.

## 7. Final Principle

**Build the framework. Build the community. Respect the people behind both.**

Every maintainer helps shape the experience of contributing to Avenx.js. By being approachable, responsive, transparent, and technically responsible, we can build a framework that people are proud to contribute to and a community in which they want to remain involved.